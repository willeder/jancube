import { DomainError } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import type { WebhookRepository } from '../ports/checkout'
import type { LineLink, LineLinkRepository, LineWebhookEvent } from '../ports/line'
import type { MemberRecord } from '../ports/member-repository'
import type { AuditLog } from '../ports/ops'
import {
  type LineAccountDeps,
  makeGetLineLinkStatus,
  makeLineSignIn,
  makeLinkLineAccount,
  makeUnlinkLineAccount,
} from './line-account'
import { LINE_GUIDANCE_MESSAGE, makeHandleLineWebhook } from './line-webhook'

const PROVIDER = '2000000001'
const NOW = new Date('2026-11-01T03:00:00Z')

function member(id: number, status: MemberRecord['status'] = 'active'): MemberRecord {
  return {
    id,
    memberCode: `JC-U-${String(id).padStart(6, '0')}`,
    phone: '+819012345678',
    familyName: '山田',
    givenName: '太郎',
    email: null,
    status,
  }
}

function fakeLinks() {
  const rows: (LineLink & { providerId: string; checkedAt: Date | null })[] = []
  const repo: LineLinkRepository = {
    findByLineUser: async (providerId, lineUserId) =>
      rows.find((r) => r.providerId === providerId && r.lineUserId === lineUserId) ?? null,
    findByMember: async (memberId) => rows.find((r) => r.memberId === memberId) ?? null,
    save: async (link) => {
      const i = rows.findIndex((r) => r.memberId === link.memberId)
      if (i >= 0) rows.splice(i, 1)
      rows.push({ ...link, checkedAt: null })
    },
    remove: async (memberId) => {
      const i = rows.findIndex((r) => r.memberId === memberId)
      return i >= 0 ? (rows.splice(i, 1)[0] ?? null) : null
    },
    setFriendStatus: async (providerId, lineUserId, status, at) => {
      const row = rows.find((r) => r.providerId === providerId && r.lineUserId === lineUserId)
      if (!row) return false
      Object.assign(row, { friendStatus: status, checkedAt: at })
      return true
    },
  }
  return { rows, repo }
}

function setup(members: MemberRecord[] = [member(1)]) {
  const links = fakeLinks()
  const audits: Parameters<AuditLog['record']>[0][] = []
  let friend: boolean | null = true
  const deps: LineAccountDeps = {
    verifier: {
      verifyIdToken: async (token) => {
        if (!token.startsWith('ok:')) throw new DomainError('line_token_invalid', 'invalid')
        return { lineUserId: token.slice(3), displayName: 'taro' }
      },
      friendship: async (accessToken) => (accessToken ? friend : null),
    },
    links: links.repo,
    members: {
      findById: async (id) => members.find((m) => m.id === id) ?? null,
      findByPhone: async () => null,
      createPhoneMember: async () => {
        throw new Error('not used')
      },
    },
    audit: { record: async (e) => void audits.push(e) },
    clock: { now: () => NOW },
    providerId: PROVIDER,
  }
  return {
    deps,
    links,
    audits,
    setFriend: (f: boolean | null) => {
      friend = f
    },
  }
}

