import { DomainError } from '../shared/errors'
import type { OpeningWindow } from '../store/business-hours'
import {
  addMinutes,
  createTimeRange,
  durationMinutes,
  isSlotAligned,
  SLOT_MINUTES,
  type TimeRange,
} from '../time/time-range'
import { type AllocationInput, canAccommodate } from './allocation'

export interface BookingRules {
  /** Shortest bookable length (price profile minimum_minutes). */
  readonly minimumMinutes: number
  /** Bookings must start at least this many minutes from now. */
  readonly leadMinutes: number
  /** Permit immediate use, billed from the current half-hour boundary. */
  readonly allowImmediate?: boolean
}

export interface SlotState {
  readonly start: Date
  readonly available: boolean
}

/**
 * C-03 grid: one cell per 30 minutes of the opening window. A cell is available when a 30-minute
 * booking there would still fit and it is not in the past (now + lead time).
 */
export function slotStates(
  window: OpeningWindow,
  load: AllocationInput,
  now: Date,
  rules: BookingRules,
): SlotState[] {
  const earliest = earliestBookableStart(now, rules).getTime()
  const states: SlotState[] = []
  for (let t = window.opensAt; t < window.closesAt; t = addMinutes(t, SLOT_MINUTES)) {
    const cell = createTimeRange(t, addMinutes(t, SLOT_MINUTES))
    states.push({ start: t, available: t.getTime() >= earliest && canAccommodate(load, cell) })
  }
  return states
}

/**
 * Valid end times for a chosen start, in order. Stops at the first end that no longer fits, closing
 * time, or `maxMinutes` (bookings cannot skip over an unavailable period).
 */
export function endOptions(
  window: OpeningWindow,
  load: AllocationInput,
  start: Date,
  now: Date,
  rules: BookingRules,
  maxMinutes = 24 * 60,
): Date[] {
  if (!isStartAllowed(window, start, now, rules)) return []
  const ends: Date[] = []
  for (let minutes = SLOT_MINUTES; minutes <= maxMinutes; minutes += SLOT_MINUTES) {
    const end = addMinutes(start, minutes)
    if (end > window.closesAt) break
    if (!canAccommodate(load, createTimeRange(start, end))) break
    if (minutes >= rules.minimumMinutes) ends.push(end)
  }
  return ends
}

/** Throws a DomainError explaining why a requested booking cannot be made. */
export function assertBookable(
  window: OpeningWindow,
  load: AllocationInput,
  range: TimeRange,
  now: Date,
  rules: BookingRules,
): void {
  if (!isSlotAligned(range)) {
    throw new DomainError('not_slot_aligned', 'bookings start and end on the hour or half hour')
  }
  if (range.start < window.opensAt || range.end > window.closesAt) {
    throw new DomainError('outside_opening_hours', 'the booking is outside opening hours')
  }
  if (!isStartAllowed(window, range.start, now, rules)) {
    throw new DomainError('too_late', 'this start time can no longer be booked')
  }
  if (durationMinutes(range) < rules.minimumMinutes) {
    throw new DomainError('below_minimum', `the minimum booking is ${rules.minimumMinutes} minutes`)
  }
  if (!canAccommodate(load, range)) {
    throw new DomainError('unavailable', 'no room is available for the whole requested time')
  }
}

function isStartAllowed(
  window: OpeningWindow,
  start: Date,
  now: Date,
  rules: BookingRules,
): boolean {
  return (
    start >= window.opensAt &&
    start < window.closesAt &&
    start.getTime() >= earliestBookableStart(now, rules).getTime()
  )
}

/** Immediate reservations are charged from the preceding 30-minute boundary (13:08 → 13:00). */
export function earliestBookableStart(now: Date, rules: BookingRules): Date {
  const lead = addMinutes(now, rules.leadMinutes)
  return rules.allowImmediate
    ? new Date(Math.floor(lead.getTime() / (SLOT_MINUTES * 60_000)) * SLOT_MINUTES * 60_000)
    : lead
}
