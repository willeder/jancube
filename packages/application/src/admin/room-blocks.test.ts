import type { StaffAccess } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { fakeBookingDeps, jst } from '../booking/test-fixtures'
import type { OccupyingBookingRef, RoomBlockRepository } from '../ports/admin-bookings'
import {
  blockConflicts,
  makeCreateRoomBlock,
  makeReleaseRoomBlock,
  type RoomBlockDeps,
} from './room-blocks'

const D = '2026-11-10'
const storeStaff: StaffAccess = { staffId: 7, grants: [{ role: 'admin', storeId: 1 }] }
const otherStore: StaffAccess = { staffId: 8, grants: [{ role: 'admin', storeId: 2 }] }

const booking = (
  code: string,
  roomId: number | null,
  from: string,
  to: string,
  groupId = 10,
): OccupyingBookingRef => ({
  bookingCode: code,
  status: 'confirmed',
  groupId,
  roomId,
  start: jst(D, from),
  end: jst(D, to),
})

function world(bookings: OccupyingBookingRef[] = []) {
  const base = fakeBookingDeps({
    now: '2026-11-01T12:00:00+09:00',
    bookings: bookings.map((b) => ({
      groupId: b.groupId,
      roomId: b.roomId,
      range: { start: b.start, end: b.end },
    })),
  })
  const created: { roomId: number; start: Date; end: Date; reason: string }[] = []
  const locks: string[] = []
  const released: number[] = []
  const audit: string[] = []
  const blocks: RoomBlockRepository = {
    withInventoryLock: async (groupId, date, fn) => {
      locks.push(`${groupId}|${date}`)
      return fn({
        loadInventory: base.inventory.load,
        occupyingBookings: async () => bookings,
        createBlock: async (block) => {
          created.push(block)
          return created.length
        },
      })
    },
    rooms: async () => [
      { id: 1, groupId: 10, code: 'Room1', name: 'Room1' },
      { id: 2, groupId: 10, code: 'Room2', name: 'Room2' },
      { id: 12, groupId: 20, code: 'Room12', name: 'Room12' },
    ],
    list: async () => [],
    find: async (id) => (id === 3 ? { id, storeId: 1, releasedAt: null } : null),
    release: async (id) => void released.push(id),
  }
  const deps: RoomBlockDeps = {
    blocks,
    stores: base.stores,
    audit: { record: async (e) => void audit.push(e.action) },
    clock: base.clock,
  }
  return { deps, base, created, locks, released, audit }
}

const request = (over: Partial<Parameters<ReturnType<typeof makeCreateRoomBlock>>[1]> = {}) => ({
  storeId: 1,
  roomId: 1 as number | 'all',
  dateFrom: D,
  dateTo: D,
  allDay: false,
  startMinute: 14 * 60,
  endMinute: 18 * 60,
  reason: '卓の修理',
  ...over,
})

describe('blockConflicts (A-22)', () => {
  it('finds bookings in the room, including the cleaning time after them', async () => {
    const bookings = [booking('A', 1, '12:00', '14:00'), booking('B', 2, '14:00', '16:00')]
    const { base } = world(bookings)
    const inventory = await base.inventory.load(1, new Date(0), new Date(0), new Date(0))
    const range = { start: jst(D, '14:00'), end: jst(D, '18:00') }
    // Booking A ends at 14:00, but the room needs 15 minutes of cleaning after it.
    expect(blockConflicts(inventory, bookings, 1, range, 15).map((b) => b.bookingCode)).toEqual([
      'A',
    ])
    expect(blockConflicts(inventory, bookings, 1, range, 0)).toEqual([])
  })

  it('refuses a block that leaves no room for waiting group bookings', async () => {
    // Two unassigned 4麻 bookings at the same time need both rooms of the group.
    const bookings = [booking('A', null, '15:00', '17:00'), booking('B', null, '15:00', '17:00')]
    const { base } = world(bookings)
    const inventory = await base.inventory.load(1, new Date(0), new Date(0), new Date(0))
    const range = { start: jst(D, '14:00'), end: jst(D, '18:00') }
    expect(blockConflicts(inventory, bookings, 1, range, 15).map((b) => b.bookingCode)).toEqual([
      'A',
      'B',
    ])
    // With only one waiting booking the other room is enough.
    const one = bookings.slice(0, 1)
    const inv1 = { ...inventory, bookings: inventory.bookings.slice(0, 1) }
    expect(blockConflicts(inv1, one, 1, range, 15)).toEqual([])
  })
})

describe('createRoomBlock (A-22)', () => {
  it('writes the block inside the inventory lock of the room group and date', async () => {
    const { deps, created, locks, audit } = world()
    const result = await makeCreateRoomBlock(deps)(storeStaff, request())
    expect(result).toEqual({ ok: true, created: 1 })
    expect(created[0]).toMatchObject({ roomId: 1, start: jst(D, '14:00'), end: jst(D, '18:00') })
    expect(locks).toEqual(['10|2026-11-10', '10|2026-11-10']) // check, then write
    expect(audit).toEqual(['room_block.create'])
  })

  it('writes nothing and returns the bookings when the block collides', async () => {
    const { deps, created } = world([booking('JC-2026-000001', 1, '15:00', '17:00')])
    const result = await makeCreateRoomBlock(deps)(storeStaff, request())
    expect(result.ok).toBe(false)
    expect(!result.ok && result.conflicts.map((c) => c.bookingCode)).toEqual(['JC-2026-000001'])
    expect(created).toEqual([])
  })

  it('blocks every room for the opening hours of each day', async () => {
    const { deps, created } = world()
    const result = await makeCreateRoomBlock(deps)(
      storeStaff,
      request({ roomId: 'all', allDay: true, dateTo: '2026-11-11' }),
    )
    expect(result).toEqual({ ok: true, created: 6 })
    // Fixture hours are 10:00–24:00.
    expect(created[0]).toMatchObject({ start: jst(D, '10:00'), end: jst('2026-11-11', '00:00') })
  })

  it('validates the request and the store scope', async () => {
    const { deps } = world()
    const create = makeCreateRoomBlock(deps)
    await expect(create(storeStaff, request({ reason: ' ' }))).rejects.toMatchObject({
      code: 'reason_required',
    })
    await expect(create(storeStaff, request({ endMinute: 14 * 60 }))).rejects.toMatchObject({
      code: 'invalid_time',
    })
    await expect(create(storeStaff, request({ dateTo: '2026-12-31' }))).rejects.toMatchObject({
      code: 'invalid_block_period',
    })
    await expect(create(otherStore, request())).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('releases a block of the staff member’s store only', async () => {
    const { deps, released, audit } = world()
    const release = makeReleaseRoomBlock(deps)
    await expect(release(otherStore, 3)).rejects.toMatchObject({ code: 'forbidden' })
    await release(storeStaff, 3)
    expect(released).toEqual([3])
    expect(audit).toEqual(['room_block.release'])
  })
})
