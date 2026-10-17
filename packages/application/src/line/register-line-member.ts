import { DomainError, type MemberProfileInput, validateMemberProfile } from '@jancube/domain'
import { assertCanBook } from '../auth/sign-in'
import type { CouponRepository } from '../ports/checkout'
import type { Clock } from '../ports/clock'
import type { LineMemberCreator } from '../ports/line'
import type { LegalDocumentRepository } from '../ports/member-repository'
import type { VerifiedLineUser } from './line-account'

/** Registration from a server-verified LINE identity; phone verification is never required. */
export function makeRegisterLineMember(deps: {
  creator: LineMemberCreator
  legalDocuments: LegalDocumentRepository
  coupons: CouponRepository
  clock: Clock
  providerId: string
}) {
  return async (line: VerifiedLineUser, input: MemberProfileInput) => {
    const profile = validateMemberProfile(input)
    const now = deps.clock.now()
    const documents = await deps.legalDocuments.current(
      ['terms', 'privacy', 'age_declaration'],
      now,
    )
    if (documents.length !== 3)
      throw new DomainError('legal_documents_missing', 'terms are not published')
    const member = await deps.creator.createLineMember({
      providerId: deps.providerId,
      lineUserId: line.lineUserId,
      friendStatus: line.friendStatus,
      profile,
      consentDocumentIds: documents.map((d) => d.id),
      at: now,
    })
    assertCanBook(member)
    // Idempotent grants also recover a registration interrupted after the member transaction committed.
    for (const coupon of await deps.coupons.findByTrigger('registration', now)) {
      await deps.coupons.grant({
        memberId: member.id,
        coupon,
        issuanceKey: `registration:${coupon.couponId}:${member.id}`,
        grantedAt: now,
      })
    }
    return { memberId: member.id }
  }
}
