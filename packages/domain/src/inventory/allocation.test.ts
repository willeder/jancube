import { describe, expect, it } from 'vitest'
import { createTimeRange } from '../time/time-range'
import { canAccommodate, findAllocation, type RoomSchedule } from './allocation'

const t = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00+09:00`)
const r = (a: string, b: string) => createTimeRange(t(a), t(b))
const room = (
  roomId: number,
  bookings: ReturnType<typeof r>[] = [],
  blocks: ReturnType<typeof r>[] = [],
): RoomSchedule => ({
  roomId,
  bookings,
  blocks,
})

describe('findAllocation', () => {
  it('places each booking in a single room for its whole time', () => {
    const result = findAllocation({
      rooms: [room(1), room(2)],
      flexible: [r('13:00', '16:00'), r('14:00', '17:00')],
      bufferMinutes: 0,
    })
    expect(result).not.toBeNull()
    expect(new Set(result)).toEqual(new Set([1, 2]))
  })

  it('rejects a booking that only fits by switching rooms halfway', () => {
    // Room 1 is busy 13–15, room 2 is busy 15–17. Each room has free time, but no room is free 13–17.
    const rooms = [room(1, [r('13:00', '15:00')]), room(2, [r('15:00', '17:00')])]
    expect(canAccommodate({ rooms, flexible: [], bufferMinutes: 0 }, r('13:00', '17:00'))).toBe(
      false,
    )
    expect(canAccommodate({ rooms, flexible: [], bufferMinutes: 0 }, r('15:00', '17:00'))).toBe(
      true,
    )
  })

  it('applies the cleaning buffer after each booking', () => {
    const rooms = [room(1, [r('10:00', '13:00')])]
    expect(canAccommodate({ rooms, flexible: [], bufferMinutes: 15 }, r('13:00', '15:00'))).toBe(
      false,
    )
    expect(canAccommodate({ rooms, flexible: [], bufferMinutes: 15 }, r('13:30', '15:00'))).toBe(
      true,
    )
  })

  it('respects blocks without adding a buffer to them', () => {
    const rooms = [room(1, [], [r('12:00', '14:00')])]
    expect(canAccommodate({ rooms, flexible: [], bufferMinutes: 15 }, r('14:00', '16:00'))).toBe(
      true,
    )
    expect(canAccommodate({ rooms, flexible: [], bufferMinutes: 15 }, r('11:00', '12:30'))).toBe(
      false,
    )
  })

  it('reshuffles unassigned bookings to make room when possible', () => {
    // Two flexible bookings and one room blocked in the afternoon: the solver must put the long
    // booking in the free room and the short morning one in the partly blocked room.
    const rooms = [room(1, [], [r('15:00', '20:00')]), room(2)]
    const flexible = [r('10:00', '12:00')]
    expect(canAccommodate({ rooms, flexible, bufferMinutes: 0 }, r('11:00', '19:00'))).toBe(true)
  })

  it('reports no capacity when every room is taken', () => {
    const rooms = [room(1), room(2)]
    const flexible = [r('13:00', '16:00'), r('13:00', '16:00')]
    expect(canAccommodate({ rooms, flexible, bufferMinutes: 0 }, r('14:00', '15:00'))).toBe(false)
  })
})
