import { describe, expect, it } from 'vitest'
import { fakeHoldDeps } from '../booking/test-fixtures'
import type { CheckoutDeps } from '../payment/checkout'
import type { LineLinkRepository, LineWebhookEvent } from '../ports/line'
import type { LineChatRepository, LineChatSession } from './line-chat'
import { makeLineChat } from './line-chat'

function world() {
  const { deps: hold, drafts } = fakeHoldDeps()
  const sessions = new Map<string, LineChatSession>()
  const repository: LineChatRepository = {
    withSession: async (_p, user, fn) => {
      const outcome = await fn(
        sessions.has(user) ? JSON.parse(JSON.stringify(sessions.get(user)!)) : null,
      )
      sessions.set(user, outcome.session)
      return outcome.result
    },
  }
  let linked = false
  const links = {
    findByLineUser: async () => (linked ? { memberId: 1 } : null),
  } as unknown as LineLinkRepository
  const alerts: unknown[] = []
  const checkout = {
    ...hold,
    members: {
      findById: async () => ({
        id: 1,
        memberCode: 'JC-U-000001',
        phone: null,
        familyName: '山田',
        givenName: '太郎',
        email: 'taro@example.com',
        status: 'active',
      }),
    },
    coupons: { usableGrants: async () => [] },
  } as unknown as CheckoutDeps
  const chat = makeLineChat({
    sessions: repository,
    links,
    providerId: 'P',
    hold,
    checkout,
    alerts: {
      raise: async (v) => {
        alerts.push(v)
      },
      resolve: async () => {},
    },
    appUrl: 'https://booking.example',
    liffId: '123-abc',
  })
  let seq = 0
  const event = (input: Partial<LineWebhookEvent> = {}): LineWebhookEvent => ({
    eventId: `e${++seq}`,
    timestamp: new Date('2026-11-01T03:00:00Z'),
    type: 'message',
    rawType: 'message',
    userId: 'U1',
    replyToken: 'r',
    isRedelivery: false,
    ...input,
  })
  const select = (index = '0', userId = 'U1') =>
    chat(event({ userId, postbackData: `jc:${sessions.get(userId)!.nonce}:${index}` }))
  return {
    chat,
    event,
    select,
    sessions,
    drafts,
    alerts,
    link: () => {
      linked = true
    },
  }
}

describe('LINE selection booking and staff handoff', () => {
  it('selects store/date/room/start/end/guests without phone verification, then requires consented registration', async () => {
    const w = world()
    await w.chat(w.event({ text: '予約する' }))
    for (let i = 0; i < 6; i++) await w.select()
    expect(w.sessions.get('U1')!.stage).toBe('confirm')
    expect(w.sessions.get('U1')!.response!.text).toContain('SMSは不要')
    expect(w.drafts).toHaveLength(0)
    w.link()
    await w.select() // Continue after registering through verified LIFF.
    const confirm = w.event({ postbackData: `jc:${w.sessions.get('U1')!.nonce}:0` })
    await w.chat(confirm)
    expect(w.drafts).toHaveLength(1)
    expect(w.drafts[0]!.contact?.memberId).toBe(1)
    expect(w.drafts[0]!.contact?.phone).toBeNull()
    expect(w.sessions.get('U1')!.stage).toBe('coupon')
    await w.chat({ ...confirm, isRedelivery: true })
    expect(w.drafts).toHaveLength(1)
  })

  it('rejects stale buttons and tokens belonging to another LINE identity', async () => {
    const w = world()
    await w.chat(w.event({ text: '予約する' }))
    const old = w.sessions.get('U1')!.response!.choices[0]!
    await w.select()
    const reply = await w.chat(w.event({ postbackData: 'data' in old ? old.data : '' }))
    expect(reply!.text).toContain('古く')
    expect(w.sessions.get('U1')!.stage).toBe('date')
    await w.chat(w.event({ userId: 'U2', text: '予約する' }))
    await w.chat(w.event({ userId: 'U2', postbackData: `jc:${w.sessions.get('U1')!.nonce}:0` }))
    expect(w.sessions.get('U2')!.stage).toBe('store')
  })

  it('stops automated replies during handoff, even for old buttons, until an explicit restart', async () => {
    const w = world()
    await w.chat(w.event({ text: '予約する' }))
    await w.select('staff')
    expect(w.alerts).toHaveLength(1)
    expect(await w.chat(w.event({ text: 'ありがとうございます' }))).toBeNull()
    expect(await w.select()).toBeNull()
    expect(w.sessions.get('U1')!.mode).toBe('staff')
    await w.chat(w.event({ text: '予約する' }))
    expect(w.sessions.get('U1')!.mode).toBe('bot')
  })

  it('paginates long option lists within LINE quick-reply limits and ignores out-of-order events', async () => {
    const w = world()
    await w.chat(w.event({ text: '予約する' }))
    await w.select()
    await w.select('next')
    expect(w.sessions.get('U1')!.page).toBe(1)
    expect(w.sessions.get('U1')!.response!.choices.length).toBeLessThanOrEqual(13)
    await w.chat(w.event({ text: '予約する', timestamp: new Date('2026-10-31') }))
    expect(w.sessions.get('U1')!.stage).toBe('date')
  })
})
