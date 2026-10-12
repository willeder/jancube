import { type LocalDate, localToUtc, weekdayOf } from '../time/zoned-time'

/** Regular hours for one weekday. Minutes from local midnight; closing may exceed 1440 (after midnight). */
export interface WeeklyHours {
  readonly weekday: number
  readonly opensMinute: number
  readonly closesMinute: number
  readonly isClosed: boolean
}

/** A specific date that is closed or has special hours (store_calendar_days). */
export interface CalendarOverride {
  readonly date: LocalDate
  readonly isClosed: boolean
  readonly opensMinute: number | null
  readonly closesMinute: number | null
}

export interface OpeningWindow {
  readonly businessDate: LocalDate
  readonly opensMinute: number
  readonly closesMinute: number
  readonly opensAt: Date
  readonly closesAt: Date
}

/** Opening window of a business date, or null when the store is closed that day. */
export function openingWindow(
  businessDate: LocalDate,
  timeZone: string,
  weekly: readonly WeeklyHours[],
  override?: CalendarOverride,
): OpeningWindow | null {
  if (override?.isClosed) return null
  if (override && override.opensMinute !== null && override.closesMinute !== null) {
    return build(businessDate, timeZone, override.opensMinute, override.closesMinute)
  }
  const regular = weekly.find((w) => w.weekday === weekdayOf(businessDate))
  if (!regular || regular.isClosed) return null
  return build(businessDate, timeZone, regular.opensMinute, regular.closesMinute)
}

function build(date: LocalDate, timeZone: string, opens: number, closes: number): OpeningWindow {
  return {
    businessDate: date,
    opensMinute: opens,
    closesMinute: closes,
    opensAt: localToUtc(date, opens, timeZone),
    closesAt: localToUtc(date, closes, timeZone),
  }
}
