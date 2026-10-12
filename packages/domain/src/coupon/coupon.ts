/** Conditions of one coupon version (coupon_versions + target stores / room types). */
export interface CouponTerms {
  readonly discountType: 'amount' | 'percent'
  /** Yen for 'amount', percent (0–100] for 'percent'. */
  readonly discountValue: number
  /** Cap for percent coupons; null = no cap. */
  readonly maximumDiscount: number | null
  readonly minimumSpend: number
  readonly validFrom: Date
  readonly validTo: Date
  /** Bit 0 = Sunday … bit 6 = Saturday (store-local weekday of the usage start). */
  readonly weekdayMask: number
  /** Usage must start within [startMinute, endMinute) of the business day; null = any time. */
  readonly startMinute: number | null
  readonly endMinute: number | null
  /** Empty = every store / room type. */
  readonly storeIds: readonly number[]
  readonly roomTypeIds: readonly number[]
}

export interface CouponUsage {
  /** When the customer pays (validity is checked at the time of use). */
  readonly at: Date
  readonly storeId: number
  readonly roomTypeId: number
  /** Store-local weekday (0 = Sunday) and business-day minute of the usage start. */
  readonly startWeekday: number
  readonly startMinute: number
  /** Tax-inclusive price before the coupon. */
  readonly subtotal: number
}

export type CouponRejection =
  | 'not_started'
  | 'expired'
  | 'store_not_eligible'
  | 'room_not_eligible'
  | 'weekday_not_eligible'
  | 'time_not_eligible'
  | 'below_minimum_spend'

export type CouponEvaluation =
  | { readonly ok: true; readonly discount: number }
  | { readonly ok: false; readonly reason: CouponRejection }

/**
 * Whether a coupon applies to a booking and how much it takes off (F-CPN). Percent discounts round
 * down to the yen; the discount never exceeds the subtotal. One coupon per booking (tracker #6 open).
 */
export function evaluateCoupon(terms: CouponTerms, usage: CouponUsage): CouponEvaluation {
  if (usage.at < terms.validFrom) return { ok: false, reason: 'not_started' }
  if (usage.at >= terms.validTo) return { ok: false, reason: 'expired' }
  if (terms.storeIds.length > 0 && !terms.storeIds.includes(usage.storeId)) {
    return { ok: false, reason: 'store_not_eligible' }
  }
  if (terms.roomTypeIds.length > 0 && !terms.roomTypeIds.includes(usage.roomTypeId)) {
    return { ok: false, reason: 'room_not_eligible' }
  }
  if ((terms.weekdayMask & (1 << usage.startWeekday)) === 0) {
    return { ok: false, reason: 'weekday_not_eligible' }
  }
  if (
    terms.startMinute !== null &&
    terms.endMinute !== null &&
    (usage.startMinute < terms.startMinute || usage.startMinute >= terms.endMinute)
  ) {
    return { ok: false, reason: 'time_not_eligible' }
  }
  if (usage.subtotal < terms.minimumSpend) return { ok: false, reason: 'below_minimum_spend' }

  let discount =
    terms.discountType === 'amount'
      ? terms.discountValue
      : Math.floor((usage.subtotal * terms.discountValue) / 100)
  if (terms.maximumDiscount !== null) discount = Math.min(discount, terms.maximumDiscount)
  return { ok: true, discount: Math.max(0, Math.min(discount, usage.subtotal)) }
}
