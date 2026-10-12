import { describe, expect, it } from 'vitest'
import { type CouponTerms, type CouponUsage, evaluateCoupon } from './coupon'

const terms: CouponTerms = {
  discountType: 'amount',
  discountValue: 500,
  maximumDiscount: null,
  minimumSpend: 0,
  validFrom: new Date('2026-10-01T00:00:00Z'),
  validTo: new Date('2026-12-01T00:00:00Z'),
  weekdayMask: 127,
  startMinute: null,
  endMinute: null,
  storeIds: [],
  roomTypeIds: [],
}

const usage: CouponUsage = {
  at: new Date('2026-11-01T03:00:00Z'),
  storeId: 1,
  roomTypeId: 1,
  startWeekday: 2,
  startMinute: 13 * 60,
  subtotal: 5_800,
}

describe('evaluateCoupon', () => {
  it('takes a fixed amount off', () => {
    expect(evaluateCoupon(terms, usage)).toEqual({ ok: true, discount: 500 })
  })

  it('rounds percent discounts down and applies the cap', () => {
    const half = { ...terms, discountType: 'percent' as const, discountValue: 50 }
    expect(evaluateCoupon(half, { ...usage, subtotal: 5_801 })).toEqual({
      ok: true,
      discount: 2_900,
    })
    expect(evaluateCoupon({ ...half, maximumDiscount: 1_000 }, usage)).toEqual({
      ok: true,
      discount: 1_000,
    })
  })

  it('never discounts more than the price', () => {
    expect(evaluateCoupon({ ...terms, discountValue: 9_999 }, usage)).toEqual({
      ok: true,
      discount: 5_800,
    })
  })

  it.each([
    ['not_started', { validFrom: new Date('2026-11-02T00:00:00Z') }, {}],
    ['expired', { validTo: new Date('2026-11-01T03:00:00Z') }, {}],
    ['store_not_eligible', { storeIds: [2] }, {}],
    ['room_not_eligible', { roomTypeIds: [3, 4] }, {}],
    ['weekday_not_eligible', { weekdayMask: 0b1000001 }, {}],
    ['time_not_eligible', { startMinute: 600, endMinute: 720 }, {}],
    ['below_minimum_spend', { minimumSpend: 6_000 }, {}],
  ])('rejects: %s', (reason, change, usageChange) => {
    expect(evaluateCoupon({ ...terms, ...change }, { ...usage, ...usageChange })).toEqual({
      ok: false,
      reason,
    })
  })
})
