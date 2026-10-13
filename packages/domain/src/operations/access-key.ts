import { addMinutes, type TimeRange } from '../time/time-range'
import { addDays, type LocalDate, localToUtc, utcToLocal } from '../time/zoned-time'

/**
 * Entry codes (F-KEY-01〜07). Tracker #10: one entrance lock per store; a code is issued per booking
 * (not per room), valid from 15 minutes before the start to 15 minutes after the end
 * (stores.key_before_minutes / key_after_minutes).
 */
export type AccessKeyStatus =
  | 'pending'
  | 'issued'
  | 'active'
  | 'revoke_pending'
  | 'revoked'
  | 'expired'
  | 'failed'

/** Statuses that hold the booking's one live key (access_keys.active_marker). */
export const LIVE_KEY_STATUSES: readonly AccessKeyStatus[] = [
  'pending',
  'issued',
  'active',
  'revoke_pending',
]

export const DEFAULT_KEY_BEFORE_MINUTES = 15
export const DEFAULT_KEY_AFTER_MINUTES = 15

export function keyValidity(
  booking: TimeRange,
  beforeMinutes = DEFAULT_KEY_BEFORE_MINUTES,
  afterMinutes = DEFAULT_KEY_AFTER_MINUTES,
): TimeRange {
  return {
    start: addMinutes(booking.start, -beforeMinutes),
    end: addMinutes(booking.end, afterMinutes),
  }
}

export function sameValidity(a: TimeRange, b: TimeRange): boolean {
  return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime()
}

/**
 * Retry schedule for lock API calls that failed (minutes after the previous attempt). After the last
 * one the key is marked failed and an alert is raised (A-25); staff can reissue manually (F-KEY-06).
 */
export const KEY_RETRY_MINUTES = [1, 5, 15, 30, 60] as const

/** When the next attempt is due, or null when no attempts are left. */
export function nextKeyAttemptAt(attempts: number, lastAttemptAt: Date | null): Date | null {
  if (attempts === 0 || !lastAttemptAt) return new Date(0)
  const wait = KEY_RETRY_MINUTES[attempts - 1]
  return wait === undefined ? null : addMinutes(lastAttemptAt, wait)
}

/**
 * Day-before batch time (tracker #9 / CQ-68, provisional): 20:00 store time on the previous day.
 * From then on a booking of that business date is handled immediately (late bookings, changes).
 */
export const DAY_BEFORE_BATCH_MINUTE = 20 * 60

export function dayBeforeCutoff(businessDate: LocalDate, timeZone: string): Date {
  return localToUtc(addDays(businessDate, -1), DAY_BEFORE_BATCH_MINUTE, timeZone)
}

/** True once the day-before batch time of the date has passed: rooms, cleaning and codes are due. */
export function isPreparationDue(businessDate: LocalDate, timeZone: string, now: Date): boolean {
  return now.getTime() >= dayBeforeCutoff(businessDate, timeZone).getTime()
}

/** The store-local calendar date of an instant. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  return utcToLocal(instant, timeZone).date
}
