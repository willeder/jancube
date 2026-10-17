import {
  addMinutes,
  type CouponRejection,
  canAccommodate,
  createTimeRange,
  DomainError,
  evaluateCoupon,
  minuteOfBusinessDay,
  normalizeRequiredEmail,
  weekdayOf,
} from '@jancube/domain'
import { assertCanBook } from '../auth/sign-in'
import { buildLanes, laneLoad } from '../booking/booking-context'
import { makeGetActiveHold } from '../booking/hold'
import type { BookingRepository, BookingSummary } from '../ports/booking-repository'
import type {
  CheckoutRecord,
  CheckoutRepository,
  CouponOffer,
  CouponRepository,
  PaymentEvent,
  PaymentGateway,
  PaymentMethod,
  WebhookRepository,
} from '../ports/checkout'
import type { Clock } from '../ports/clock'
import type { LegalDocumentRepository, MemberRepository } from '../ports/member-repository'
import type { StoreRepository } from '../ports/store-repository'

export interface CheckoutDeps {
  readonly bookings: BookingRepository
  readonly checkouts: CheckoutRepository
  readonly coupons: CouponRepository
  readonly members: MemberRepository
  readonly stores: StoreRepository
  readonly legalDocuments: LegalDocumentRepository
  readonly gateway: PaymentGateway
  readonly webhooks: WebhookRepository
  readonly clock: Clock
  readonly newKey: () => string
}

/**
 * Stripe Checkout sessions live at least 30 minutes, longer than the 10-minute hold. The jobs worker
 * expires sessions of lapsed holds; a payment that still lands late is confirmed if the time is free,
 * otherwise refunded automatically.
 */
const CHECKOUT_LIFETIME_MINUTES = 30

export interface CouponChoice {
  readonly grantId: number
  readonly couponName: string
  readonly conditionsNote: string | null
  readonly expiresAt: Date
  readonly discount: number | null
  readonly rejection: CouponRejection | null
}

async function requireMemberHold(
  deps: Pick<CheckoutDeps, 'bookings' | 'clock'>,
  requestKey: string | null,
  memberId: number,
): Promise<BookingSummary> {
  const hold = await makeGetActiveHold(deps)(requestKey)
  if (hold.memberId !== memberId) {
    throw new DomainError('verification_required', 'sign in to continue this booking')
  }
  return hold
}

function evaluateFor(hold: BookingSummary, offer: CouponOffer, at: Date) {
  return evaluateCoupon(offer.terms, {
    at,
    storeId: hold.storeId,
    roomTypeId: hold.roomTypeId,
    startWeekday: weekdayOf(hold.businessDate),
    startMinute: minuteOfBusinessDay(hold.businessDate, hold.start, hold.timezone),
    subtotal: hold.subtotal,
  })
}

/** C-09: the hold plus the member's coupons, best applicable first (F-CPN-08). */
export function makeGetPaymentOptions(deps: CheckoutDeps) {
  return async function getPaymentOptions(requestKey: string | null, memberId: number) {
    const hold = await requireMemberHold(deps, requestKey, memberId)
    const now = deps.clock.now()
    const offers = await deps.coupons.usableGrants(memberId, now, hold.id)
    const coupons: CouponChoice[] = offers
      .map((offer) => {
        const result = evaluateFor(hold, offer, now)
        return {
          grantId: offer.grantId,
          couponName: offer.couponName,
          conditionsNote: offer.conditionsNote,
          expiresAt: offer.expiresAt,
          discount: result.ok ? result.discount : null,
          rejection: result.ok ? null : result.reason,
        }
      })
      .sort(
        (a, b) =>
          (b.discount ?? -1) - (a.discount ?? -1) || a.expiresAt.getTime() - b.expiresAt.getTime(),
      )
    const best = coupons[0]?.discount ? coupons[0].grantId : null
    return { hold, coupons, bestGrantId: best }
  }
}

