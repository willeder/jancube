import { DomainError } from '../shared/errors'
import { normalizeRequiredEmail } from './account'

export interface MemberProfileInput {
  readonly familyName: string
  readonly givenName: string
  readonly email?: string | null
  readonly agreesToTerms: boolean
  readonly confirmsAdult: boolean
}

export interface MemberProfile {
  readonly familyName: string
  readonly givenName: string
  /** Required and lower-cased for all new registrations; nullable only for legacy records. */
  readonly email: string | null
}

const MAX_NAME = 100
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * C-07 会員登録. Names are normally real names (nicknames tolerated, 2026-10-01 minutes); customers
 * cannot change them later. Terms/privacy consent and the 18+ declaration are required.
 */
export function validateMemberProfile(input: MemberProfileInput): MemberProfile {
  const familyName = input.familyName.trim()
  const givenName = input.givenName.trim()
  if (!familyName || !givenName)
    throw new DomainError('name_required', 'enter your family and given name')
  if (familyName.length > MAX_NAME || givenName.length > MAX_NAME) {
    throw new DomainError('name_too_long', 'name is too long')
  }
  const email = normalizeRequiredEmail(input.email)
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) {
    throw new DomainError('invalid_email', 'enter a valid email address')
  }
  if (!input.agreesToTerms)
    throw new DomainError('terms_required', 'agree to the terms and privacy policy')
  if (!input.confirmsAdult) throw new DomainError('adult_required', 'customers must be 18 or older')
  return { familyName, givenName, email }
}
