import type { CouponTerms, LocalDate } from '@jancube/domain'

// ---------------------------------------------------------------- coupons

/** A coupon a member holds (coupon_grants) with its current conditions. */
export interface CouponOffer {
  readonly grantId: number
  readonly couponName: string
  readonly conditionsNote: string | null
  readonly expiresAt: Date
  readonly terms: CouponTerms
}

/** An active coupon version that can be granted (by code entry or an automatic trigger). */
export interface GrantableCoupon {
  readonly couponId: number
  readonly couponVersionId: number
  readonly name: string
  readonly maxUses: number
  readonly validFrom: Date
  readonly validTo: Date
}

export interface CouponRepository {
  /** Grants that are valid at `at` and still have uses left (ignoring reservations by `bookingId`). */
  usableGrants(memberId: number, at: Date, bookingId: number): Promise<CouponOffer[]>
  /** Active coupon with this code whose current version may be claimed by entering the code. */
  findClaimableByCode(code: string, at: Date): Promise<GrantableCoupon | null>
  /** Active coupons granted automatically on an event (e.g. registration). */
  findByTrigger(trigger: 'registration', at: Date): Promise<GrantableCoupon[]>
  /** Idempotent on `issuanceKey`; returns the grant id. */
  grant(input: {
    readonly memberId: number
    readonly coupon: GrantableCoupon
    readonly issuanceKey: string
    readonly grantedAt: Date
  }): Promise<number>
}

// ---------------------------------------------------------------- payments

export type PaymentMethod = 'card' | 'paypay'

export interface CheckoutState {
  readonly status: 'open' | 'complete' | 'expired'
  readonly paid: boolean
  readonly externalPaymentId: string | null
  readonly amount: number
}

/** A verified, provider-neutral payment notification. */
export type PaymentEvent =
  | {
      readonly kind: 'checkout_paid'
      readonly eventId: string
      readonly checkoutId: string
      readonly externalPaymentId: string | null
      readonly amount: number
    }
  | { readonly kind: 'checkout_failed'; readonly eventId: string; readonly checkoutId: string }
  | { readonly kind: 'ignored'; readonly eventId: string; readonly type: string }

/** Hosted payment page (C-10). Production adapter: Stripe Checkout. */
export interface PaymentGateway {
  readonly provider: string
  readonly environment: 'test' | 'live'
  readonly accountId: string
  createCheckout(input: {
    readonly idempotencyKey: string
    readonly amount: number
    readonly method: PaymentMethod
    readonly description: string
    readonly successUrl: string
    readonly cancelUrl: string
    readonly expiresAt: Date
    readonly customerEmail: string | null
    readonly metadata: Readonly<Record<string, string>>
  }): Promise<{ checkoutId: string; url: string }>
  getCheckout(checkoutId: string): Promise<CheckoutState>
  expireCheckout(checkoutId: string): Promise<void>
  refund(input: {
    readonly externalPaymentId: string
    readonly amount: number
    readonly idempotencyKey: string
  }): Promise<{ refundId: string }>
  /** Verifies the signature and maps the payload; throws if it is not authentic. */
  parseWebhook(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<PaymentEvent & { payloadSha256: string; eventType: string }>
}

// ---------------------------------------------------------------- checkout persistence

export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled'

/** A payment attempt with what is needed to confirm its booking. */
export interface CheckoutRecord {
  readonly paymentId: number
  readonly status: PaymentStatus
  readonly amount: number
  readonly method: PaymentMethod
  readonly bookingId: number
  readonly bookingStatus: string
  readonly storeCode: string
  readonly roomGroupId: number
  readonly requestedRoomId: number | null
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly holdExpiresAt: Date | null
}

export interface CheckoutRepository {
  /** Open checkout sessions of earlier attempts for this booking (expired before a new one starts). */
  pendingCheckoutIds(bookingId: number): Promise<string[]>
  /**
   * One transaction: release earlier coupon reservations and pending payments of the booking,
   * reserve the chosen coupon, store a new price calculation revision, update the booking totals and
   * cancellation-policy agreement, and (when something is to be paid) create the pending payment.
   */
  prepare(input: {
    readonly bookingId: number
    readonly coupon: { readonly grantId: number; readonly discount: number } | null
    readonly policyDocumentId: number
    readonly agreedAt: Date
    readonly payment: {
      readonly provider: string
      readonly environment: 'test' | 'live'
      readonly accountId: string
      readonly idempotencyKey: string
      readonly method: PaymentMethod
    } | null
  }): Promise<{ paymentId: number | null; total: number }>
  attachCheckout(paymentId: number, checkoutId: string): Promise<void>
  findByCheckout(checkoutId: string): Promise<CheckoutRecord | null>
  /** Payment did not complete: mark it and release its coupon reservation. */
  cancelPayment(paymentId: number, status: 'failed' | 'canceled', reason: string): Promise<void>
  succeededPayment(
    bookingId: number,
  ): Promise<{ method: PaymentMethod; amount: number; paidAt: Date } | null>
  finishRefund(
    refundId: number,
    result: { externalRefundId: string; at: Date } | { error: string },
  ): Promise<void>
}

/** Operations on a booking that need the inventory lock (see BookingRepository.withInventoryLock). */
export interface LockedConfirmationTx {
  bookingState(bookingId: number): Promise<{ status: string; holdExpiresAt: Date | null }>
  /** Payment succeeded (if any), booking confirmed, coupon applied, booking.confirmed queued. */
  confirm(input: {
    readonly bookingId: number
    readonly paymentId: number | null
    readonly externalPaymentId: string | null
    readonly at: Date
  }): Promise<void>
  /** Money was taken but the time is no longer available: record the payment and a refund request. */
  recordUnconfirmablePayment(input: {
    readonly bookingId: number
    readonly paymentId: number
    readonly externalPaymentId: string | null
    readonly at: Date
    readonly reason: string
  }): Promise<{ refundId: number; idempotencyKey: string }>
}

export interface WebhookRepository {
  /** Stores the event once; `duplicate` when this provider event id was seen before. */
  record(event: {
    readonly provider: string
    readonly environment: 'test' | 'live'
    readonly accountId: string
    readonly eventId: string
    readonly eventType: string
    readonly payloadSha256: string
    readonly redacted: unknown
    readonly receivedAt: Date
  }): Promise<{ id: number; duplicate: boolean; processed: boolean }>
  finish(id: number, status: 'processed' | 'failed' | 'ignored', error?: string): Promise<void>
}
