import {
  addDays,
  addMinutes,
  DomainError,
  findAllocation,
  type LocalDate,
  localToUtc,
  openingWindow,
  overlaps,
  parseLocalDate,
  SLOT_MINUTES,
  type StaffAccess,
  type TimeRange,
} from '@jancube/domain'
import { buildLanes, laneLoad } from '../booking/booking-context'
import type {
  BlockRoom,
  OccupyingBookingRef,
  RoomBlockRepository,
  RoomBlockRow,
} from '../ports/admin-bookings'
import type { Clock } from '../ports/clock'
import type { StoreInventory } from '../ports/inventory-repository'
import type { AuditLog } from '../ports/ops'
import type { StoreRepository } from '../ports/store-repository'
import { assertStoreAccess, staffActor, storeFilter } from './access'

export interface RoomBlockDeps {
  readonly blocks: RoomBlockRepository
  readonly stores: StoreRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

/** Longest period one A-22 request may block. */
export const MAX_BLOCK_DAYS = 31

/**
 * Bookings a new block on `roomId` would collide with:
 * - bookings fixed to that room (assigned or named) overlapping the block, including the cleaning
 *   buffer after them;
 * - for a pooled room type, waiting (unassigned) bookings that could no longer all be given a room.
 */
export function blockConflicts(
  inventory: StoreInventory,
  bookings: readonly OccupyingBookingRef[],
  roomId: number,
  range: TimeRange,
  bufferMinutes: number,
): OccupyingBookingRef[] {
  const busy = (b: OccupyingBookingRef) =>
    overlaps({ start: b.start, end: addMinutes(b.end, bufferMinutes) }, range)
  const direct = bookings.filter((b) => b.roomId === roomId && busy(b))
  if (direct.length > 0) return direct

  const lane = buildLanes(inventory).find(
    (l) => l.kind === 'group' && l.rooms.some((r) => r.id === roomId),
  )
  if (!lane) return []
  const load = laneLoad(inventory, lane, bufferMinutes)
  const blocked = {
    ...load,
    rooms: load.rooms.map((r) =>
      r.roomId === roomId ? { ...r, blocks: [...r.blocks, range] } : r,
    ),
  }
  if (findAllocation(blocked) !== null) return []
  const laneRooms = new Set(lane.rooms.map((r) => r.id))
  return bookings.filter(
    (b) =>
      b.groupId === lane.group.id && (b.roomId === null || !laneRooms.has(b.roomId)) && busy(b),
  )
}

export interface CreateBlockInput {
  readonly storeId: number
  /** One room, or every room of the store. */
  readonly roomId: number | 'all'
  readonly dateFrom: string
  readonly dateTo: string
  /** All day = the opening hours of each date (closed dates are skipped). */
  readonly allDay: boolean
  /** Minutes from local midnight of each date (may exceed 1440 after midnight). */
  readonly startMinute?: number | null
  readonly endMinute?: number | null
  readonly reason: string
}

export type CreateBlockResult =
  | { readonly ok: true; readonly created: number }
  | {
      readonly ok: false
      readonly conflicts: readonly (OccupyingBookingRef & { readonly roomName: string })[]
    }

interface Segment {
  readonly room: BlockRoom
  readonly date: LocalDate
  readonly range: TimeRange
}

/**
 * A-22 枠ブロック登録. Each room group and date is checked and written inside its inventory lock, so a
 * block cannot slip in next to a booking being made at the same moment. Nothing is written when any
 * part collides with a booking; the colliding bookings are returned instead.
 */
export function makeCreateRoomBlock(deps: RoomBlockDeps) {
  return async function createRoomBlock(
    access: StaffAccess,
    input: CreateBlockInput,
  ): Promise<CreateBlockResult> {
    assertStoreAccess(access, 'bookings.manage', input.storeId)
    const store = (await deps.stores.listActive()).find((s) => s.id === input.storeId)
    if (!store) throw new DomainError('store_not_found', 'store not found')
    const reason = input.reason.trim()
    if (!reason) throw new DomainError('reason_required', 'enter a reason')
    if (reason.length > 500) throw new DomainError('reason_too_long', 'reason is too long')
    parseLocalDate(input.dateFrom)
    parseLocalDate(input.dateTo)
    if (
      input.dateTo < input.dateFrom ||
      addDays(input.dateFrom, MAX_BLOCK_DAYS - 1) < input.dateTo
    ) {
      throw new DomainError('invalid_block_period', `block at most ${MAX_BLOCK_DAYS} days`)
    }
    if (!input.allDay) {
      const s = input.startMinute ?? -1
      const e = input.endMinute ?? -1
      if (
        !Number.isInteger(s) ||
        !Number.isInteger(e) ||
        s < 0 ||
        e <= s ||
        e > 48 * 60 ||
        s % SLOT_MINUTES !== 0 ||
        e % SLOT_MINUTES !== 0
      ) {
        throw new DomainError('invalid_time', 'invalid block time')
      }
    }

    const rooms = await deps.blocks.rooms(store.id)
    const targets = input.roomId === 'all' ? rooms : rooms.filter((r) => r.id === input.roomId)
    if (targets.length === 0) throw new DomainError('room_not_found', 'room not found')

    const weekly = await deps.stores.weeklyHours(store.id)
    const overrides = await deps.stores.calendarOverrides(store.id, input.dateFrom, input.dateTo)
    const segments: Segment[] = []
    for (let date = input.dateFrom; date <= input.dateTo; date = addDays(date, 1)) {
      let range: TimeRange | null
      if (input.allDay) {
        const window = openingWindow(
          date,
          store.timezone,
          weekly,
          overrides.find((o) => o.date === date),
        )
        range = window ? { start: window.opensAt, end: window.closesAt } : null
      } else {
        range = {
          start: localToUtc(date, input.startMinute as number, store.timezone),
          end: localToUtc(date, input.endMinute as number, store.timezone),
        }
      }
      if (range) for (const room of targets) segments.push({ room, date, range: range })
    }
    if (segments.length === 0) throw new DomainError('store_closed', 'closed on every date')

    // One lock per room group and business date (sorted, so concurrent requests lock in one order).
    const groups = new Map<string, Segment[]>()
    for (const s of segments) {
      const key = `${s.room.groupId}|${s.date}`
      groups.set(key, [...(groups.get(key) ?? []), s])
    }
    const keys = [...groups.keys()].sort()
    const buffer = store.booking.cleaningBufferMinutes

    const check = async (write: boolean) => {
      const conflicts: (OccupyingBookingRef & { roomName: string })[] = []
      let created = 0
      for (const key of keys) {
        const part = groups.get(key) ?? []
        const first = part[0]
        if (!first) continue
        const from = new Date(Math.min(...part.map((p) => p.range.start.getTime())))
        const to = new Date(Math.max(...part.map((p) => p.range.end.getTime())))
        await deps.blocks.withInventoryLock(first.room.groupId, first.date, async (tx) => {
          const now = deps.clock.now()
          const [inventory, bookings] = await Promise.all([
            tx.loadInventory(store.id, from, addMinutes(to, buffer), now),
            tx.occupyingBookings(store.id, addMinutes(from, -buffer), to, now),
          ])
          // Blocks added earlier in this request count for the next room of the same group.
          const working = { ...inventory, blocks: [...inventory.blocks] }
          const found: (OccupyingBookingRef & { roomName: string })[] = []
          for (const s of part) {
            for (const c of blockConflicts(working, bookings, s.room.id, s.range, buffer)) {
              if (!found.some((f) => f.bookingCode === c.bookingCode)) {
                found.push({ ...c, roomName: s.room.name })
              }
            }
            working.blocks.push({ roomId: s.room.id, range: s.range })
          }
          conflicts.push(...found)
          if (!write || found.length > 0) return
          for (const s of part) {
            await tx.createBlock({
              roomId: s.room.id,
              start: s.range.start,
              end: s.range.end,
              reason,
              createdBy: access.staffId,
            })
            created++
          }
        })
        if (write && conflicts.length > 0) break
      }
      return { conflicts, created }
    }

    const preview = await check(false)
    if (preview.conflicts.length > 0) return { ok: false, conflicts: preview.conflicts }
    const result = await check(true)
    await deps.audit.record({
      actor: staffActor(access),
      action: 'room_block.create',
      targetType: 'room_block',
      storeId: store.id,
      after: {
        roomIds: targets.map((r) => r.id),
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        allDay: input.allDay,
        startMinute: input.startMinute ?? null,
        endMinute: input.endMinute ?? null,
        created: result.created,
        // A booking made between the check and the write stops the remaining parts.
        conflicts: result.conflicts.map((c) => c.bookingCode),
      },
      reason,
    })
    if (result.conflicts.length > 0) return { ok: false, conflicts: result.conflicts }
    return { ok: true, created: result.created }
  }
}

/** A-22 一覧: blocks in effect from today on. */
export function makeListRoomBlocks(deps: RoomBlockDeps) {
  return async function listRoomBlocks(
    access: StaffAccess,
    selectedStoreId: number | null,
  ): Promise<RoomBlockRow[]> {
    const stores = storeFilter(access, 'bookings.manage', selectedStoreId)
    return deps.blocks.list(stores, deps.clock.now())
  }
}

export function makeListBlockRooms(deps: RoomBlockDeps) {
  return async function listBlockRooms(access: StaffAccess, storeId: number) {
    assertStoreAccess(access, 'bookings.manage', storeId)
    return deps.blocks.rooms(storeId)
  }
}

/**
 * A-22 「解除」. Releasing only frees time, so it does not need the inventory lock: a concurrent
 * availability check can at worst miss the newly freed time.
 */
export function makeReleaseRoomBlock(deps: RoomBlockDeps) {
  return async function releaseRoomBlock(access: StaffAccess, blockId: number) {
    const block = await deps.blocks.find(blockId)
    if (!block) throw new DomainError('block_not_found', 'block not found')
    assertStoreAccess(access, 'bookings.manage', block.storeId)
    if (block.releasedAt) return
    await deps.blocks.release(blockId, access.staffId, deps.clock.now())
    await deps.audit.record({
      actor: staffActor(access),
      action: 'room_block.release',
      targetType: 'room_block',
      targetId: blockId,
      storeId: block.storeId,
    })
  }
}
