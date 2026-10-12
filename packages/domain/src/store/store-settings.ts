import { DomainError } from '../shared/errors'
import { parseLocalDate } from '../time/zoned-time'
import type { CalendarOverride, WeeklyHours } from './business-hours'
import type { StoreStatus } from './store'

export const STORE_STATUSES: readonly StoreStatus[] = ['preparing', 'open', 'closed']

/** Editable store master fields (A-18). */
export interface StoreDraft {
  readonly name: string
  readonly address: string
  readonly phone: string | null
  readonly accessText: string | null
  readonly noticeText: string | null
  readonly mapUrl: string | null
  readonly entryGuideUrl: string | null
  readonly entryGuideText: string | null
  /** F-MIG-04: usage dates before this stay on the old booking system (cutover date). */
  readonly bookingOpenDate: string
  readonly bookingHorizonDays: number
  readonly holdMinutes: number
  readonly proxyHoldMinutes: number
  readonly cleaningBufferMinutes: number
  readonly roomFinalizeMinutes: number | null
  readonly keyBeforeMinutes: number
  readonly keyAfterMinutes: number
  readonly status: StoreStatus
  /** Shown to customers. */
  readonly isActive: boolean
}

const invalid = (message: string) => new DomainError('invalid_store', message)

const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max

export function assertStoreCode(code: string): void {
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(code)) {
    throw new DomainError('invalid_store_code', 'use 2-32 letters, digits, - or _')
  }
}

export function assertStoreDraft(d: StoreDraft): void {
  if (!d.name.trim() || d.name.length > 100) throw invalid('name is required (max 100)')
  if (!d.address.trim() || d.address.length > 500) throw invalid('address is required (max 500)')
  if (d.phone !== null && !/^[0-9+\-() ]{6,20}$/.test(d.phone)) throw invalid('invalid phone')
  for (const url of [d.mapUrl, d.entryGuideUrl]) {
    if (url !== null && !/^https?:\/\/\S+$/.test(url))
      throw invalid('URLs must start with http(s)://')
  }
  try {
    parseLocalDate(d.bookingOpenDate)
  } catch {
    throw invalid('booking open date is required')
  }
  if (!inRange(d.bookingHorizonDays, 1, 730)) throw invalid('horizon must be 1-730 days')
  if (!inRange(d.holdMinutes, 1, 120)) throw invalid('hold must be 1-120 minutes')
  if (!inRange(d.proxyHoldMinutes, 1, 10_080)) throw invalid('proxy hold must be 1-10080 minutes')
  if (!inRange(d.cleaningBufferMinutes, 0, 240)) throw invalid('cleaning buffer must be 0-240')
  if (d.roomFinalizeMinutes !== null && !inRange(d.roomFinalizeMinutes, 0, 1440)) {
    throw invalid('room finalize must be 0-1440 minutes')
  }
  if (!inRange(d.keyBeforeMinutes, 0, 240) || !inRange(d.keyAfterMinutes, 0, 240)) {
    throw invalid('key validity margins must be 0-240 minutes')
  }
  if (!STORE_STATUSES.includes(d.status)) throw invalid('unknown status')
}

/** Weekly hours for all seven weekdays (store_business_hours). */
export function assertWeeklyHours(hours: readonly WeeklyHours[]): void {
  const days = new Set(hours.map((h) => h.weekday))
  if (hours.length !== 7 || days.size !== 7 || [...days].some((d) => !inRange(d, 0, 6))) {
    throw invalid('hours are needed for every weekday')
  }
  for (const h of hours) {
    if (h.isClosed) continue
    if (!inRange(h.opensMinute, 0, 1440) || !inRange(h.closesMinute, 1, 2880)) {
      throw invalid('opening hours are out of range')
    }
    if (h.closesMinute <= h.opensMinute) throw invalid('closing must be after opening')
  }
}

/** A calendar day: closed, or special hours (both or neither), or only a holiday flag. */
export function assertCalendarOverride(day: CalendarOverride): void {
  try {
    parseLocalDate(day.date)
  } catch {
    throw invalid('date is required')
  }
  if ((day.opensMinute === null) !== (day.closesMinute === null)) {
    throw invalid('special hours need both opening and closing')
  }
  if (
    day.opensMinute !== null &&
    day.closesMinute !== null &&
    (!inRange(day.opensMinute, 0, 1440) ||
      day.closesMinute <= day.opensMinute ||
      day.closesMinute > 2880)
  ) {
    throw invalid('closing must be after opening')
  }
}

/** "HH:MM" (hours may exceed 24 for after-midnight closing, e.g. "26:00") → minutes. */
export function parseClock(value: string): number {
  const m = value.trim().match(/^(\d{1,2}):([0-5]\d)$/)
  if (!m) throw new DomainError('invalid_time', `invalid time ${value}`)
  const minutes = Number(m[1]) * 60 + Number(m[2])
  if (minutes > 2880) throw new DomainError('invalid_time', `invalid time ${value}`)
  return minutes
}

/** Minutes → "HH:MM" (26:00 style after midnight). */
export function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
