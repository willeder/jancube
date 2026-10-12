import type { E164, MemberProfile } from '@jancube/domain'

export type MemberStatus = 'active' | 'caution' | 'suspended' | 'withdrawn'

export interface MemberRecord {
  readonly id: number
  readonly memberCode: string
  readonly phone: E164 | null
  readonly familyName: string | null
  readonly givenName: string | null
  readonly email: string | null
  readonly status: MemberStatus
}

export interface MemberRepository {
  findById(id: number): Promise<MemberRecord | null>
  findByPhone(phone: E164): Promise<MemberRecord | null>
  /** Creates a phone-verified member and records consent to the given legal document versions. */
  createPhoneMember(input: {
    readonly phone: E164
    readonly phoneVerifiedAt: Date
    readonly profile: MemberProfile
    readonly registrationSource: string | null
    readonly consentDocumentIds: readonly number[]
    readonly consentedAt: Date
    readonly channel: 'web' | 'liff'
  }): Promise<MemberRecord>
}

export type LegalDocumentType = 'terms' | 'privacy' | 'cancellation_policy' | 'age_declaration'

export interface LegalDocumentRepository {
  /** Latest version of each type effective at `at`. */
  current(
    types: readonly LegalDocumentType[],
    at: Date,
  ): Promise<{ id: number; type: LegalDocumentType; version: string }[]>
}

export type ChallengeStatus = 'pending' | 'verified' | 'expired' | 'locked'

export interface AuthChallenge {
  readonly publicId: string
  readonly phone: E164
  readonly status: ChallengeStatus
  readonly secretHash: string
  readonly expiresAt: Date
  readonly verifiedAt: Date | null
  readonly attemptCount: number
  readonly maxAttempts: number
  readonly resendAfter: Date
  readonly memberId: number | null
}

export interface AuthChallengeRepository {
  create(challenge: {
    readonly publicId: string
    readonly phone: E164
    readonly secretHash: string
    readonly expiresAt: Date
    readonly resendAfter: Date
    readonly maxAttempts: number
  }): Promise<void>
  findByPublicId(publicId: string): Promise<AuthChallenge | null>
  latestForPhone(phone: E164): Promise<AuthChallenge | null>
  countCreatedSince(phone: E164, since: Date): Promise<number>
  recordFailure(publicId: string, lock: boolean): Promise<void>
  markVerified(publicId: string, at: Date, memberId: number | null): Promise<void>
  linkMember(publicId: string, memberId: number): Promise<void>
  setProviderRequestId(publicId: string, providerRequestId: string): Promise<void>
}

/** Keyed one-way hash for sign-in codes (the code itself is never stored). */
export interface SecretHasher {
  hash(secret: string): Promise<string>
}

export interface RandomSource {
  /** Uniformly random decimal digits. */
  digits(count: number): string
  /** Unguessable identifier (≥128 bits). */
  token(): string
}