/** C-09 「クーポンコードをお持ちの方」: claim a coupon by its code; returns the member's grant. */
export function makeClaimCouponCode(deps: Pick<CheckoutDeps, 'coupons' | 'clock'>) {
  return async function claimCouponCode(memberId: number, code: string): Promise<number> {
    const normalized = code.trim().toUpperCase()
    if (!normalized) throw new DomainError('coupon_not_found', 'enter a coupon code')
    const coupon = await deps.coupons.findClaimableByCode(normalized, deps.clock.now())
    if (!coupon) throw new DomainError('coupon_not_found', 'this coupon code is not valid')
    return deps.coupons.grant({
      memberId,
      coupon,
      issuanceKey: `code:${coupon.couponId}:${memberId}`,
      grantedAt: deps.clock.now(),
    })
  }
}

export type StartCheckoutResult =
  | { readonly kind: 'redirect'; readonly url: string }
  /** Nothing to pay (coupon covers the whole price): the booking is already confirmed. */
  | { readonly kind: 'confirmed' }

/** C-09 「〇〇円を支払う」 → C-10: price the booking with the chosen coupon and open the payment page. */
export function makeStartCheckout(deps: CheckoutDeps) {
  const confirmFree = makeConfirmWithoutPayment(deps)
  return async function startCheckout(input: {
    readonly requestKey: string | null
    readonly memberId: number
    readonly grantId: number | null
    readonly method: PaymentMethod
    readonly successUrl: string
    readonly cancelUrl: string
  }): Promise<StartCheckoutResult> {
    const hold = await requireMemberHold(deps, input.requestKey, input.memberId)
    const member = await deps.members.findById(input.memberId)
    if (!member) throw new DomainError('member_not_found', 'sign in again')
    assertCanBook(member)
    normalizeRequiredEmail(member.email)
    const now = deps.clock.now()

    let coupon: { grantId: number; discount: number } | null = null
    if (input.grantId !== null) {
      const offers = await deps.coupons.usableGrants(input.memberId, now, hold.id)
      const offer = offers.find((o) => o.grantId === input.grantId)
      if (!offer) throw new DomainError('coupon_not_applicable', 'this coupon cannot be used')
      const result = evaluateFor(hold, offer, now)
      if (!result.ok) throw new DomainError('coupon_not_applicable', result.reason)
      coupon = { grantId: offer.grantId, discount: result.discount }
    }

    const [policy] = await deps.legalDocuments.current(['cancellation_policy'], now)
    if (!policy) throw new DomainError('legal_documents_missing', 'cancellation policy missing')

    for (const checkoutId of await deps.checkouts.pendingCheckoutIds(hold.id)) {
      await deps.gateway.expireCheckout(checkoutId).catch(() => {})
    }
    const willPay = hold.subtotal - (coupon?.discount ?? 0) > 0
    const idempotencyKey = deps.newKey()
    const prepared = await deps.checkouts.prepare({
      bookingId: hold.id,
      coupon,
      policyDocumentId: policy.id,
      agreedAt: now,
      payment: willPay
        ? {
            provider: deps.gateway.provider,
            environment: deps.gateway.environment,
            accountId: deps.gateway.accountId,
            idempotencyKey,
            method: input.method,
          }
        : null,
    })
    if (prepared.paymentId === null) {
      await confirmFree(hold)
      return { kind: 'confirmed' }
    }

    const session = await deps.gateway.createCheckout({
      idempotencyKey,
      amount: prepared.total,
      method: input.method,
      description: `雀CUBE ${hold.storeName} ${hold.bookingCode}`,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      expiresAt: addMinutes(now, CHECKOUT_LIFETIME_MINUTES),
      customerEmail: member?.email ?? null,
      metadata: { booking_code: hold.bookingCode, payment_id: String(prepared.paymentId) },
    })
    await deps.checkouts.attachCheckout(prepared.paymentId, session.checkoutId)
    return { kind: 'redirect', url: session.url }
  }
}

