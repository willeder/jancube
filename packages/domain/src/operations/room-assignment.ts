import { findAllocation, type RoomSchedule } from '../inventory/allocation'
import { addMinutes, overlaps, type TimeRange } from '../time/time-range'
import { dayBeforeCutoff, localDateOf } from './access-key'

/**
 * Day-before room assignment (F-RM-04) and manual reassignment checks (F-RM-06).
 *
 * Named bookings keep the room the customer chose. Group bookings get a real room so that:
 *  1. nothing conflicts (cleaning buffer after every booking, blocks respected) and every booking
 *     still waiting for a room can still be placed (design rule 連続部屋確保),
 *  2. rooms that are already clean are preferred (less cleaning before opening),
 *  3. usage is balanced across rooms (least used first).
 */
export interface AssignableRoom {
  readonly roomId: number
  readonly sortOrder: number
  /** Clean now and not used again before the target day. */
  readonly clean: boolean
  /** Minutes booked in this room recently (for balancing). */
  readonly usageMinutes: number
  readonly blocks: readonly TimeRange[]
}

/** A booking that already has a room (assigned, or a named booking). */
export interface PlacedBooking {
  readonly bookingId: number
  readonly roomId: number
  readonly range: TimeRange
}

export interface PendingBooking {
  readonly bookingId: number
  readonly range: TimeRange
  /** Named booking (customer chose the room). */
  readonly requestedRoomId: number | null
}

export interface AssignmentPlanInput {
  readonly rooms: readonly AssignableRoom[]
  readonly placed: readonly PlacedBooking[]
  readonly pending: readonly PendingBooking[]
  /** Other bookings of the group that will need a room later (other dates, active holds). */
  readonly reserve: readonly TimeRange[]
  readonly bufferMinutes: number
}

export interface PlannedAssignment {
  readonly bookingId: number
  readonly roomId: number
  readonly source: 'named' | 'batch'
}

export interface AssignmentPlan {
  readonly assigned: readonly PlannedAssignment[]
  /** Bookings that could not be placed without a conflict (raise an alert, A-25). */
  readonly unassigned: readonly number[]
}

interface WorkingRoom {
  readonly room: AssignableRoom
  readonly bookings: TimeRange[]
  usage: number
}

const minutesOf = (range: TimeRange) => (range.end.getTime() - range.start.getTime()) / 60_000

function isFree(room: WorkingRoom, range: TimeRange, bufferMinutes: number): boolean {
  const wanted = { start: range.start, end: addMinutes(range.end, bufferMinutes) }
  return (
    room.bookings.every(
      (b) => !overlaps({ start: b.start, end: addMinutes(b.end, bufferMinutes) }, wanted),
    ) && room.room.blocks.every((b) => !overlaps(b, range))
  )
}

function schedules(rooms: readonly WorkingRoom[]): RoomSchedule[] {
  return rooms.map((r) => ({
    roomId: r.room.roomId,
    bookings: [...r.bookings],
    blocks: r.room.blocks,
  }))
}

