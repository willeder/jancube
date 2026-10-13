import { describe, expect, it } from 'vitest'
import {
  dayBeforeCutoff,
  isPreparationDue,
  KEY_RETRY_MINUTES,
  keyValidity,
  nextKeyAttemptAt,
} from './access-key'
import { planCleaningTasks } from './cleaning-plan'
import {
  type AssignableRoom,
  checkRoomChange,
  isFinalizeDue,
  planRoomAssignments,
} from './room-assignment'

/** 2026-11-10 in JST; `h(14)` = 14:00 JST. */
const h = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 10, hour - 9, minute))
const range = (from: number, to: number) => ({ start: h(from), end: h(to) })
const room = (roomId: number, extra: Partial<AssignableRoom> = {}): AssignableRoom => ({
  roomId,
  sortOrder: roomId,
  clean: true,
  usageMinutes: 0,
  blocks: [],
  ...extra,
})

describe('planRoomAssignments (F-RM-04)', () => {
  it('keeps named rooms and prefers clean, then least used rooms', () => {
    const plan = planRoomAssignments({
      rooms: [room(1, { clean: false }), room(2, { usageMinutes: 600 }), room(3)],
      placed: [],
      pending: [
        { bookingId: 10, range: range(13, 16), requestedRoomId: null },
        { bookingId: 11, range: range(18, 20), requestedRoomId: 1 },
      ],
      reserve: [],
      bufferMinutes: 15,
    })
    expect(plan.assigned).toEqual([
      { bookingId: 11, roomId: 1, source: 'named' },
      { bookingId: 10, roomId: 3, source: 'batch' },
    ])
    expect(plan.unassigned).toEqual([])
  })

  it('respects the cleaning buffer and keeps later bookings placeable', () => {
    // Room 1 is busy until 13:00. A 13:00 booking cannot use it (buffer), so it goes to room 2.
    const plan = planRoomAssignments({
      rooms: [room(1), room(2)],
      placed: [{ bookingId: 1, roomId: 1, range: range(10, 13) }],
      pending: [
        { bookingId: 2, range: range(13, 15), requestedRoomId: null },
        { bookingId: 3, range: range(14, 18), requestedRoomId: null },
      ],
      reserve: [],
      bufferMinutes: 15,
    })
    expect(plan.assigned.map((a) => [a.bookingId, a.roomId])).toEqual([
      [2, 2],
      [3, 1],
    ])
  })

  it('reports bookings that do not fit', () => {
    const plan = planRoomAssignments({
      rooms: [room(1, { blocks: [range(12, 20)] })],
      placed: [],
      pending: [{ bookingId: 5, range: range(13, 14), requestedRoomId: null }],
      reserve: [],
      bufferMinutes: 15,
    })
    expect(plan.unassigned).toEqual([5])
  })
})

describe('checkRoomChange (F-RM-06)', () => {
  const base = {
    rooms: [room(1), room(2)],
    placed: [
      { bookingId: 1, roomId: 1, range: range(13, 16) },
      { bookingId: 2, roomId: 2, range: range(14, 16) },
    ],
    reserve: [],
    waiting: [],
    bufferMinutes: 15,
  }
  it('detects conflicts in the target room', () => {
    expect(
      checkRoomChange({ ...base, booking: { bookingId: 1, range: range(13, 16) }, roomId: 2 }),
    ).toEqual({
      ok: false,
      reason: 'conflict',
      conflict: range(14, 16),
    })
  })
  it('allows a free room of the group', () => {
    expect(
      checkRoomChange({ ...base, booking: { bookingId: 2, range: range(16, 18) }, roomId: 1 }),
    ).toEqual({ ok: false, reason: 'conflict', conflict: range(13, 16) })
    expect(
      checkRoomChange({ ...base, booking: { bookingId: 2, range: range(17, 18) }, roomId: 1 }),
    ).toEqual({ ok: true })
    expect(
      checkRoomChange({ ...base, booking: { bookingId: 2, range: range(17, 18) }, roomId: 9 }),
    ).toEqual({
      ok: false,
      reason: 'not_in_group',
    })
  })
})

