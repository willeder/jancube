import {
  addDays,
  DomainError,
  type LocalDate,
  localToUtc,
  parseLocalDate,
  type StaffAccess,
  utcToLocal,
} from '@jancube/domain'
import type { PaymentHistoryRepository } from '../ports/admin-bookings'
import type { CheckoutRepository, PaymentGateway } from '../ports/checkout'
import type { Clock } from '../ports/clock'
import type { AlertRepository, AuditLog } from '../ports/ops'
import { assertStoreAccess, staffActor, storeFilter } from './access'
import { monthRange } from './dashboard'

export interface PaymentHistoryDeps {
  readonly history: PaymentHistoryRepository
  readonly checkouts: CheckoutRepository
  readonly gateway: PaymentGateway
  readonly alerts: AlertRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

/** Business timezone for date filters on A-26 (all stores are in Japan). */
const TIMEZONE = 'Asia/Tokyo'

/** A-26 決済・返金履歴: payments and refunds in a date range (default: this month). */
export function makeListPaymentHistory(deps: PaymentHistoryDeps) {
  return async function listPaymentHistory(
    access: StaffAccess,
    selectedStoreId: number | null,
    filter: {
      from?: string | null
      to?: string | null
      kind?: string | null
      method?: string | null
      status?: string | null
    },
  ) {
    const stores = storeFilter(access, 'payments.view', selectedStoreId)
    const today = utcToLocal(deps.clock.now(), TIMEZONE).date
    const month = monthRange(today)
    const from: LocalDate = filter.from || month.first
    const to: LocalDate = filter.to || month.last
    parseLocalDate(from)
    parseLocalDate(to)
    const range = {
      from: localToUtc(from, 0, TIMEZONE),
      to: localToUtc(addDays(to, 1), 0, TIMEZONE),
    }
    const monthRangeUtc = {
      from: localToUtc(month.first, 0, TIMEZONE),
      to: localToUtc(addDays(month.last, 1), 0, TIMEZONE),
    }
    const [rows, totals] = await Promise.all([
      deps.history.list({
        stores,
        ...range,
        kind: filter.kind === 'payment' || filter.kind === 'refund' ? filter.kind : null,
        method: filter.method === 'card' || filter.method === 'paypay' ? filter.method : null,
        status: filter.status?.trim() || null,
        limit: 300,
      }),
      deps.history.totals(stores, monthRangeUtc.from, monthRangeUtc.to),
    ])
    return { from, to, rows, totals }
  }
}

/**
 * A-26 「返金を再実行」: retries a failed refund with its original idempotency key, so the payment
 * provider never refunds twice even if an earlier attempt actually went through.
 */
export function makeRetryRefund(deps: PaymentHistoryDeps) {
  return async function retryRefund(access: StaffAccess, refundId: number) {
    const refund = await deps.history.findRefund(refundId)
    if (!refund) throw new DomainError('refund_not_found', 'refund not found')
    assertStoreAccess(access, 'bookings.cancel', refund.storeId)
    if (refund.status !== 'failed' && refund.status !== 'requested') {
      throw new DomainError('refund_not_retryable', `refund is ${refund.status}`)
    }
    const now = deps.clock.now()
    let error: string | null = null
    try {
      if (!refund.externalPaymentId) throw new Error('payment has no provider reference')
      const result = await deps.gateway.refund({
        externalPaymentId: refund.externalPaymentId,
        amount: refund.amount,
        idempotencyKey: refund.idempotencyKey,
      })
      await deps.checkouts.finishRefund(refund.id, {
        externalRefundId: result.refundId,
        at: deps.clock.now(),
      })
      await deps.alerts.resolve(`refund_failed:${refund.id}`, now)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      await deps.checkouts.finishRefund(refund.id, { error })
      await deps.alerts.raise({
        alertKey: `refund_failed:${refund.id}`,
        alertType: 'refund_failed',
        severity: 'critical',
        failureReason: `返金に失敗しました: ${error}`.slice(0, 2000),
        recoverySteps:
          '決済・返金履歴(A-26)から再実行してください。解消しない場合は決済事業者の管理画面で返金状況を確認してください。',
        storeId: refund.storeId,
        bookingId: refund.bookingId,
        paymentId: refund.paymentId,
        detectedAt: now,
      })
    }
    await deps.audit.record({
      actor: staffActor(access),
      action: 'refund.retry',
      targetType: 'refund',
      targetId: refund.id,
      targetCode: refund.bookingCode,
      storeId: refund.storeId,
      before: { status: refund.status },
      after: { status: error ? 'failed' : 'succeeded', amount: refund.amount },
      reason: error,
    })
    return { ok: error === null, error }
  }
}
