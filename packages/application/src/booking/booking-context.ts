import {
  type AllocationInput,
  addDays,
  type BookingRules,
  DomainError,
  type LocalDate,
  type OpeningWindow,
  openingWindow,
  type Store,
  type TimeRange,
  utcToLocal,
} from '@jancube/domain'
import type { Clock } from '../ports/clock'
import type {
  InventoryRepository,
  PricedProfile,
  PricingRepository,
  RoomGroupInfo,
  RoomInfo,
  StoreInventory,
} from '../ports/inventory-repository'
import type { StoreRepository } from '../ports/store-repository'

/** Bookings must start at least this long from now (Q32 open; default 30 minutes). */
export const BOOKING_LEAD_MINUTES = 30

export interface BookingDeps {
  readonly stores: StoreRepository
  readonly inventory: InventoryRepository
  readonly pricing: PricingRepository
  readonly clock: Clock
}

/**
 * A row of the C-03 grid.
 * - group lane: a room type booked as a pool (4麻/3麻); a room is assigned later.
 * - room lane: a specific room the customer picks (コンセプト/VIP, booking_mode = named).
 */
export interface Lane {
  readonly key: string
  readonly kind: 'group' | 'room'
  readonly group: RoomGroupInfo
  readonly room: RoomInfo | null
  readonly rooms: readonly RoomInfo[]
}

export function buildLanes(inventory: StoreInventory): Lane[] {
  const lanes: Lane[] = []
  const groups = [...inventory.groups].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const group of groups) {
    const rooms = inventory.rooms
      .filter((r) => r.groupId === group.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    if (rooms.length === 0) continue
    if (group.bookingMode === 'group') {
      lanes.push({ key: `g:${group.code}`, kind: 'group', group, room: null, rooms })
    } else {
      for (const room of rooms) {
        lanes.push({ key: `r:${room.code}`, kind: 'room', group, room, rooms: [room] })
      }
    }
  }
  return lanes
}

/** Allocation input for one lane: its rooms with fixed bookings/blocks, plus unassigned group bookings. */
export function laneLoad(
  inventory: StoreInventory,
  lane: Lane,
  bufferMinutes: number,
): AllocationInput {
  const roomIds = new Set(lane.rooms.map((r) => r.id))
  return {
    bufferMinutes,
    rooms: lane.rooms.map((room) => ({
      roomId: room.id,
      bookings: inventory.bookings.filter((b) => b.roomId === room.id).map((b) => b.range),
      blocks: inventory.blocks.filter((b) => b.roomId === room.id).map((b) => b.range),
    })),
    flexible:
      lane.kind === 'group'
        ? inventory.bookings
            .filter(
              (b) => b.groupId === lane.group.id && (b.roomId === null || !roomIds.has(b.roomId)),
            )
            .map((b) => b.range)
        : [],
  }
}

export interface DayContext {
  readonly store: Store
  readonly now: Date
  readonly window: OpeningWindow
  readonly inventory: StoreInventory
  readonly lanes: readonly Lane[]
}

/** Everything needed to show or validate bookings for one store and business date. */
export async function loadDayContext(
  deps: BookingDeps,
  storeCode: string,
  date: LocalDate,
): Promise<DayContext> {
  const store = await requireStore(deps, storeCode)
  const now = deps.clock.now()
  const { first, last } = bookableDateRange(store, now)
  if (date < first || date > last) {
    throw new DomainError('date_not_bookable', 'this date cannot be booked')
  }
  const [weekly, overrides] = await Promise.all([
    deps.stores.weeklyHours(store.id),
    deps.stores.calendarOverrides(store.id, date, date),
  ])
  const window = openingWindow(date, store.timezone, weekly, overrides[0])
  if (!window) throw new DomainError('store_closed', 'the store is closed on this date')
  const inventory = await deps.inventory.load(store.id, window.opensAt, window.closesAt, now)
  return { store, now, window, inventory, lanes: buildLanes(inventory) }
}

export async function requireStore(
  deps: Pick<BookingDeps, 'stores'>,
  storeCode: string,
): Promise<Store> {
  const store = await deps.stores.findActiveByCode(storeCode)
  if (!store) throw new DomainError('store_not_found', 'store not found')
  return store
}

/** First and last usage dates a customer can book today (cutover date and booking horizon). */
export function bookableDateRange(
  store: Store,
  now: Date,
): { today: LocalDate; first: LocalDate; last: LocalDate } {
  const today = utcToLocal(now, store.timezone).date
  const first = store.booking.openDate > today ? store.booking.openDate : today
  return { today, first, last: addDays(today, store.booking.horizonDays) }
}

export function findLane(ctx: DayContext, laneKey: string): Lane {
  const lane = ctx.lanes.find((l) => l.key === laneKey)
  if (!lane) throw new DomainError('room_not_found', 'room type not found')
  return lane
}

/** Price profile of a lane: the room's own profile, or the first room's for a group (Q-12 open). */
export async function lanePricing(deps: BookingDeps, lane: Lane, at: Date): Promise<PricedProfile> {
  const room = lane.rooms[0]
  const priced = room ? await deps.pricing.forRoom(room.id, at) : null
  if (!priced) throw new DomainError('price_not_set', 'no price is set for this room')
  return priced
}

export function bookingRules(priced: PricedProfile): BookingRules {
  return { minimumMinutes: priced.minimumMinutes, leadMinutes: BOOKING_LEAD_MINUTES }
}

export function rangeMinutes(range: TimeRange, clipFrom: Date, clipTo: Date): number {
  const start = Math.max(range.start.getTime(), clipFrom.getTime())
  const end = Math.min(range.end.getTime(), clipTo.getTime())
  return Math.max(0, (end - start) / 60_000)
}