describe('planCleaningTasks (F-CLN-02)', () => {
  const now = new Date(Date.UTC(2026, 10, 9, 11)) // 20:00 JST the day before
  const uses = [
    { bookingId: 1, roomId: 1, businessDate: '2026-11-10', start: h(12), end: h(14) },
    { bookingId: 2, roomId: 1, businessDate: '2026-11-10', start: h(14, 30), end: h(17) },
    { bookingId: 3, roomId: 2, businessDate: '2026-11-10', start: h(15), end: h(18) },
    { bookingId: 9, roomId: 3, businessDate: '2026-11-09', start: h(-3), end: h(0) },
    { bookingId: 4, roomId: 3, businessDate: '2026-11-10', start: h(11), end: h(12) },
  ]
  it('creates opening tasks for rooms not clean at opening and spot tasks between bookings', () => {
    const tasks = planCleaningTasks({
      businessDate: '2026-11-10',
      mode: 'day_before',
      now,
      opensAt: h(10),
      rooms: [
        { roomId: 1, dirty: true, hasOpeningTask: false },
        { roomId: 2, dirty: false, hasOpeningTask: false },
        { roomId: 3, dirty: false, hasOpeningTask: false },
      ],
      uses,
    })
    expect(tasks.map((t) => [t.generationKey, t.dueAt.toISOString()])).toEqual([
      ['opening:2026-11-10:1', h(10).toISOString()],
      // 14:00 end, next at 14:30: due is the next start (30 minutes lead is before the end)
      ['spot:1:2', h(14, 30).toISOString()],
      // room 3 is used tonight, so it is not clean at opening
      ['opening:2026-11-10:3', h(10).toISOString()],
    ])
  })

  it('on the day, a dirty room without an opening task gets an urgent spot task', () => {
    const tasks = planCleaningTasks({
      businessDate: '2026-11-10',
      mode: 'same_day',
      now: h(11),
      opensAt: h(10),
      rooms: [{ roomId: 2, dirty: true, hasOpeningTask: false }],
      uses,
    })
    expect(tasks).toEqual([
      expect.objectContaining({ generationKey: 'spot:2:3', urgent: true, dueAt: h(14, 30) }),
    ])
  })
})

describe('keys and timing', () => {
  it('codes are valid 15 minutes around the booking', () => {
    expect(keyValidity(range(13, 16))).toEqual({ start: h(12, 45), end: h(16, 15) })
  })
  it('retries with back-off, then gives up', () => {
    const last = h(12)
    expect(nextKeyAttemptAt(0, null)?.getTime()).toBe(0)
    expect(nextKeyAttemptAt(1, last)).toEqual(h(12, 1))
    expect(nextKeyAttemptAt(KEY_RETRY_MINUTES.length + 1, last)).toBeNull()
  })
  it('the day-before batch is 20:00 store time on the previous day', () => {
    expect(dayBeforeCutoff('2026-11-10', 'Asia/Tokyo').toISOString()).toBe(
      '2026-11-09T11:00:00.000Z',
    )
    expect(isPreparationDue('2026-11-10', 'Asia/Tokyo', new Date('2026-11-09T10:59:00Z'))).toBe(
      false,
    )
    expect(isPreparationDue('2026-11-10', 'Asia/Tokyo', new Date('2026-11-09T11:00:00Z'))).toBe(
      true,
    )
  })
  it('assignments become final 30 minutes before the start by default', () => {
    expect(isFinalizeDue(h(14), h(13, 29), null)).toBe(false)
    expect(isFinalizeDue(h(14), h(13, 30), null)).toBe(true)
    expect(isFinalizeDue(h(14), h(13, 0), 60)).toBe(true)
  })
})
