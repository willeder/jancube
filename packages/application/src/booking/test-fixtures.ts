import type { CalendarOverride, Store, WeeklyHours } from '@jancube/domain'
import type { Clock } from '../ports/clock'
import type {
  InventoryRepository,
  OccupyingBooking,
  PricedProfile,
  RoomBlock,
  RoomGroupInfo,
  RoomInfo,
} from '../ports/inventory-repository'
import type { StoreRepository } from '../ports/store-repository'
import type { BookingDeps } from './booking-context'

/** In-memory adapters for use-case tests. */
export function fakeBookingDeps(options: {
  now: string
  bookings?: OccupyingBooking[]
  blocks?: RoomBlock[]
  overrides?: CalendarOverride[]
  store?: Partial<Store['booking']>
}): BookingDeps & { inventoryLoads: number } {
  const store: Store = {
    id: 1,
    code: 'JC001',
    name: '大阪本町店',
    address: '大阪市',
    accessText: null,
    mapUrl: null,
    timezone: 'Asia/Tokyo',
    status: 'open',
    isActive: true,
    booking: {
      openDate: '2026-10-19',
      horizonDays: 60,
      holdMinutes: 10,
      proxyHoldMinutes: 30,
      cleaningBufferMinutes: 15,
      ...options.store,
    },
  }
  const weekly: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    opensMinute: 600,
    closesMinute: 1440,
    isClosed: false,
  }))
  const groups: RoomGroupInfo[] = [
    { id: 10, code: '4MA', name: '4麻ルーム', bookingMode: 'group', capacity: 4, sortOrder: 1 },
    { id: 20, code: 'VIP', name: 'VIPルーム', bookingMode: 'named', capacity: 4, sortOrder: 4 },
  ]
  const rooms: RoomInfo[] = [
    { id: 1, groupId: 10, code: 'Room1', name: 'Room1', description: null, sortOrder: 1 },
    { id: 2, groupId: 10, code: 'Room2', name: 'Room2', description: null, sortOrder: 2 },
    { id: 12, groupId: 20, code: 'Room12', name: 'Room12', description: 'VIP', sortOrder: 12 },
  ]
  const standard: PricedProfile = {
    priceVersionId: 1,
    minimumMinutes: 60,
    taxRatePercent: 10,
    profile: {
      hourlyRate: 1_500,
      packages: [{ minutes: 240, price: 5_800 }],
      combinationRule: 'cheapest-combination',
    },
  }
  const vip: PricedProfile = {
    ...standard,
    priceVersionId: 2,
    profile: { ...standard.profile, hourlyRate: 2_500, packages: [] },
  }

  const stores: StoreRepository = {
    listActive: async () => [store],
    findActiveByCode: async (code) => (code === store.code ? store : null),
    weeklyHours: async () => weekly,
    calendarOverrides: async (_id, from, to) =>
      (options.overrides ?? []).filter((o) => o.date >= from && o.date <= to),
  }
  const deps = {
    inventoryLoads: 0,
    stores,
    clock: { now: () => new Date(options.now) } satisfies Clock,
    pricing: { forRoom: async (roomId: number) => (roomId === 12 ? vip : standard) },
    inventory: {
      load: async () => {
        deps.inventoryLoads++
        return { groups, rooms, bookings: options.bookings ?? [], blocks: options.blocks ?? [] }
      },
    } satisfies InventoryRepository,
  }
  return deps
}

export const jst = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`)
