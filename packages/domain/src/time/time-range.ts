import { DomainError } from '../shared/errors'

/** Bookings are made in 30-minute slots. */
export const SLOT_MINUTES = 30

const MINUTE_MS = 60_000

/** Half-open interval [start, end): the end instant is not included. */
export interface TimeRange {
  readonly start: Date
  readonly end: Date
}

export function createTimeRange(start: Date, end: Date): TimeRange {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new DomainError('invalid_time', 'start and end must be valid dates')
  }
  if (end.getTime() <= start.getTime()) {
    throw new DomainError('invalid_time_range', 'end must be after start')
  }
  return { start, end }
}

export function durationMinutes(range: TimeRange): number {
  return (range.end.getTime() - range.start.getTime()) / MINUTE_MS
}

/** True when both ends fall on a 30-minute boundary and the length is a whole number of slots. */
export function isSlotAligned(range: TimeRange): boolean {
  const slotMs = SLOT_MINUTES * MINUTE_MS
  return range.start.getTime() % slotMs === 0 && range.end.getTime() % slotMs === 0
}

export function assertSlotAligned(range: TimeRange): void {
  if (!isSlotAligned(range)) {
    throw new DomainError(
      'not_slot_aligned',
      `bookings must start and end on ${SLOT_MINUTES}-minute boundaries`,
    )
  }
}

/** Overlap of half-open ranges: touching ranges (a.end === b.start) do not overlap. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS)
}
