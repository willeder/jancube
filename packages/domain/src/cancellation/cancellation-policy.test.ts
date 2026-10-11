import { describe, expect, it } from 'vitest'
import { calculateCancellationFee, isDateChangeAllowed } from './cancellation-policy'

const start = new Date('2026-11-10T04:00:00Z') // 13:00 JST
const hoursBefore = (h: number) => new Date(start.getTime() - h * 3_600_000)

describe('calculateCancellationFee', () => {
  it('is free 24 hours or more before start (exactly 24h is free)', () => {
    expect(
      calculateCancellationFee({ startAt: start, cancelledAt: hoursBefore(48), paidAmount: 6_100 }),
    ).toEqual({
      percent: 0,
      fee: 0,
      refund: 6_100,
    })
    expect(
      calculateCancellationFee({ startAt: start, cancelledAt: hoursBefore(24), paidAmount: 6_100 })
        .percent,
    ).toBe(0)
  })

  it('charges 50% within 24 hours before start, rounding the fee down', () => {
    expect(
      calculateCancellationFee({
        startAt: start,
        cancelledAt: hoursBefore(23.99),
        paidAmount: 6_101,
      }),
    ).toEqual({
      percent: 50,
      fee: 3_050,
      refund: 3_051,
    })
  })

  it('charges 100% at or after start', () => {
    expect(
      calculateCancellationFee({ startAt: start, cancelledAt: start, paidAmount: 6_100 }).fee,
    ).toBe(6_100)
    expect(
      calculateCancellationFee({ startAt: start, cancelledAt: hoursBefore(-1), paidAmount: 6_100 })
        .refund,
    ).toBe(0)
  })
})

describe('isDateChangeAllowed', () => {
  it('allows changes only while cancellation is free', () => {
    expect(isDateChangeAllowed(start, hoursBefore(25))).toBe(true)
    expect(isDateChangeAllowed(start, hoursBefore(24))).toBe(true)
    expect(isDateChangeAllowed(start, hoursBefore(23))).toBe(false)
    expect(isDateChangeAllowed(start, hoursBefore(-1))).toBe(false)
  })
})