function makeConfirmWithoutPayment(deps: CheckoutDeps) {
  return async function confirmWithoutPayment(hold: BookingSummary) {
    await deps.bookings.withInventoryLock(hold.roomGroupId, hold.businessDate, async (tx) => {
      const state = await tx.bookingState(hold.id)
      const now = deps.clock.now()
      if (state.status !== 'draft' || !state.holdExpiresAt || state.holdExpiresAt <= now) {
        throw new DomainError('hold_expired', 'the hold has expired')
      }
      await tx.confirm({ bookingId: hold.id, paymentId: null, externalPaymentId: null, at: now })
    })
  }
}

export type ConfirmResult = 'confirmed' | 'already_confirmed' | 'refunded'

/**
 * Payment completed (webhook or return from C-10). Idempotent. The booking is confirmed if the hold is
 * still valid, or — for a late payment — if the time is still free; otherwise the money is refunded.
 */
export function makeConfirmCheckout(deps: CheckoutDeps) {
  return async function confirmCheckout(
    checkoutId: string,
    paid: { externalPaymentId: string | null; amount: number },
  ): Promise<ConfirmResult> {
    const record = await deps.checkouts.findByCheckout(checkoutId)
    if (!record) throw new DomainError('payment_not_found', 'unknown checkout')
    if (record.status === 'succeeded') return 'already_confirmed'
    if (paid.amount !== record.amount) {
      throw new Error(`payment ${record.paymentId}: paid ${paid.amount}, expected ${record.amount}`)
    }

    const outcome = await deps.bookings.withInventoryLock(
      record.roomGroupId,
      record.businessDate,
      async (tx) => {
        const now = deps.clock.now()
        const state = await tx.bookingState(record.bookingId)
        const holdValid =
          state.status === 'draft' && state.holdExpiresAt !== null && state.holdExpiresAt > now
        const stillFree =
          holdValid ||
          ((state.status === 'draft' || state.status === 'expired') &&
            (await isStillFree(deps, tx, record, now)))
        if (stillFree) {
          await tx.confirm({
            bookingId: record.bookingId,
            paymentId: record.paymentId,
            externalPaymentId: paid.externalPaymentId,
            at: now,
          })
          return { kind: 'confirmed' as const }
        }
        const refund = await tx.recordUnconfirmablePayment({
          bookingId: record.bookingId,
          paymentId: record.paymentId,
          externalPaymentId: paid.externalPaymentId,
          at: now,
          reason:
            state.status === 'confirmed'
              ? 'duplicate payment for a confirmed booking'
              : 'paid after the hold expired and the time was taken',
        })
        return { kind: 'refund' as const, ...refund }
      },
    )
    if (outcome.kind === 'confirmed') return 'confirmed'

    try {
      if (!paid.externalPaymentId) throw new Error('no external payment id to refund')
      const { refundId } = await deps.gateway.refund({
        externalPaymentId: paid.externalPaymentId,
        amount: record.amount,
        idempotencyKey: outcome.idempotencyKey,
      })
      await deps.checkouts.finishRefund(outcome.refundId, {
        externalRefundId: refundId,
        at: deps.clock.now(),
      })
    } catch (error) {
      // Left as a failed refund for staff follow-up (A-26) rather than failing the webhook.
      await deps.checkouts.finishRefund(outcome.refundId, { error: String(error) })
    }
    return 'refunded'
  }
}

async function isStillFree(
  deps: Pick<CheckoutDeps, 'stores'>,
  tx: Parameters<Parameters<BookingRepository['withInventoryLock']>[2]>[0],
  record: CheckoutRecord,
  now: Date,
): Promise<boolean> {
  const store = await deps.stores.findActiveByCode(record.storeCode)
  if (!store) return false
  const range = createTimeRange(record.start, record.end)
  const inventory = await tx.loadInventory(store.id, range.start, range.end, now)
  const lane = buildLanes(inventory).find((l) =>
    record.requestedRoomId !== null
      ? l.room?.id === record.requestedRoomId
      : l.kind === 'group' && l.group.id === record.roomGroupId,
  )
  if (!lane) return false
  return canAccommodate(laneLoad(inventory, lane, store.booking.cleaningBufferMinutes), range)
}