describe('LINE sign-in and linking (F-LINE-02/03, F-AUTH-06)', () => {
  it('sends an unknown LINE user to linking, then signs the linked member in directly', async () => {
    const { deps, links, audits } = setup()
    const signIn = makeLineSignIn(deps)

    const first = await signIn('ok:U1', 'access')
    expect(first).toEqual({
      kind: 'not_linked',
      line: { lineUserId: 'U1', friendStatus: 'friend' },
    })
    if (first.kind !== 'not_linked') throw new Error('unreachable')

    await makeLinkLineAccount(deps)(1, first.line)
    expect(links.rows).toMatchObject([
      { memberId: 1, providerId: PROVIDER, lineUserId: 'U1', friendStatus: 'friend' },
    ])
    expect(audits).toMatchObject([{ action: 'member.line_link', actor: { memberId: 1 } }])
    // The LINE user id is not copied into the audit log.
    expect(JSON.stringify(audits)).not.toContain('U1')

    expect(await signIn('ok:U1', null)).toEqual({ kind: 'member', memberId: 1 })
  })

  it('rejects an invalid ID token', async () => {
    const { deps } = setup()
    await expect(makeLineSignIn(deps)('forged', null)).rejects.toMatchObject({
      code: 'line_token_invalid',
    })
  })

  it('treats a non-friend as unreachable and updates the status on the next sign-in', async () => {
    const { deps, links, setFriend } = setup()
    setFriend(false)
    const first = await makeLineSignIn(deps)('ok:U1', 'access')
    if (first.kind !== 'not_linked') throw new Error('unreachable')
    expect(first.line.friendStatus).toBe('blocked')
    await makeLinkLineAccount(deps)(1, first.line)

    setFriend(true)
    await makeLineSignIn(deps)('ok:U1', 'access')
    expect(links.rows[0]?.friendStatus).toBe('friend')
  })

  it('refuses a LINE account linked to another member, but frees one left by a withdrawn member', async () => {
    const { deps, links } = setup([member(1), member(2), member(3, 'withdrawn')])
    const link = makeLinkLineAccount(deps)
    await link(1, { lineUserId: 'U1', friendStatus: 'unknown' })
    await expect(link(2, { lineUserId: 'U1', friendStatus: 'unknown' })).rejects.toMatchObject({
      code: 'line_already_linked',
    })

    await links.repo.save({
      memberId: 3,
      providerId: PROVIDER,
      lineUserId: 'U9',
      friendStatus: 'friend',
      linkedAt: NOW,
    })
    await link(2, { lineUserId: 'U9', friendStatus: 'friend' })
    expect(links.rows.map((r) => [r.memberId, r.lineUserId])).toEqual([
      [1, 'U1'],
      [2, 'U9'],
    ])
  })

  it('is idempotent and replaces the previous LINE account of the member', async () => {
    const { deps, links, audits } = setup()
    const link = makeLinkLineAccount(deps)
    expect(await link(1, { lineUserId: 'U1', friendStatus: 'friend' })).toEqual({ replaced: false })
    expect(await link(1, { lineUserId: 'U1', friendStatus: 'friend' })).toEqual({ replaced: false })
    expect(audits).toHaveLength(1)
    expect(await link(1, { lineUserId: 'U2', friendStatus: 'friend' })).toEqual({ replaced: true })
    expect(links.rows.map((r) => r.lineUserId)).toEqual(['U2'])
  })

  it('unlinks (C-17) and the member stays a member', async () => {
    const { deps, links, audits } = setup()
    await makeLinkLineAccount(deps)(1, { lineUserId: 'U1', friendStatus: 'friend' })
    expect(await makeUnlinkLineAccount(deps)(1)).toEqual({ unlinked: true })
    expect(await makeUnlinkLineAccount(deps)(1)).toEqual({ unlinked: false })
    expect(links.rows).toHaveLength(0)
    expect(audits.map((a) => a.action)).toEqual(['member.line_link', 'member.line_unlink'])
    expect(await makeGetLineLinkStatus(deps)(1)).toEqual({
      linked: false,
      friendStatus: null,
      linkedAt: null,
    })
    expect(await makeLineSignIn(deps)('ok:U1', null)).toMatchObject({ kind: 'not_linked' })
  })

  it('does not sign in a suspended member', async () => {
    const { deps } = setup([member(1, 'suspended')])
    await deps.links.save({
      memberId: 1,
      providerId: PROVIDER,
      lineUserId: 'U1',
      friendStatus: 'friend',
      linkedAt: NOW,
    })
    await expect(makeLineSignIn(deps)('ok:U1', null)).rejects.toMatchObject({
      code: 'member_cannot_book',
    })
  })
})

