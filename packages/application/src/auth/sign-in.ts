import {
  addMinutes,
  DomainError,
  type MemberProfileInput,
  maskPhone,
  normalizeJapaneseMobile,
  OTP_POLICY,
  signInCodeMessage,
  validateMemberProfile,
} from '@jancube/domain'
import type { CouponRepository } from '../ports/checkout'
import type { Clock } from '../ports/clock'
import type {
  AuthChallengeRepository,
  LegalDocumentRepository,
  MemberRecord,
  MemberRepository,
  RandomSource,
  SecretHasher,
} from '../ports/member-repository'
import type { SmsSender } from '../ports/messaging'

export interface SignInDeps {
  readonly challenges: AuthChallengeRepository
  readonly members: MemberRepository
  readonly legalDocuments: LegalDocumentRepository
  readonly sms: SmsSender
  readonly hasher: SecretHasher
  readonly random: RandomSource
  readonly clock: Clock
  /** When present, coupons with grant_trigger 'registration' are granted to new members. */
  readonly coupons?: CouponRepository
}

/** The code is bound to its challenge so a hash from one challenge cannot be replayed on another. */
const codeHash = (hasher: SecretHasher, publicId: string, code: string) =>
  hasher.hash(`${publicId}:${code}`)

/** C-05: send a 6-digit sign-in code by SMS (F-AUTH-01). */
export function makeSendSignInCode(deps: SignInDeps) {
  return async function sendSignInCode(phoneInput: string) {
    const phone = normalizeJapaneseMobile(phoneInput)
    const now = deps.clock.now()

    const latest = await deps.challenges.latestForPhone(phone)
    if (latest && latest.resendAfter > now) {
      throw new DomainError('resend_too_soon', 'please wait before requesting another code')
    }
    const recent = await deps.challenges.countCreatedSince(phone, addMinutes(now, -60))
    if (recent >= OTP_POLICY.maxSendsPerHour) {
      throw new DomainError('too_many_codes', 'too many codes requested; try again later')
    }

    const publicId = deps.random.token()
    const code = deps.random.digits(OTP_POLICY.digits)
    const resendAfter = new Date(now.getTime() + OTP_POLICY.resendAfterSeconds * 1000)
    await deps.challenges.create({
      publicId,
      phone,
      secretHash: await codeHash(deps.hasher, publicId, code),
      expiresAt: addMinutes(now, OTP_POLICY.validMinutes),
      resendAfter,
      maxAttempts: OTP_POLICY.maxAttempts,
    })
    const sent = await deps.sms.send({ to: phone, body: signInCodeMessage(code) })
    await deps.challenges.setProviderRequestId(publicId, sent.providerMessageId)
    return { challengeId: publicId, maskedPhone: maskPhone(phone), resendAfter }
  }
}

/** C-06 「コードを再送する」: a fresh code to the same number (same rate limits as C-05). */
export function makeResendSignInCode(deps: SignInDeps) {
  const sendSignInCode = makeSendSignInCode(deps)
  return async function resendSignInCode(challengeId: string) {
    const challenge = await deps.challenges.findByPublicId(challengeId)
    if (!challenge) throw new DomainError('challenge_not_found', 'start sign-in again')
    return sendSignInCode(challenge.phone)
  }
}

/** What C-06/C-07 show about the sign-in in progress. */
export function makeGetSignInChallenge(deps: SignInDeps) {
  return async function getSignInChallenge(challengeId: string | null | undefined) {
    const challenge = challengeId ? await deps.challenges.findByPublicId(challengeId) : null
    if (!challenge) throw new DomainError('challenge_not_found', 'start sign-in again')
    const now = deps.clock.now()
    return {
      maskedPhone: maskPhone(challenge.phone),
      status: challenge.status,
      resendAfter: challenge.resendAfter,
      /** C-07 is reachable only for a recently verified number that has no member yet. */
      canRegister:
        challenge.status === 'verified' &&
        challenge.memberId === null &&
        challenge.verifiedAt !== null &&
        addMinutes(challenge.verifiedAt, OTP_POLICY.registrationWindowMinutes) > now,
    }
  }
}