/** Payment page abandoned, failed or expired: release the coupon; the hold expires on its own. */
export function makeFailCheckout(deps: Pick<CheckoutDeps, 'checkouts'>) {
  return async function failCheckout(checkoutId: string, reason: string): Promise<void> {
    const record = await deps.checkouts.findByCheckout(checkoutId)
    if (!record || record.status === 'succeeded') return
    await deps.checkouts.cancelPayment(record.paymentId, 'canceled', reason)
  }
}

/** C-10 return URL: ask the provider directly, so confirmation does not wait for the webhook. */
export function makeSyncCheckout(deps: CheckoutDeps) {
  const confirmCheckout = makeConfirmCheckout(deps)
  return async function syncCheckout(checkoutId: string): Promise<ConfirmResult | 'pending'> {
    const record = await deps.checkouts.findByCheckout(checkoutId)
    if (!record) throw new DomainError('payment_not_found', 'unknown checkout')
    if (record.status === 'succeeded') return 'already_confirmed'
    const state = await deps.gateway.getCheckout(checkoutId)
    if (!state.paid) return 'pending'
    return confirmCheckout(checkoutId, {
      externalPaymentId: state.externalPaymentId,
      amount: state.amount,
    })
  }
}

/** Webhook endpoint: verify, de-duplicate, then confirm or release (C-10, A-25). */
export function makeHandlePaymentWebhook(deps: CheckoutDeps) {
  const confirmCheckout = makeConfirmCheckout(deps)
  const failCheckout = makeFailCheckout(deps)
  return async function handlePaymentWebhook(rawBody: string, signature: string | null) {
    const event = await deps.gateway.parseWebhook(rawBody, signature)
    const stored = await deps.webhooks.record({
      provider: deps.gateway.provider,
      environment: deps.gateway.environment,
      accountId: deps.gateway.accountId,
      eventId: event.eventId,
      eventType: event.eventType,
      payloadSha256: event.payloadSha256,
      redacted: redact(event),
      receivedAt: deps.clock.now(),
    })
    if (stored.duplicate && stored.processed) return { status: 'duplicate' as const }
    try {
      if (event.kind === 'checkout_paid') {
        await confirmCheckout(event.checkoutId, {
          externalPaymentId: event.externalPaymentId,
          amount: event.amount,
        })
      } else if (event.kind === 'checkout_failed') {
        await failCheckout(event.checkoutId, event.eventType)
      }
      await deps.webhooks.finish(stored.id, event.kind === 'ignored' ? 'ignored' : 'processed')
      return { status: 'processed' as const }
    } catch (error) {
      await deps.webhooks.finish(stored.id, 'failed', String(error))
      throw error
    }
  }
}

function redact(event: PaymentEvent) {
  return event.kind === 'ignored'
    ? { kind: event.kind }
    : event.kind === 'checkout_paid'
      ? { kind: event.kind, checkoutId: event.checkoutId, amount: event.amount }
      : { kind: event.kind, checkoutId: event.checkoutId }
}

/** C-11: the finished booking for the member who made it. */
export function makeGetCompletedBooking(
  deps: Pick<CheckoutDeps, 'bookings' | 'checkouts' | 'clock'>,
) {
  return async function getCompletedBooking(requestKey: string | null, memberId: number) {
    const booking = requestKey ? await deps.bookings.findByRequestKey(requestKey) : null
    if (!booking || booking.memberId !== memberId) {
      throw new DomainError('hold_not_found', 'booking not found')
    }
    const payment = await deps.checkouts.succeededPayment(booking.id)
    return { booking, payment }
  }
}
