import { describe, expect, it } from 'vitest'
import type { BookingContact, BookingRepository, BookingSummary } from '../ports/booking-repository'
import type {
  AuthChallenge,
  AuthChallengeRepository,
  MemberRecord,
  MemberRepository,
} from '../ports/member-repository'
import { makeAttachMemberToHold } from './attach-member'
import {
  makeRegisterMember,
  makeSendSignInCode,
  makeVerifySignInCode,
  type SignInDeps,
} from './sign-in'

const PHONE = '+819012345678'

function fakeSignIn(start = '2026-11-01T03:00:00Z') {
  let now = new Date(start)
  const advance = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000)
  }
  const challenges: (AuthChallenge & { createdAt: Date })[] = []
  const members: MemberRecord[] = []
  const consents: { memberId: number; documentIds: readonly number[] }[] = []
  const sent: { to: string; body: string }[] = []
  let codes = 0
  let tokens = 0
  let nextCode = '123456'

  const find = (id: string) => challenges.find((c) => c.publicId === id)
  const update = (id: string, change: Partial<AuthChallenge>) => {
    const c = find(id)
    if (c) Object.assign(c, change)
  }
  const challengeRepo: AuthChallengeRepository = {
    create: async (c) => {
      challenges.push({
        ...c,
        status: 'pending',
        verifiedAt: null,
        attemptCount: 0,
        memberId: null,
        createdAt: now,
      })
    },
    findByPublicId: async (id) => find(id) ?? null,
    latestForPhone: async (phone) => challenges.filter((c) => c.phone === phone).at(-1) ?? null,
    countCreatedSince: async (phone, since) =>
      challenges.filter((c) => c.phone === phone && c.createdAt >= since).length,
    recordFailure: async (id, lock) => {
      const c = find(id)
      if (c) update(id, { attemptCount: c.attemptCount + 1, status: lock ? 'locked' : c.status })
    },
    markVerified: async (id, at, memberId) =>
      update(id, { status: 'verified', verifiedAt: at, memberId }),
    linkMember: async (id, memberId) => update(id, { memberId }),
    setProviderRequestId: async () => {},
  }
  const memberRepo: MemberRepository = {
    findById: async (id) => members.find((m) => m.id === id) ?? null,
    findByPhone: async (phone) => members.find((m) => m.phone === phone) ?? null,
    createPhoneMember: async (input) => {
      const id = members.length + 1
      const member: MemberRecord = {
        id,
        memberCode: `JC-U-${String(id).padStart(6, '0')}`,
        phone: input.phone,
        familyName: input.profile.familyName,
        givenName: input.profile.givenName,
        email: input.profile.email,
        status: 'active',
      }
      members.push(member)
      consents.push({ memberId: id, documentIds: input.consentDocumentIds })
      return member
    },
  }
  const deps: SignInDeps = {
    challenges: challengeRepo,
    members: memberRepo,
    legalDocuments: {
      current: async (types) => types.map((type, i) => ({ id: i + 1, type, version: '2026-10' })),
    },
    sms: {
      send: async (m) => {
        sent.push(m)
        return { providerMessageId: `sms-${sent.length}` }
      },
    },
    hasher: { hash: async (s) => `h(${s})` },
    random: {
      digits: () => {
        codes++
        return nextCode
      },
      token: () => `ch-${++tokens}`,
    },
    clock: { now: () => now },
  }
  return {
    deps,
    challenges,
    members,
    consents,
    sent,
    advance,
    setNextCode: (c: string) => {
      nextCode = c
    },
    codesIssued: () => codes,
  }
}

const profile = {
  familyName: '山田',
  givenName: '太郎',
  email: 'taro@example.com',
  agreesToTerms: true,
  confirmsAdult: true,
}

describe('sendSignInCode (C-05)', () => {
  it('stores only a hash and texts the code to the normalised number', async () => {
    const f = fakeSignIn()
    const result = await makeSendSignInCode(f.deps)('090-1234-5678')
    expect(result.maskedPhone).toBe('090-****-5678')
    expect(f.sent).toEqual([{ to: PHONE, body: '雀CUBE 認証コード: 123456（10分有効）' }])
    expect(f.challenges[0]?.secretHash).toBe(`h(${result.challengeId}:123456)`)
    expect(f.challenges[0]?.expiresAt.toISOString()).toBe('2026-11-01T03:10:00.000Z')
  })

  it('enforces the 60-second resend wait and 5 codes per hour', async () => {
    const f = fakeSignIn()
    const send = makeSendSignInCode(f.deps)
    await send(PHONE)
    await expect(send(PHONE)).rejects.toMatchObject({ code: 'resend_too_soon' })
    for (let i = 0; i < 4; i++) {
      f.advance(61)
      await send(PHONE)
    }
    f.advance(61)
    await expect(send(PHONE)).rejects.toMatchObject({ code: 'too_many_codes' })
    f.advance(3600)
    await expect(send(PHONE)).resolves.toBeTruthy()
  })

  it('rejects landlines before sending anything', async () => {
    const f = fakeSignIn()
    await expect(makeSendSignInCode(f.deps)('06-1234-5678')).rejects.toMatchObject({
      code: 'invalid_phone',
    })
    expect(f.sent).toHaveLength(0)
  })
})

