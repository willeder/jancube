import {
  DomainError,
  normalizeRecipientName,
  receiptAvailability,
  taxInclusiveBreakdown,
} from '@jancube/domain'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import type { ReceiptIssuer, ReceiptRepository, ReceiptSource } from '../ports/receipts'

export interface ReceiptDeps {
  readonly receipts: ReceiptRepository
  readonly issuer: (storeName: string) => ReceiptIssuer
  readonly audit: AuditLog
  readonly clock: Clock
}

async function ownedSource(
  deps: ReceiptDeps,
  bookingCode: string,
  memberId: number,
): Promise<ReceiptSource> {
  const source = await deps.receipts.source(bookingCode)
  if (!source || source.memberId !== memberId) {
    throw new DomainError('booking_not_found', 'booking not found')
  }
  return source
}

function availability(source: ReceiptSource, now: Date) {
  return receiptAvailability({
    status: source.status,
    end: source.end,
    now,
    netPaid: source.paid - source.refunded,
  })
}

/** C-19 領収書: whether one can be issued, and the receipt currently issued (if any). */
export function makeGetMyReceipt(deps: ReceiptDeps) {
  return async function getMyReceipt(bookingCode: string, memberId: number) {
    const source = await ownedSource(deps, bookingCode, memberId)
    return {
      source,
      amount: source.paid - source.refunded,
      availability: availability(source, deps.clock.now()),
      receipt: await deps.receipts.current(source.bookingId),
    }
  }
}

/**
 * C-19 / F-PAY-07: issue (or re-issue, 再発行) a receipt for the amount actually kept: payments minus
 * refunds (after use, or the cancellation fee). Prices are tax-inclusive at the booking's tax rate.
 */
export function makeIssueMyReceipt(deps: ReceiptDeps) {
  return async function issueMyReceipt(input: {
    readonly bookingCode: string
    readonly memberId: number
    readonly recipientName: string
  }) {
    const source = await ownedSource(deps, input.bookingCode, input.memberId)
    const now = deps.clock.now()
    const allowed = availability(source, now)
    if (!allowed.ok || source.paymentId === null) {
      throw new DomainError('receipt_not_available', allowed.ok ? 'nothing_paid' : allowed.reason)
    }
    const recipientName = normalizeRecipientName(input.recipientName)
    const amount = source.paid - source.refunded
    const receipt = await deps.receipts.issue({
      bookingId: source.bookingId,
      bookingCode: source.bookingCode,
      paymentId: source.paymentId,
      recipientName,
      issuer: deps.issuer(source.storeName),
      lines: [taxInclusiveBreakdown(amount, source.taxRatePercent)],
      issuedAt: now,
    })
    await deps.audit.record({
      actor: { type: 'member', memberId: input.memberId },
      action: 'receipt.issue',
      targetType: 'receipt',
      targetId: receipt.id,
      targetCode: receipt.receiptNumber,
      after: { bookingCode: source.bookingCode, total: receipt.total, sequence: receipt.sequence },
    })
    return receipt
  }
}
