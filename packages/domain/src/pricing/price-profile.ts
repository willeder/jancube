import type { Yen } from '../shared/money'

/** A fixed-price package, e.g. 4 hours for ¥5,800. */
export interface PricePackage {
  readonly minutes: number
  readonly price: Yen
}

/**
 * How packages and hourly time may be combined.
 *
 * - `single-option`: pay either the hourly rate for the whole booking, or exactly one package that
 *   covers it (a 7.5-hour booking may use the 8-hour package).
 * - `cheapest-combination`: packages, whole hours and a final half hour may be mixed freely; the
 *   cheapest mix that covers the booking wins (e.g. 6-hour package + 1.5 hours).
 *
 * Tracker #6 confirms "cheapest eligible combination" with the 7.5h → 8h example; whether packages may
 * be mixed with hourly time is not explicitly confirmed, so the rule is a per-profile setting.
 */
export type CombinationRule = 'single-option' | 'cheapest-combination'

export interface PriceProfile {
  /** Price for 60 minutes. A trailing 30 minutes costs half of this, rounded down (F-PRC-04). */
  readonly hourlyRate: Yen
  readonly packages: readonly PricePackage[]
  readonly combinationRule: CombinationRule
}
