import { describe, expect, it, vi } from 'vitest'
import type { CouponRepository } from '../ports/checkout'
import type { LineMemberCreator } from '../ports/line'
import type { LegalDocumentRepository } from '../ports/member-repository'
import { makeRegisterLineMember } from './register-line-member'

describe('phone-free LINE registration', () => {
  const input = {
    familyName: '山田',
    givenName: '太郎',
    email: ' Taro@Example.com ',
    agreesToTerms: true,
    confirmsAdult: true,
  }
  const line = { lineUserId: 'U1', friendStatus: 'friend' as const }

  function world() {
    const creator: LineMemberCreator = {
      createLineMember: vi.fn(async () => ({
        id: 7,
        memberCode: 'JC-U-000007',
        phone: null,
        familyName: '山田',
        givenName: '太郎',
        email: 'taro@example.com',
        status: 'active' as const,
      })),
    }
    const legal: LegalDocumentRepository = {
      current: async (types) => types.map((type, i) => ({ id: i + 1, type, version: '1' })),
    }
    const grant = vi.fn(async () => 1)
    const coupons = {
      findByTrigger: async () => [{ couponId: 9 }],
      grant,
    } as unknown as CouponRepository
    const register = makeRegisterLineMember({
      creator,
      legalDocuments: legal,
      coupons,
      clock: { now: () => new Date('2026-10-17T00:00:00Z') },
      providerId: 'P1',
    })
    return { creator, legal, grant, register }
  }

  it('creates from verified LINE identity, snapshots all consent versions and recovers coupon grants idempotently', async () => {
    const w = world()
    expect(await w.register(line, input)).toEqual({ memberId: 7 })
    expect(w.creator.createLineMember).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'P1',
        lineUserId: 'U1',
        consentDocumentIds: [1, 2, 3],
        profile: expect.objectContaining({ email: 'taro@example.com' }),
      }),
    )
    await w.register(line, input)
    expect(w.grant.mock.calls.map((args) => args)).toHaveLength(2)
    expect(w.grant).toHaveBeenLastCalledWith(
      expect.objectContaining({ issuanceKey: 'registration:9:7' }),
    )
  })

  it('rejects missing email, missing consent and unpublished legal documents before creating an account', async () => {
    const w = world()
    await expect(w.register(line, { ...input, email: '' })).rejects.toMatchObject({
      code: 'email_required',
    })
    await expect(w.register(line, { ...input, agreesToTerms: false })).rejects.toMatchObject({
      code: 'terms_required',
    })
    w.legal.current = async () => []
    await expect(w.register(line, input)).rejects.toMatchObject({ code: 'legal_documents_missing' })
    expect(w.creator.createLineMember).not.toHaveBeenCalled()
  })
})
