import type { CalendarOverride, Store, WeeklyHours } from '@jancube/domain'
import type {
  BookingRepository,
  BookingSummary,
  NewDraftBooking,
} from '../ports/booking-repository'
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
import type { HoldDeps } from './hold'

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

/** In-memory hold storage on top of fakeBookingDeps (drafts are kept in `drafts`). */
export function fakeHoldDeps(now = '2026-11-01T12:00:00+09:00') {
  const base = fakeBookingDeps({ now })
  const drafts: (NewDraftBooking & { id: number; status: BookingSummary['status'] })[] = []
  let seq = 0
  const bookings: BookingRepository = {
    withInventoryLock: async (_g, _d, fn) =>
      fn({
        loadInventory: async (storeId, from, to, at) => {
          const inv = await base.inventory.load(storeId, from, to, at)
          const live = drafts.filter((d) => d.status === 'draft' && d.holdExpiresAt > at)
          return {
            ...inv,
            bookings: [
              ...inv.bookings,
              ...live.map((d) => ({
                groupId: d.roomGroupId,
                roomId: d.requestedRoomId,
                range: { start: d.start, end: d.end },
              })),
            ],
          }
        },
        bookingState: async () => ({ status: 'draft', holdExpiresAt: null }),
        cancel: async () => ({ cancellationId: 0 }),
        confirm: async () => {},
        recordUnconfirmablePayment: async () => ({ refundId: 0, idempotencyKey: '' }),
        createDraft: async (draft) => {
          seq++
          drafts.push({ ...draft, id: seq, status: 'draft' })
          return { id: seq, bookingCode: `JC-2026-${String(seq).padStart(6, '0')}` }
        },
      }),
    findByRequestKey: async (key) => summary(drafts.find((x) => x.requestKey === key)),
    expireDraft: async (key) => {
      for (const d of drafts) if (d.requestKey === key && d.status === 'draft') d.status = 'expired'
    },
    setGuestCount: async (key, n) => {
      const d = drafts.find((x) => x.requestKey === key)
      if (d) Object.assign(d, { guestCount: n })
    },
    assignMember: async (key, contact) => {
      const d = drafts.find((x) => x.requestKey === key)
      if (d) Object.assign(d, { contact: { ...contact } })
    },
    findByCode: async (code) =>
      summary(drafts.find((x) => `JC-2026-${String(x.id).padStart(6, '0')}` === code)),
  }
  function summary(d: (typeof drafts)[number] | undefined): BookingSummary | null {
    if (!d) return null
    return {
      id: d.id,
      bookingCode: `JC-2026-${String(d.id).padStart(6, '0')}`,
      status: d.status,
      storeId: d.storeId,
      storeCode: 'JC001',
      storeName: '大阪本町店',
      timezone: 'Asia/Tokyo',
      businessDate: d.businessDate,
      roomGroupId: d.roomGroupId,
      roomTypeId: 1,
      roomGroupName: '4麻ルーム',
      requestedRoomId: d.requestedRoomId,
      requestedRoomName: null,
      capacity: 4,
      start: d.start,
      end: d.end,
      guestCount: d.guestCount,
      holdExpiresAt: d.holdExpiresAt,
      memberId: d.contact?.memberId ?? null,
      regularPrice: d.quote.regularPrice,
      subtotal: d.quote.price,
      discount: 0,
      total: d.quote.price,
    }
  }
  let keys = 0
  const deps: HoldDeps = { ...base, bookings, newRequestKey: () => `key-${++keys}` }
  return { deps, drafts }
}
