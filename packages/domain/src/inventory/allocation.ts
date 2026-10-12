import { addMinutes, type TimeRange } from '../time/time-range'

/**
 * Room allocation feasibility.
 *
 * A booking can only be accepted if every booking in the group can be placed in ONE room for its whole
 * time plus the cleaning buffer (design rule 連続部屋確保). Counting free rooms per 30-minute slot is not
 * enough: two rooms each free for half of a booking cannot host it.
 *
 * Inputs:
 * - rooms: rooms usable by the group, each with time that is already taken in that specific room
 *   (blocks, bookings already assigned to it, named bookings for it).
 * - flexible: bookings that still need a room (group bookings without an assignment yet).
 */
export interface RoomSchedule {
  readonly roomId: number
  /** Bookings already fixed to this room. The cleaning buffer is applied after each. */
  readonly bookings: readonly TimeRange[]
  /** Blocked/maintenance periods. No buffer is applied. */
  readonly blocks: readonly TimeRange[]
}

export interface AllocationInput {
  readonly rooms: readonly RoomSchedule[]
  readonly flexible: readonly TimeRange[]
  readonly bufferMinutes: number
}

/** Upper bound on search steps; beyond it the request is treated as not fitting (conservative). */
const MAX_STEPS = 50_000

interface Span {
  readonly start: number
  readonly end: number
}

/**
 * Returns a room for each flexible booking (same order as input), or null if they cannot all fit.
 */
export function findAllocation(input: AllocationInput): number[] | null {
  const buffer = input.bufferMinutes
  const occupied: Span[][] = input.rooms.map((r) => [
    ...r.bookings.map((b) => withBuffer(b, buffer)),
    ...r.blocks.map((b) => ({ start: b.start.getTime(), end: b.end.getTime() })),
  ])

  const order = input.flexible
    .map((range, index) => ({ index, span: withBuffer(range, buffer) }))
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end)

  const result: number[] = new Array(input.flexible.length)
  let steps = 0

  const place = (k: number): boolean => {
    if (k === order.length) return true
    if (++steps > MAX_STEPS) return false
    const item = order[k]
    if (!item) return true
    // Best fit first: the room whose latest occupied end is closest before this start.
    const candidates = occupied
      .map((spans, roomIndex) => ({ roomIndex, spans }))
      .filter(({ spans }) =>
        spans.every((s) => s.end <= item.span.start || s.start >= item.span.end),
      )
      .sort(
        (a, b) => lastEndBefore(b.spans, item.span.start) - lastEndBefore(a.spans, item.span.start),
      )

    for (const { roomIndex, spans } of candidates) {
      spans.push(item.span)
      result[item.index] = input.rooms[roomIndex]?.roomId ?? -1
      if (place(k + 1)) return true
      spans.pop()
    }
    return false
  }

  return place(0) ? result : null
}

/** True if `candidate` can be added to the group's existing load. */
export function canAccommodate(input: AllocationInput, candidate: TimeRange): boolean {
  return findAllocation({ ...input, flexible: [...input.flexible, candidate] }) !== null
}

function withBuffer(range: TimeRange, bufferMinutes: number): Span {
  return { start: range.start.getTime(), end: addMinutes(range.end, bufferMinutes).getTime() }
}

function lastEndBefore(spans: readonly Span[], start: number): number {
  let best = Number.NEGATIVE_INFINITY
  for (const s of spans) if (s.end <= start && s.end > best) best = s.end
  return best
}
