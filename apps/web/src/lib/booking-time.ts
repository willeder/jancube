import { minuteOfBusinessDay } from '@jancube/domain'
import { hhmm, slashDateLabel } from './format'

interface Timed {
  readonly businessDate: string
  readonly start: Date
  readonly end: Date
  readonly timezone: string
}

/** "13:00-16:00" (times after midnight stay on the business date, e.g. "25:00"). */
export function bookingTimes(b: Timed): string {
  const start = minuteOfBusinessDay(b.businessDate, b.start, b.timezone)
  const end = minuteOfBusinessDay(b.businessDate, b.end, b.timezone)
  return `${hhmm(start)}-${hhmm(end)}`
}

/** "2026/7/8(水) 13:00-16:00" */
export function bookingWhen(b: Timed): string {
  return `${slashDateLabel(b.businessDate)} ${bookingTimes(b)}`
}
