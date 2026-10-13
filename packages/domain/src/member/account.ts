import { DomainError } from '../shared/errors'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** C-17: the optional email address (lower-cased; empty clears it). Same rules as registration. */
export function normalizeOptionalEmail(input: string | null | undefined): string | null {
  const email = input?.trim().toLowerCase() || null
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) {
    throw new DomainError('invalid_email', 'enter a valid email address')
  }
  return email
}

/**
 * F-AUTH-07 退会: not possible while the member still has upcoming confirmed bookings (they must be
 * used or cancelled first, so refunds and notifications still reach the customer).
 */
export function assertCanWithdraw(upcomingBookings: number): void {
  if (upcomingBookings > 0) {
    throw new DomainError('withdrawal_blocked', 'cancel or finish upcoming bookings first')
  }
}