export function planRoomAssignments(input: AssignmentPlanInput): AssignmentPlan {
  const rooms: WorkingRoom[] = input.rooms.map((room) => ({
    room,
    bookings: input.placed.filter((p) => p.roomId === room.roomId).map((p) => p.range),
    usage: room.usageMinutes,
  }))
  const byId = new Map(rooms.map((r) => [r.room.roomId, r]))
  const assigned: PlannedAssignment[] = []
  const unassigned: number[] = []

  // Named bookings first: their room is fixed by the customer's choice.
  for (const booking of input.pending) {
    if (booking.requestedRoomId === null) continue
    const room = byId.get(booking.requestedRoomId)
    if (!room || !isFree(room, booking.range, input.bufferMinutes)) {
      unassigned.push(booking.bookingId)
      continue
    }
    room.bookings.push(booking.range)
    room.usage += minutesOf(booking.range)
    assigned.push({ bookingId: booking.bookingId, roomId: room.room.roomId, source: 'named' })
  }

  const group = input.pending
    .filter((b) => b.requestedRoomId === null)
    .sort(
      (a, b) =>
        a.range.start.getTime() - b.range.start.getTime() ||
        b.range.end.getTime() - a.range.end.getTime() ||
        a.bookingId - b.bookingId,
    )

  for (const [index, booking] of group.entries()) {
    const later = [...group.slice(index + 1).map((b) => b.range), ...input.reserve]
    const candidates = rooms
      .filter((r) => isFree(r, booking.range, input.bufferMinutes))
      .sort(
        (a, b) =>
          Number(b.room.clean) - Number(a.room.clean) ||
          a.usage - b.usage ||
          a.room.sortOrder - b.room.sortOrder ||
          a.room.roomId - b.room.roomId,
      )
    let chosen: WorkingRoom | undefined
    for (const candidate of candidates) {
      candidate.bookings.push(booking.range)
      const feasible =
        findAllocation({
          rooms: schedules(rooms),
          flexible: later,
          bufferMinutes: input.bufferMinutes,
        }) !== null
      candidate.bookings.pop()
      if (feasible) {
        chosen = candidate
        break
      }
    }
    // Over capacity: still give a free room so as many bookings as possible have one.
    chosen ??= candidates[0]
    if (!chosen) {
      unassigned.push(booking.bookingId)
      continue
    }
    chosen.bookings.push(booking.range)
    chosen.usage += minutesOf(booking.range)
    assigned.push({ bookingId: booking.bookingId, roomId: chosen.room.roomId, source: 'batch' })
  }
  return { assigned, unassigned }
}

export type RoomChangeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_in_group' | 'blocked' | 'unplaceable' }
  | { readonly ok: false; readonly reason: 'conflict'; readonly conflict: TimeRange }

/**
 * A-07: can `bookingId` move to `roomId`? The room must be free for the booking plus the cleaning
 * buffer (both ways), and every booking still waiting for a room must remain placeable.
 */
export function checkRoomChange(
  input: Omit<AssignmentPlanInput, 'pending'> & {
    readonly booking: { readonly bookingId: number; readonly range: TimeRange }
    readonly roomId: number
    /** Unassigned bookings of the group (they still need a room). */
    readonly waiting: readonly TimeRange[]
  },
): RoomChangeCheck {
  const target = input.rooms.find((r) => r.roomId === input.roomId)
  if (!target) return { ok: false, reason: 'not_in_group' }
  if (target.blocks.some((b) => overlaps(b, input.booking.range)))
    return { ok: false, reason: 'blocked' }
  const others = input.placed.filter((p) => p.bookingId !== input.booking.bookingId)
  const buffer = input.bufferMinutes
  const wanted = {
    start: input.booking.range.start,
    end: addMinutes(input.booking.range.end, buffer),
  }
  const conflict = others.find(
    (p) =>
      p.roomId === input.roomId &&
      overlaps({ start: p.range.start, end: addMinutes(p.range.end, buffer) }, wanted),
  )
  if (conflict) return { ok: false, reason: 'conflict', conflict: conflict.range }
  const feasible = findAllocation({
    rooms: input.rooms.map((r) => ({
      roomId: r.roomId,
      bookings: [
        ...others.filter((p) => p.roomId === r.roomId).map((p) => p.range),
        ...(r.roomId === input.roomId ? [input.booking.range] : []),
      ],
      blocks: r.blocks,
    })),
    flexible: [...input.waiting, ...input.reserve],
    bufferMinutes: buffer,
  })
  return feasible === null ? { ok: false, reason: 'unplaceable' } : { ok: true }
}

/**
 * F-RM-05: a provisional assignment becomes final this many minutes before the booking starts.
 * The final-confirmation time is still open (CQ-31); stores.room_finalize_minutes overrides it.
 */
export const DEFAULT_ROOM_FINALIZE_MINUTES = 30

export function isFinalizeDue(start: Date, now: Date, finalizeMinutes: number | null): boolean {
  // The former per-store minute offset no longer overrides the agreed previous-day 20:00 rule.
  void finalizeMinutes
  return now >= dayBeforeCutoff(localDateOf(start, 'Asia/Tokyo'), 'Asia/Tokyo')
}
