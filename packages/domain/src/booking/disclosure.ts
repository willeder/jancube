import { addDays, type LocalDate, localToUtc } from '../time/zoned-time'

/**
 * The day-before notice (room number, entry code, entry guide) goes out at 20:00 store time on the day
 * before the business date (jobs cron `0 11 * * *` UTC = 20:00 JST).
 */
export const DAY_BEFORE_NOTICE_MINUTE = 20 * 60

/** When the day-before notice for a business date is sent. */
export function dayBeforeNoticeAt(businessDate: LocalDate, timeZone: string): Date {
  return localToUtc(addDays(businessDate, -1), DAY_BEFORE_NOTICE_MINUTE, timeZone)
}

/**
 * C-13: the entry code (and a group booking's room number) is shown on screen only from the
 * day-before notice onwards (2026-10-05 decision); before that the field stays hidden.
 */
export function isEntryInfoDisclosed(
  businessDate: LocalDate,
  timeZone: string,
  now: Date,
): boolean {
  return now >= dayBeforeNoticeAt(businessDate, timeZone)
}
