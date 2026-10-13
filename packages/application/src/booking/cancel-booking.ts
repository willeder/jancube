import {
  calculateCancellationFee,
  DomainError,
  floorYen,
  isDateChangeAllowed,
} from '@jancube/domain'
import type { BookingRepository, BookingSummary } from '../ports/booking-repository'
import type { CheckoutRepository, PaymentGateway } from '../ports/checkout'
import type { Clock } from '../ports/clock'
import type { LegalDocumentRepository } from '../ports/member-repository'
import type { Actor, AuditLog } from '../ports/ops'

export interface CancelDeps {
  readonly bookings: BookingRepository
  readonly checkouts: CheckoutRepository
  readonly gateway: PaymentGateway
  readonly legalDocuments: LegalDocumentRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

export interface CancellationQuote {
  readonly booking: BookingSummary
  readonly paid: number
  readonly feeRate: number
  readonly fee: number
  readonly refund: number
  /** Date changes are allowed only while cancellation is free (C-14 rule). */
  readonly changeAllowed: boolean
}

async function loadCancellable(deps: CancelDeps, bookingCode: string) {
  const booking = await deps.bookings.findByCode(bookingCode)
  if (!booking) throw new DomainError('booking_not_found', 'booking not found')
  if (booking.status !== 'confirmed') {
    throw new DomainError('booking_not_cancellable', `booking is ${booking.status}`)
  }
  const payments = await deps.checkouts.refundablePayments(booking.id)
  const paid = payments.reduce((sum, p) => sum + p.refundable, 0)
  return { booking, payments, paid }
}

/** C-15 / A-08: the fee and refund if the booking were cancelled now (FR-2.9). */
export function makeQuoteCancellation(deps: CancelDeps) {
  return async function quoteCancellation(bookingCode: string): Promise<CancellationQuote> {
    const { booking, paid } = await loadCancellable(deps, bookingCode)
    const now = deps.clock.now()
    const fee = calculateCancellationFee({
      startAt: booking.start,
      cancelledAt: now,
      paidAmount: paid,
    })
    return {
      booking,
      paid,
      feeRate: fee.percent,
      fee: fee.fee,
      refund: fee.refund,
      changeAllowed: isDateChangeAllowed(booking.start, now),
    }
  }
}

export interface CancelInput {
  readonly bookingCode: string
  readonly actor: Actor
  /** Members may only cancel their own bookings. */
  readonly memberId?: number
  /** Staff override of the fee rate (A-08); requires a reason. */
  readonly overrideFeeRate?: number | null
  readonly reason?: string | null
}

/**
 * C-15 / A-08: cancel, record the fee, free the time, and refund the rest to the original payment.
 * Coupons are returned only when the cancellation is free (F-CPN-09 "戻し" is provisional).
 */
export function makeCancelBooking(deps: CancelDeps) {
  return async function cancelBooking(input: CancelInput) {
    const { booking, payments, paid } = await loadCancellable(deps, input.bookingCode)
    if (input.memberId !== undefined && booking.memberId !== input.memberId) {
      throw new DomainError('booking_not_found', 'booking not found')
    }
    const now = deps.clock.now()
    const automatic = calculateCancellationFee({
      startAt: booking.start,
      cancelledAt: now,
      paidAmount: paid,
    })
    const override = input.overrideFeeRate ?? null
    if (override !== null) {
      if (input.actor.type !== 'staff')
        throw new DomainError('forbidden', 'only staff can override')
      if (!(override >= 0 && override <= 100)) {
        throw new DomainError('invalid_fee_rate', 'fee rate must be between 0 and 100')
      }
      if (!input.reason?.trim()) throw new DomainError('reason_required', 'enter a reason')
    }
    const feeRate = override ?? automatic.percent
    const fee = override === null ? automatic.fee : floorYen((paid * override) / 100)
    const refund = paid - fee

    const [policy] = await deps.legalDocuments.current(['cancellation_policy'], now)
    if (!policy) throw new DomainError('legal_documents_missing', 'cancellation policy missing')

    const { cancellationId } = await deps.bookings.withInventoryLock(
      booking.roomGroupId,
      booking.businessDate,
      (tx) =>
        tx.cancel({
          bookingId: booking.id,
          policyDocumentId: policy.id,
          requestedAt: now,
          automaticFeeRate: automatic.percent,
          appliedFeeRate: feeRate,
          paidAmount: paid,
          feeAmount: fee,
          refundAmount: refund,
          reason: input.reason?.trim() || null,
          staffId: input.actor.type === 'staff' ? input.actor.staffId : null,
          manualOverride: override !== null,
          reverseCoupon: feeRate === 0,
        }),
    )
    await deps.audit.record({
      actor: input.actor,
      action: 'booking.cancel',
      targetType: 'booking',
      targetId: booking.id,
      targetCode: booking.bookingCode,
      storeId: booking.storeId,
      after: { paid, feeRate, fee, refund, manualOverride: override !== null },
      reason: input.reason ?? null,
    })

    // Refund across the booking's payments, newest first.
    let remaining = refund
    let refundFailed = false
    for (const payment of payments) {
      if (remaining <= 0) break
      const amount = Math.min(remaining, payment.refundable)
      if (amount <= 0) continue
      remaining -= amount
      const idempotencyKey = `cancel:${cancellationId}:${payment.paymentId}`
      const refundId = await deps.checkouts.createRefund({
        paymentId: payment.paymentId,
        bookingId: booking.id,
        cancellationId,
        amount,
        reason: 'booking cancellation',
        idempotencyKey,
        requestedBy: input.actor.type === 'staff' ? input.actor.staffId : null,
      })
      try {
        if (!payment.externalPaymentId) throw new Error('payment has no provider reference')
        const result = await deps.gateway.refund({
          externalPaymentId: payment.externalPaymentId,
          amount,
          idempotencyKey,
        })
        await deps.checkouts.finishRefund(refundId, {
          externalRefundId: result.refundId,
          at: deps.clock.now(),
        })
      } catch (error) {
        refundFailed = true
        await deps.checkouts.finishRefund(refundId, { error: String(error) })
      }
    }
    return { cancellationId, paid, feeRate, fee, refund, refundFailed }
  }
}
