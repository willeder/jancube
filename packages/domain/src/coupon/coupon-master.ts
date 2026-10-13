import { DomainError } from '../shared/errors'

/** How a coupon reaches members (coupon_versions.grant_trigger). */
export const COUPON_GRANT_TRIGGERS = [
  'registration',
  'line_friend',
  'first_use',
  'manual',
  'bulk',
] as const
export type CouponGrantTrigger = (typeof COUPON_GRANT_TRIGGERS)[number]

export type CouponStatus = 'draft' | 'active' | 'disabled'

/**
 * Conditions of a new coupon version (A-14). Versions are immutable once published: grants and
 * redemptions keep pointing at the version they were made with, so an edit always adds a version.
 */
export interface CouponVersionDraft {
  readonly discountType: 'amount' | 'percent'
  readonly discountValue: number
  readonly maximumDiscount: number | null
  readonly minimumSpend: number
  /** Uses per member grant (e.g. 3 for 「初回3回半額」). */
  readonly maxUses: number
  readonly validFrom: Date
  readonly validTo: Date
  /** Bit 0 = Sunday … bit 6 = Saturday. */
  readonly weekdayMask: number
  readonly startMinute: number | null
  readonly endMinute: number | null
  readonly grantTrigger: CouponGrantTrigger
  /** Stored for later phases; checkout applies one coupon per booking (tracker #6). */
  readonly stackable: boolean
  readonly conditionsNote: string | null
  /** Empty = every store / room type. */
  readonly storeIds: readonly number[]
  readonly roomTypeIds: readonly number[]
}

const invalid = (message: string) => new DomainError('invalid_coupon', message)

/** Mirrors the coupon_versions CHECK constraints so staff get a message instead of a DB error. */
export function assertCouponVersionDraft(d: CouponVersionDraft): void {
  if (d.discountType !== 'amount' && d.discountType !== 'percent') {
    throw invalid('unknown discount type')
  }
  if (d.discountType === 'amount' && (!Number.isInteger(d.discountValue) || d.discountValue <= 0)) {
    throw invalid('amount discount must be a positive whole yen amount')
  }
  if (d.discountType === 'percent' && !(d.discountValue > 0 && d.discountValue <= 100)) {
    throw invalid('percent discount must be between 1 and 100')
  }
  if (
    d.maximumDiscount !== null &&
    (!Number.isInteger(d.maximumDiscount) || d.maximumDiscount < 0)
  ) {
    throw invalid('maximum discount must be zero or more')
  }
  if (!Number.isInteger(d.minimumSpend) || d.minimumSpend < 0) {
    throw invalid('minimum spend must be zero or more')
  }
  if (!Number.isInteger(d.maxUses) || d.maxUses <= 0 || d.maxUses > 100) {
    throw invalid('uses must be between 1 and 100')
  }
  if (Number.isNaN(d.validFrom.getTime()) || Number.isNaN(d.validTo.getTime())) {
    throw invalid('validity dates are required')
  }
  if (d.validTo <= d.validFrom) throw invalid('validity must end after it starts')
  if (!Number.isInteger(d.weekdayMask) || d.weekdayMask < 1 || d.weekdayMask > 127) {
    throw invalid('choose at least one weekday')
  }
  if ((d.startMinute === null) !== (d.endMinute === null)) {
    throw invalid('start-time window needs both a start and an end')
  }
  if (
    d.startMinute !== null &&
    d.endMinute !== null &&
    (d.startMinute < 0 || d.endMinute <= d.startMinute || d.endMinute > 2880)
  ) {
    throw invalid('start-time window must end after it starts')
  }
  if (!COUPON_GRANT_TRIGGERS.includes(d.grantTrigger)) throw invalid('unknown grant trigger')
}

/** Coupon codes typed by customers: upper-case letters, digits, hyphen and underscore. */
export function normalizeCouponCode(code: string): string {
  const normalized = code.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,64}$/.test(normalized)) {
    throw new DomainError('invalid_coupon_code', 'use 3-64 letters, digits, - or _')
  }
  return normalized
}
