import { describe, expect, it } from 'vitest'
import { DomainError } from '../shared/errors'
import { calculatePrice } from './calculate-price'
import type { PriceProfile } from './price-profile'

// Sample values from ActPro's prototype v0.6 (A-16 「スタンダード(JC001現行)」). Not confirmed master data.
const packages = [
  { minutes: 240, price: 5_800 },
  { minutes: 300, price: 7_000 },
  { minutes: 360, price: 8_200 },
  { minutes: 480, price: 10_800 },
  { minutes: 600, price: 13_500 },
  { minutes: 840, price: 16_000 },
]
const single: PriceProfile = { hourlyRate: 1_500, packages, combinationRule: 'single-option' }
const combo: PriceProfile = { ...single, combinationRule: 'cheapest-combination' }

describe('calculatePrice', () => {
  it('charges the hourly rate when no package is cheaper', () => {
    const q = calculatePrice(120, single)
    expect(q.price).toBe(3_000)
    expect(q.discountAmount).toBe(0)
  })

  it('charges half the hourly rate (rounded down) for a trailing 30 minutes', () => {
    expect(calculatePrice(90, single).price).toBe(2_250)
    const odd: PriceProfile = { hourlyRate: 1_501, packages: [], combinationRule: 'single-option' }
    expect(calculatePrice(30, odd).price).toBe(750)
  })

  it('applies a package and reports the discount as amount and rate', () => {
    const q = calculatePrice(240, single)
    expect(q.price).toBe(5_800)
    expect(q.regularPrice).toBe(6_000)
    expect(q.discountAmount).toBe(200)
    expect(q.discountRatePercent).toBe(3)
  })

  it('tracker #6: 7.5 hours may be charged at the cheaper 8-hour package', () => {
    const q = calculatePrice(450, single)
    expect(q.bookedMinutes).toBe(450)
    expect(q.price).toBe(10_800)
    expect(q.lines).toEqual([{ kind: 'package', minutes: 480, amount: 10_800 }])
  })

  it('cheapest-combination may mix a package with hourly time', () => {
    // 6h package (8,200) + 1h (1,500) + 30min (750) = 10,450 < 8h package (10,800)
    const q = calculatePrice(450, combo)
    expect(q.price).toBe(10_450)
    expect(q.lines.map((l) => l.kind)).toEqual(['package', 'hour', 'half-hour'])
  })

  it('never charges more than the hourly price', () => {
    for (let m = 30; m <= 14 * 60; m += 30) {
      expect(calculatePrice(m, combo).price).toBeLessThanOrEqual(
        calculatePrice(m, combo).regularPrice,
      )
      expect(calculatePrice(m, combo).price).toBeLessThanOrEqual(calculatePrice(m, single).price)
    }
  })

  it('rejects lengths that are not whole 30-minute slots', () => {
    expect(() => calculatePrice(45, single)).toThrow(DomainError)
    expect(() => calculatePrice(0, single)).toThrow(DomainError)
  })
})