describe('verifySignInCode (C-06)', () => {
  it('routes a new number to registration and an existing member straight in', async () => {
    const f = fakeSignIn()
    const send = makeSendSignInCode(f.deps)
    const verify = makeVerifySignInCode(f.deps)

    const first = await send(PHONE)
    expect(await verify(first.challengeId, '123 456')).toEqual({
      kind: 'new_member',
      challengeId: first.challengeId,
    })
    const { memberId } = await makeRegisterMember(f.deps)(first.challengeId, profile)

    f.advance(120)
    const second = await send(PHONE)
    expect(await verify(second.challengeId, '123456')).toEqual({ kind: 'member', memberId })
  })

  it('locks the challenge after 5 wrong codes', async () => {
    const f = fakeSignIn()
    const { challengeId } = await makeSendSignInCode(f.deps)(PHONE)
    const verify = makeVerifySignInCode(f.deps)
    for (let i = 0; i < 4; i++) {
      await expect(verify(challengeId, '000000')).rejects.toMatchObject({ code: 'invalid_code' })
    }
    await expect(verify(challengeId, '000000')).rejects.toMatchObject({ code: 'code_locked' })
    await expect(verify(challengeId, '123456')).rejects.toMatchObject({ code: 'code_locked' })
  })

  it('rejects an expired code and a code from another challenge', async () => {
    const f = fakeSignIn()
    const send = makeSendSignInCode(f.deps)
    const verify = makeVerifySignInCode(f.deps)
    const a = await send(PHONE)
    f.advance(61)
    f.setNextCode('654321')
    const b = await send(PHONE)
    await expect(verify(a.challengeId, '654321')).rejects.toMatchObject({ code: 'invalid_code' })
    f.advance(600)
    await expect(verify(b.challengeId, '654321')).rejects.toMatchObject({ code: 'code_expired' })
  })

  it('refuses suspended members', async () => {
    const f = fakeSignIn()
    f.members.push({
      id: 7,
      memberCode: 'JC-U-000007',
      phone: PHONE,
      familyName: '山田',
      givenName: '太郎',
      email: null,
      status: 'suspended',
    })
    const { challengeId } = await makeSendSignInCode(f.deps)(PHONE)
    await expect(makeVerifySignInCode(f.deps)(challengeId, '123456')).rejects.toMatchObject({
      code: 'member_cannot_book',
    })
  })
})

describe('registerMember (C-07)', () => {
  it('records consent to terms, privacy and the age declaration', async () => {
    const f = fakeSignIn()
    const { challengeId } = await makeSendSignInCode(f.deps)(PHONE)
    await makeVerifySignInCode(f.deps)(challengeId, '123456')
    const { memberId } = await makeRegisterMember(f.deps)(challengeId, profile)
    expect(f.members[0]).toMatchObject({ id: memberId, phone: PHONE, familyName: '山田' })
    expect(f.consents).toEqual([{ memberId, documentIds: [1, 2, 3] }])
    expect(f.challenges[0]?.memberId).toBe(memberId)
  })

  it('requires a verified challenge within 30 minutes', async () => {
    const f = fakeSignIn()
    const { challengeId } = await makeSendSignInCode(f.deps)(PHONE)
    const register = makeRegisterMember(f.deps)
    await expect(register(challengeId, profile)).rejects.toMatchObject({
      code: 'verification_required',
    })
    await makeVerifySignInCode(f.deps)(challengeId, '123456')
    f.advance(31 * 60)
    await expect(register(challengeId, profile)).rejects.toMatchObject({
      code: 'verification_required',
    })
  })
})

describe('attachMemberToHold', () => {
  function holdWith(memberId: number | null) {
    const assigned: BookingContact[] = []
    const summary = {
      status: 'draft',
      holdExpiresAt: new Date('2026-11-01T03:10:00Z'),
      memberId,
    } as BookingSummary
    const bookings = {
      findByRequestKey: async () => summary,
      assignMember: async (_key: string, contact: BookingContact) => {
        assigned.push(contact)
      },
    } as unknown as BookingRepository
    return { bookings, assigned }
  }

  it('snapshots the member contact onto the hold', async () => {
    const f = fakeSignIn()
    const { challengeId } = await makeSendSignInCode(f.deps)(PHONE)
    await makeVerifySignInCode(f.deps)(challengeId, '123456')
    const { memberId } = await makeRegisterMember(f.deps)(challengeId, profile)

    const { bookings, assigned } = holdWith(null)
    await makeAttachMemberToHold({ bookings, members: f.deps.members, clock: f.deps.clock })(
      'key',
      memberId,
    )
    expect(assigned).toEqual([
      { memberId, familyName: '山田', givenName: '太郎', phone: PHONE, email: 'taro@example.com' },
    ])
  })

  it("does not take over another member's hold", async () => {
    const f = fakeSignIn()
    f.members.push({
      id: 1,
      memberCode: 'JC-U-000001',
      phone: PHONE,
      familyName: '山田',
      givenName: '太郎',
      email: null,
      status: 'active',
    })
    const { bookings } = holdWith(99)
    await expect(
      makeAttachMemberToHold({ bookings, members: f.deps.members, clock: f.deps.clock })('key', 1),
    ).rejects.toMatchObject({ code: 'hold_not_found' })
  })
})
