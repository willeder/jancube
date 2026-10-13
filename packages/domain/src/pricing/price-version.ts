import { DomainError } from '../shared/errors'
import { SLOT_MINUTES } from '../time/time-range'

/** Weekday / time-of-day rule of a price version (price_time_rules). */
export interface PriceTimeRuleDraft {
  /** Bit 0 = Sunday … bit 6 = Saturday. */
  readonly weekdayMask: number
  readonly holidayMode: 'any' | 'only' | 'exclude'
  /** Usage start window in business-day minutes; null = all day. */
  readonly startMinute: number | null
  readonly endMinute: number | null
  readonly hourlyDiscount: number
  readonly priority: number
}

/** A new price profile version (A-16). Published versions are never edited. */
export interface PriceVersionDraft {
  readonly hourlyRate: number
  readonly minimumMinutes: number
  readonly taxRatePercent: number
  readonly validFrom: Date
  readonly packages: readonly { readonly minutes: number; readonly price: number }[]
  readonly timeRules: readonly PriceTimeRuleDraft[]
}

const invalid = (message: string) => new DomainError('invalid_price', message)

const isSlotMultiple = (minutes: number) =>
  Number.isInteger(minutes) && minutes > 0 && minutes % SLOT_MINUTES === 0

/** Mirrors the price_* CHECK constraints and the pricing rules (30-minute units, whole yen). */
export function assertPriceVersionDraft(d: PriceVersionDraft): void {
  if (!Number.isInteger(d.hourlyRate) || d.hourlyRate < 0) {
    throw invalid('hourly rate must be zero or more')
  }
  if (!isSlotMultiple(d.minimumMinutes)) {
    throw invalid('minimum length must be a multiple of 30 minutes')
  }
  if (!(d.taxRatePercent >= 0 && d.taxRatePercent <= 100)) throw invalid('tax rate is 0-100%')
  if (Number.isNaN(d.validFrom.getTime())) throw invalid('valid-from date is required')
  const lengths = new Set<number>()
  for (const p of d.packages) {
    if (!isSlotMultiple(p.minutes)) throw invalid('package length must be a multiple of 30 minutes')
    if (!Number.isInteger(p.price) || p.price < 0)
      throw invalid('package price must be zero or more')
    if (lengths.has(p.minutes)) throw invalid('two packages have the same length')
    lengths.add(p.minutes)
  }
  for (const r of d.timeRules) {
    if (!Number.isInteger(r.weekdayMask) || r.weekdayMask < 1 || r.weekdayMask > 127) {
      throw invalid('time rule needs at least one weekday')
    }
    if ((r.startMinute === null) !== (r.endMinute === null)) {
      throw invalid('time rule window needs both a start and an end')
    }
    if (
      r.startMinute !== null &&
      r.endMinute !== null &&
      (r.endMinute <= r.startMinute || r.endMinute > 2880)
    ) {
      throw invalid('time rule window must end after it starts')
    }
    if (!Number.isInteger(r.hourlyDiscount) || r.hourlyDiscount < 0) {
      throw invalid('time rule discount must be zero or more')
    }
  }
}

/** Consumption tax contained in a tax-inclusive amount, rounded down to the yen. */
export function includedTax(taxInclusive: number, taxRatePercent: number): number {
  if (taxRatePercent <= 0) return 0
  return Math.floor((taxInclusive * taxRatePercent) / (100 + taxRatePercent))
}
