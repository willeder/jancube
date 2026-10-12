import type { StoreDraft } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import type {
  CalendarDayView,
  RoomAdminRepository,
  RoomGroupView,
  StoreAdminRepository,
  StoreAdminView,
} from '../ports/admin-masters'
import type { StaffActor } from './admin-actor'
import {
  DEFAULT_WEEKLY_HOURS,
  makeCreateRoom,
  makeCreateStore,
  makeSaveCalendarDay,
  makeSetWeeklyHours,
  makeUpdateStore,
} from './stores'

const owner: StaffActor = {
  staffId: 1,
  access: { staffId: 1, grants: [{ role: 'owner', storeId: null }] },
}
const storeAdmin: StaffActor = {
  staffId: 3,
  access: { staffId: 3, grants: [{ role: 'admin', storeId: 1 }] },
}

const draft: StoreDraft = {
  name: '大阪本町店',
  address: '大阪市中央区瓦町3-2-7',
  phone: null,
  accessText: null,
  noticeText: null,
  mapUrl: null,
  entryGuideUrl: null,
  entryGuideText: null,
  bookingOpenDate: '2026-10-19',
  bookingHorizonDays: 60,
  holdMinutes: 10,
  proxyHoldMinutes: 30,
  cleaningBufferMinutes: 15,
  roomFinalizeMinutes: null,
  keyBeforeMinutes: 15,
  keyAfterMinutes: 15,
  status: 'open',
  isActive: true,
}

function world() {
  const stores: StoreAdminView[] = [
    { ...draft, id: 1, code: 'JC001', timezone: 'Asia/Tokyo', weekly: DEFAULT_WEEKLY_HOURS },
  ]
  const calendar: CalendarDayView[] = []
  const audits: { action: string; before?: unknown; after?: unknown }[] = []
  const storeRepo: StoreAdminRepository = {
    list: async () => stores,
    find: async (id) => stores.find((s) => s.id === id) ?? null,
    codeTaken: async (code) => stores.some((s) => s.code === code),
    create: async (s, weekly) => {
      stores.push({ ...s, id: stores.length + 1, weekly })
      return stores.length
    },
    update: async (id, d) => {
      Object.assign(stores.find((s) => s.id === id) ?? {}, d)
    },
    setWeeklyHours: async () => {},
    calendarDays: async () => calendar,
    upsertCalendarDay: async (_id, day) => void calendar.push(day),
    deleteCalendarDay: async () => {},
  }
  const group: RoomGroupView = {
    id: 4,
    storeId: 1,
    roomTypeId: 1,
    roomTypeName: '4麻',
    code: '4MA',
    name: '4麻ルーム',
    bookingMode: 'group',
    sortOrder: 1,
    isActive: true,
    roomCount: 0,
  }
  const photos: unknown[] = []
  const rooms = {
    findGroup: async (id: number) => (id === 4 ? group : null),
    roomCodeTaken: async (_s: number, code: string) => code === 'Room1',
    createRoom: async () => 77,
    setPhotos: async (_id: number, p: unknown[]) => void photos.push(...p),
  } as unknown as RoomAdminRepository
  const deps = {
    storeAdmin: storeRepo,
    rooms,
    audit: { record: async (e: (typeof audits)[number]) => void audits.push(e) },
    clock: { now: () => new Date('2026-10-12T03:00:00Z') },
  }
  return { deps, stores, audits, calendar, photos }
}

describe('store master (A-18)', () => {
  it('only all-store administrators add stores', async () => {
    const { deps, stores } = world()
    await expect(
      makeCreateStore(deps)(storeAdmin, { code: 'JC004', store: draft }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await makeCreateStore(deps)(owner, { code: 'jc004', store: draft })
    expect(stores[1]).toMatchObject({ code: 'JC004', timezone: 'Asia/Tokyo' })
    await expect(
      makeCreateStore(deps)(owner, { code: 'JC004', store: draft }),
    ).rejects.toMatchObject({ code: 'store_code_taken' })
  })

  it('updates booking settings (cutover date) with before/after in the audit log', async () => {
    const { deps, audits, stores } = world()
    await makeUpdateStore(deps)(storeAdmin, 1, { ...draft, bookingOpenDate: '2026-11-01' })
    expect(stores[0]?.bookingOpenDate).toBe('2026-11-01')
    expect(audits[0]).toMatchObject({
      action: 'store.update',
      before: { bookingOpenDate: '2026-10-19' },
      after: { bookingOpenDate: '2026-11-01' },
    })
    await expect(
      makeUpdateStore(deps)(storeAdmin, 1, { ...draft, holdMinutes: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_store' })
  })

  it('validates weekly hours and calendar days', async () => {
    const { deps, calendar } = world()
    await expect(
      makeSetWeeklyHours(deps)(owner, 1, DEFAULT_WEEKLY_HOURS.slice(0, 6)),
    ).rejects.toMatchObject({ code: 'invalid_store' })
    await makeSaveCalendarDay(deps)(owner, 1, {
      date: '2026-12-31',
      isClosed: true,
      isHoliday: false,
      opensMinute: 600,
      closesMinute: 1440,
      reason: ' 年末休業 ',
    })
    expect(calendar[0]).toMatchObject({ opensMinute: null, closesMinute: null, reason: '年末休業' })
  })
})

describe('room master (A-19)', () => {
  it('creates a room in a group with photo URLs and rejects duplicate numbers', async () => {
    const { deps, photos } = world()
    const room = {
      groupId: 4,
      code: 'Room20',
      name: 'Room20',
      description: null,
      operatingStatus: 'active' as const,
      isNamedBooking: false,
      isVipCandidate: false,
      sortOrder: 20,
      photos: [{ url: 'https://example.com/r20.jpg', alt: null }],
    }
    expect(await makeCreateRoom(deps)(owner, room)).toBe(77)
    expect(photos).toHaveLength(1)
    await expect(makeCreateRoom(deps)(owner, { ...room, code: 'Room1' })).rejects.toMatchObject({
      code: 'code_taken',
    })
    await expect(
      makeCreateRoom(deps)(owner, {
        ...room,
        code: 'Room21',
        photos: [{ url: 'ftp://x', alt: null }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_photo_url' })
  })
})
