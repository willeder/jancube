import { DomainError } from '../shared/errors'

/** A calendar date in the store's local time, formatted YYYY-MM-DD. */
export type LocalDate = string

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date)
  if (!m) throw new DomainError('invalid_date', `invalid date: ${date}`)
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new DomainError('invalid_date', `invalid date: ${date}`)
  }
  return { year, month, day }
}

/** Day of week of a local calendar date: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** Offset of `timeZone` from UTC at the given instant, in minutes (Asia/Tokyo → +540). */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return Math.round((asUtc - utcMs) / 60_000)
}

/**
 * The UTC instant of `minuteOfDay` minutes after local midnight of `date` in `timeZone`.
 * minuteOfDay may exceed 1440 (e.g. a business day closing at 02:00 the next day = 1560).
 */
export function localToUtc(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date)
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay)
  const first = offsetMinutes(naive, timeZone)
  let utc = naive - first * 60_000
  const second = offsetMinutes(utc, timeZone)
  if (second !== first) utc = naive - second * 60_000
  return new Date(utc)
}

/** Local calendar date and minute-of-day of a UTC instant. */
export function utcToLocal(
  instant: Date,
  timeZone: string,
): { date: LocalDate; minuteOfDay: number } {
  const local = new Date(instant.getTime() + offsetMinutes(instant.getTime(), timeZone) * 60_000)
  return {
    date: local.toISOString().slice(0, 10),
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  }
}

/** Minutes from local midnight of `businessDate` to `instant` (may exceed 1440 after midnight). */
export function minuteOfBusinessDay(
  businessDate: LocalDate,
  instant: Date,
  timeZone: string,
): number {
  return Math.round((instant.getTime() - localToUtc(businessDate, 0, timeZone).getTime()) / 60_000)
}