function fakeWebhooks() {
  const rows: { id: number; key: string; status: string; error?: string }[] = []
  const repo: WebhookRepository = {
    record: async (e) => {
      const key = `${e.provider}:${e.environment}:${e.accountId}:${e.eventId}`
      const found = rows.find((r) => r.key === key)
      if (found) {
        return {
          id: found.id,
          duplicate: true,
          processed: found.status === 'processed' || found.status === 'ignored',
        }
      }
      rows.push({ id: rows.length + 1, key, status: 'received' })
      return { id: rows.length, duplicate: false, processed: false }
    },
    finish: async (id, status, error) => {
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, { status, error })
    },
  }
  return { rows, repo }
}

const event = (e: Partial<LineWebhookEvent> & Pick<LineWebhookEvent, 'eventId' | 'type'>) =>
  ({
    rawType: e.type,
    userId: 'U1',
    replyToken: null,
    timestamp: NOW,
    isRedelivery: false,
    ...e,
  }) satisfies LineWebhookEvent

describe('LINE webhook (follow/unfollow, guidance reply)', () => {
  function webhookSetup(events: LineWebhookEvent[]) {
    const { links } = setup()
    const webhooks = fakeWebhooks()
    const replies: { token: string; text: string }[] = []
    let failReply = false
    const handle = makeHandleLineWebhook({
      parser: {
        parse: async (_body, signature) => {
          if (signature !== 'valid') throw new Error('invalid signature')
          return { destination: 'Ubot', events, payloadSha256: 'a'.repeat(64) }
        },
      },
      webhooks: webhooks.repo,
      links: links.repo,
      replies: {
        reply: async (token, text) => {
          if (failReply) throw new Error('Invalid reply token')
          replies.push({ token, text })
        },
      },
      clock: { now: () => NOW },
      providerId: PROVIDER,
      environment: 'test',
    })
    return {
      handle,
      links,
      webhooks,
      replies,
      failReplies: () => {
        failReply = true
      },
    }
  }

  it('rejects a bad signature before touching anything', async () => {
    const { handle, webhooks } = webhookSetup([event({ eventId: 'E1', type: 'follow' })])
    await expect(handle('{}', 'forged')).rejects.toThrow(/signature/)
    expect(webhooks.rows).toHaveLength(0)
  })

  it('marks blocked on unfollow and friend on follow, once per event id', async () => {
    const t = webhookSetup([
      event({ eventId: 'E1', type: 'unfollow' }),
      event({ eventId: 'E2', type: 'follow', userId: 'U-unlinked' }),
    ])
    await t.links.repo.save({
      memberId: 1,
      providerId: PROVIDER,
      lineUserId: 'U1',
      friendStatus: 'friend',
      linkedAt: NOW,
    })
    expect(await t.handle('{}', 'valid')).toEqual({
      processed: 1,
      duplicates: 0,
      ignored: 1,
      failed: 0,
    })
    expect(t.links.rows[0]?.friendStatus).toBe('blocked')
    expect(await t.handle('{}', 'valid')).toMatchObject({ processed: 0, duplicates: 2 })
  })

  it('replies to messages with the fixed guidance, not on redelivery', async () => {
    const t = webhookSetup([
      event({ eventId: 'E1', type: 'message', replyToken: 'r1' }),
      event({ eventId: 'E2', type: 'message', replyToken: 'r2', isRedelivery: true }),
    ])
    await t.handle('{}', 'valid')
    expect(t.replies).toEqual([{ token: 'r1', text: LINE_GUIDANCE_MESSAGE }])
  })

  it('records a failed reply without asking LINE to redeliver', async () => {
    const t = webhookSetup([event({ eventId: 'E1', type: 'message', replyToken: 'r1' })])
    t.failReplies()
    expect(await t.handle('{}', 'valid')).toMatchObject({ failed: 1 })
    expect(t.webhooks.rows[0]).toMatchObject({ status: 'failed', error: 'Invalid reply token' })
  })
})