export type VerifyResult =
  | { readonly kind: 'member'; readonly memberId: number }
  | { readonly kind: 'new_member'; readonly challengeId: string }

/** C-06: check the code. Existing members are signed in; new numbers continue to C-07 (F-AUTH-02). */
export function makeVerifySignInCode(deps: SignInDeps) {
  return async function verifySignInCode(challengeId: string, code: string): Promise<VerifyResult> {
    const now = deps.clock.now()
    const challenge = await deps.challenges.findByPublicId(challengeId)
    if (!challenge) throw new DomainError('challenge_not_found', 'start sign-in again')
    if (challenge.status === 'locked') throw new DomainError('code_locked', 'too many wrong codes')
    if (challenge.status !== 'pending' || challenge.expiresAt <= now) {
      throw new DomainError('code_expired', 'the code has expired')
    }

    const normalized = code.replace(/\s/g, '')
    const matches =
      /^\d+$/.test(normalized) &&
      (await codeHash(deps.hasher, challengeId, normalized)) === challenge.secretHash
    if (!matches) {
      const lock = challenge.attemptCount + 1 >= challenge.maxAttempts
      await deps.challenges.recordFailure(challengeId, lock)
      throw new DomainError(lock ? 'code_locked' : 'invalid_code', 'the code is incorrect')
    }

    const member = await deps.members.findByPhone(challenge.phone)
    if (member) assertCanBook(member)
    await deps.challenges.markVerified(challengeId, now, member?.id ?? null)
    return member ? { kind: 'member', memberId: member.id } : { kind: 'new_member', challengeId }
  }
}

/** C-07: create the member for a verified phone number and record consents (F-AUTH-03). */
export function makeRegisterMember(deps: SignInDeps) {
  return async function registerMember(
    challengeId: string,
    input: MemberProfileInput & { registrationSource?: string | null; channel?: 'web' | 'liff' },
  ): Promise<{ memberId: number }> {
    const now = deps.clock.now()
    const challenge = await deps.challenges.findByPublicId(challengeId)
    if (
      challenge?.status !== 'verified' ||
      !challenge.verifiedAt ||
      addMinutes(challenge.verifiedAt, OTP_POLICY.registrationWindowMinutes) <= now
    ) {
      throw new DomainError('verification_required', 'verify your phone number again')
    }
    const profile = validateMemberProfile(input)

    const existing = await deps.members.findByPhone(challenge.phone)
    if (existing) return { memberId: existing.id }

    const documents = await deps.legalDocuments.current(
      ['terms', 'privacy', 'age_declaration'],
      now,
    )
    if (documents.length < 3)
      throw new DomainError('legal_documents_missing', 'terms are not published')

    const member = await deps.members.createPhoneMember({
      phone: challenge.phone,
      phoneVerifiedAt: challenge.verifiedAt,
      profile,
      registrationSource: input.registrationSource ?? null,
      consentDocumentIds: documents.map((d) => d.id),
      consentedAt: now,
      channel: input.channel ?? 'web',
    })
    await deps.challenges.linkMember(challengeId, member.id)
    for (const coupon of (await deps.coupons?.findByTrigger('registration', now)) ?? []) {
      await deps.coupons?.grant({
        memberId: member.id,
        coupon,
        issuanceKey: `registration:${coupon.couponId}:${member.id}`,
        grantedAt: now,
      })
    }
    return { memberId: member.id }
  }
}

/** Suspended or withdrawn members cannot book (F-AUTH-08). */
export function assertCanBook(member: MemberRecord): void {
  if (member.status === 'suspended' || member.status === 'withdrawn') {
    throw new DomainError('member_cannot_book', 'this account cannot make bookings')
  }
}
