import { DomainError } from '../shared/errors'
import { assertYen, floorYen, type Yen } from '../shared/money'
import { SLOT_MINUTES } from '../time/time-range'
import type { PricePackage, PriceProfile } from './price-profile'

export type PriceLine =
  | { readonly kind: 'package'; readonly minutes: number; readonly amount: Yen }
  | { readonly kind: 'hour'; readonly minutes: 60; readonly amount: Yen }
  | { readonly kind: 'half-hour'; readonly minutes: 30; readonly amount: Yen }

export interface PriceQuote {
  /** Booked length. The price lines may cover more (e.g. an 8-hour package for 7.5 hours). */
  readonly bookedMinutes: number
  /** Price at the plain hourly rate, used to show the saving. */
  readonly regularPrice: Yen
  /** Amount charged before coupons. */
  readonly price: Yen
  /** regularPrice − price. Shown to customers as both an amount and a rate (tracker #17/#37). */
  readonly discountAmount: Yen
  /** Whole-percent discount rate, rounded down. */
  readonly discountRatePercent: number
  readonly lines: readonly PriceLine[]
}

const SLOTS_PER_HOUR = 60 / SLOT_MINUTES

/** Cheapest price for a booking of `bookedMinutes` under the given price profile. */
export function calculatePrice(bookedMinutes: number, profile: PriceProfile): PriceQuote {
  validate(bookedMinutes, profile)
  const slots = bookedMinutes / SLOT_MINUTES
  const regularPrice = hourlyOnly(slots, profile.hourlyRate)

  const best =
    profile.combinationRule === 'single-option'
      ? bestSingleOption(slots, profile)
      : bestCombination(slots, profile)

  const price = best.reduce((sum, line) => sum + line.amount, 0)
  const discountAmount = Math.max(0, regularPrice - price)
  return {
    bookedMinutes,
    regularPrice,
    price,
    discountAmount,
    discountRatePercent: regularPrice === 0 ? 0 : Math.floor((discountAmount * 100) / regularPrice),
    lines: best,
  }
}

function validate(bookedMinutes: number, profile: PriceProfile): void {
  if (
    !Number.isInteger(bookedMinutes) ||
    bookedMinutes <= 0 ||
    bookedMinutes % SLOT_MINUTES !== 0
  ) {
    throw new DomainError(
      'invalid_duration',
      `booking length must be a positive multiple of ${SLOT_MINUTES} minutes`,
    )
  }
  assertYen(profile.hourlyRate, 'hourlyRate')
  for (const p of profile.packages) {
    assertYen(p.price, 'package price')
    if (!Number.isInteger(p.minutes) || p.minutes <= 0 || p.minutes % SLOT_MINUTES !== 0) {
      throw new DomainError(
        'invalid_package',
        'package length must be a positive multiple of 30 minutes',
      )
    }
  }
}

function halfHourPrice(hourlyRate: Yen): Yen {
  return floorYen(hourlyRate / 2)
}

function hourlyLines(slots: number, hourlyRate: Yen): PriceLine[] {
  const lines: PriceLine[] = []
  for (let i = 0; i < Math.floor(slots / SLOTS_PER_HOUR); i++) {
    lines.push({ kind: 'hour', minutes: 60, amount: hourlyRate })
  }
  if (slots % SLOTS_PER_HOUR === 1) {
    lines.push({ kind: 'half-hour', minutes: 30, amount: halfHourPrice(hourlyRate) })
  }
  return lines
}

function hourlyOnly(slots: number, hourlyRate: Yen): Yen {
  return hourlyLines(slots, hourlyRate).reduce((sum, l) => sum + l.amount, 0)
}

function packageLine(p: PricePackage): PriceLine {
  return { kind: 'package', minutes: p.minutes, amount: p.price }
}

function bestSingleOption(slots: number, profile: PriceProfile): PriceLine[] {
  let best = hourlyLines(slots, profile.hourlyRate)
  let bestPrice = hourlyOnly(slots, profile.hourlyRate)
  for (const p of profile.packages) {
    if (p.minutes / SLOT_MINUTES >= slots && p.price < bestPrice) {
      best = [packageLine(p)]
      bestPrice = p.price
    }
  }
  return best
}

type Choice = { kind: 'hour' } | { kind: 'half-hour' } | { kind: 'package'; pkg: PricePackage }

/** Minimum cost to cover at least `slots` half-hours, by dynamic programming over half-hour units. */
function bestCombination(slots: number, profile: PriceProfile): PriceLine[] {
  const cost: number[] = new Array(slots + 1).fill(Number.POSITIVE_INFINITY)
  const choice: (Choice | undefined)[] = new Array(slots + 1)
  cost[0] = 0

  for (let i = 1; i <= slots; i++) {
    const consider = (c: Choice, price: number, covered: number) => {
      const total = price + (cost[Math.max(0, i - covered)] ?? Number.POSITIVE_INFINITY)
      if (total < (cost[i] ?? Number.POSITIVE_INFINITY)) {
        cost[i] = total
        choice[i] = c
      }
    }
    consider({ kind: 'hour' }, profile.hourlyRate, SLOTS_PER_HOUR)
    // A half hour is only ever charged once, for a trailing 30 minutes.
    if (i === 1) consider({ kind: 'half-hour' }, halfHourPrice(profile.hourlyRate), 1)
    for (const pkg of profile.packages) {
      consider({ kind: 'package', pkg }, pkg.price, pkg.minutes / SLOT_MINUTES)
    }
  }

  const lines: PriceLine[] = []
  let i = slots
  while (i > 0) {
    const c = choice[i]
    if (!c) throw new Error('pricing: no option covers the booking') // unreachable: hourly always fits
    if (c.kind === 'hour') {
      lines.push({ kind: 'hour', minutes: 60, amount: profile.hourlyRate })
      i = Math.max(0, i - SLOTS_PER_HOUR)
    } else if (c.kind === 'half-hour') {
      lines.push({ kind: 'half-hour', minutes: 30, amount: halfHourPrice(profile.hourlyRate) })
      i -= 1
    } else {
      lines.push(packageLine(c.pkg))
      i = Math.max(0, i - c.pkg.minutes / SLOT_MINUTES)
    }
  }
  return lines.sort(lineOrder)
}

function lineOrder(a: PriceLine, b: PriceLine): number {
  const rank = { package: 0, hour: 1, 'half-hour': 2 } as const
  return rank[a.kind] - rank[b.kind] || b.minutes - a.minutes
}
