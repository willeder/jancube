import { DomainError } from '../shared/errors'
import { assertYen, floorYen, type Yen } from '../shared/money'

/** One tax-rate line of a receipt (receipt_tax_lines). Prices are tax-inclusive. */
export interface TaxLine {
  readonly ratePercent: number
  /** Amount excluding tax (税抜対象額). */
  readonly taxable: Yen
  readonly tax: Yen
  /** Tax-inclusive amount (税込対象額) = taxable + tax. */
  readonly gross: Yen
}

/**
 * Splits a tax-inclusive amount into net and tax (内税). Tax is rounded down per receipt and rate
 * (e.g. 6,100円 at 10% → 5,546円 + 554円). The project-wide rounding rule is still open (Q-12).
 */
export function taxInclusiveBreakdown(gross: Yen, ratePercent: number): TaxLine {
  assertYen(gross, 'gross')
  if (!(ratePercent >= 0 && ratePercent <= 100)) {
    throw new DomainError('invalid_tax_rate', 'tax rate must be between 0 and 100')
  }
  const tax = floorYen((gross * ratePercent) / (100 + ratePercent))
  return { ratePercent, taxable: gross - tax, tax, gross }
}

export type ReceiptBookingStatus = 'draft' | 'confirmed' | 'completed' | 'canceled' | 'expired'

export type ReceiptAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_used_yet' | 'nothing_paid' | 'not_issuable' }

/**
 * C-19 / F-PAY-07: receipts are issued after use (利用後), or for the retained fee once a cancellation
 * is confirmed (キャンセル料発生). Before use nothing can be issued (tracker #18).
 */
export function receiptAvailability(input: {
  readonly status: ReceiptBookingStatus
  readonly end: Date
  readonly now: Date
  /** Paid minus refunded. */
  readonly netPaid: Yen
}): ReceiptAvailability {
  if (input.status === 'draft' || input.status === 'expired') {
    return { ok: false, reason: 'not_issuable' }
  }
  if (input.netPaid <= 0) return { ok: false, reason: 'nothing_paid' }
  if (input.status === 'confirmed' && input.end > input.now) {
    return { ok: false, reason: 'not_used_yet' }
  }
  return { ok: true }
}

/** Receipt number: booking code + issue sequence (re-issues get the next number). */
export function receiptNumber(bookingCode: string, sequence: number): string {
  return `${bookingCode}-R${sequence}`
}

const MAX_RECIPIENT = 100

/** 宛名: required, trimmed, at most 100 characters (receipts.recipient_name allows 200). */
export function normalizeRecipientName(input: string): string {
  const name = input.replace(/\s+/g, ' ').trim()
  if (!name) throw new DomainError('recipient_required', 'enter the recipient name')
  if (name.length > MAX_RECIPIENT) throw new DomainError('recipient_too_long', 'name is too long')
  return name
}
