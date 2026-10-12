import {
  addDays,
  assertCalendarOverride,
  assertCan,
  assertStoreCode,
  assertStoreDraft,
  assertWeeklyHours,
  can,
  DomainError,
  type LocalDate,
  parseLocalDate,
  type StoreDraft,
  visibleStoreIds,
  type WeeklyHours,
} from '@jancube/domain'
import type {
  BookingMode,
  CalendarDayView,
  RoomAdminRepository,
  RoomDraft,
  RoomPhoto,
  RoomStatus,
  StoreAdminRepository,
} from '../ports/admin-masters'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import {
  ADMIN_TIME_ZONE,
  assertAllStores,
  assertStore,
  auditActor,
  localToday,
  optionalText,
  requireText,
  type StaffActor,
} from './admin-actor'

export interface StoreAdminDeps {
  readonly storeAdmin: StoreAdminRepository
  readonly rooms: RoomAdminRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

/** Default weekly hours for a new store: every day 10:00–24:00 (current stores, A-18 Figma). */
export const DEFAULT_WEEKLY_HOURS: readonly WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map(
  (weekday) => ({
    weekday,
    opensMinute: 600,
    closesMinute: 1440,
    isClosed: false,
  }),
)

async function loadStore(deps: StoreAdminDeps, actor: StaffActor, storeId: number) {
  assertStore(actor, 'stores.manage', storeId)
  const store = await deps.storeAdmin.find(storeId)
  if (!store) throw new DomainError('store_not_found', 'store not found')
  return store
}

/**
 * Choices for master forms (target stores of coupons, store-specific templates, staff grants):
 * every store and room type, for staff holding any master permission.
 */
export function makeListMasterOptions(deps: StoreAdminDeps) {
  return async function listMasterOptions(actor: StaffActor) {
    const permissions = [
      'coupons.manage',
      'prices.manage',
      'stores.manage',
      'notifications.manage',
      'staff.manage',
    ] as const
    if (!permissions.some((p) => can(actor.access, p))) {
      throw new DomainError('forbidden', 'a master permission is required')
    }
    const [stores, roomTypes] = await Promise.all([deps.storeAdmin.list(), deps.rooms.roomTypes()])
    return {
      stores: stores.map((s) => ({ id: s.id, code: s.code, name: s.name })),
      roomTypes: roomTypes.map((t) => ({ id: t.id, code: t.code, name: t.name })),
    }
  }
}

/** A-18 店舗一覧 (only stores the staff member manages). */
export function makeListAdminStoreMasters(deps: StoreAdminDeps) {
  return async function listStoreMasters(actor: StaffActor) {
    assertCan(actor.access, 'stores.manage')
    const visible = visibleStoreIds(actor.access, 'stores.manage')
    const stores = await deps.storeAdmin.list()
    return visible === null ? stores : stores.filter((s) => visible.includes(s.id))
  }
}

/** A-18 店舗詳細: settings, weekly hours and calendar days from 30 days ago. */
export function makeGetStoreMaster(deps: StoreAdminDeps) {
  return async function getStoreMaster(actor: StaffActor, storeId: number) {
    const store = await loadStore(deps, actor, storeId)
    const from = addDays(localToday(deps.clock.now()), -30)
    return { store, calendar: await deps.storeAdmin.calendarDays(storeId, from) }
  }
}

/** A-18 店舗追加 (all-store administrators only). */
export function makeCreateStore(deps: StoreAdminDeps) {
  return async function createStore(
    actor: StaffActor,
    input: { code: string; store: StoreDraft },
  ): Promise<number> {
    assertAllStores(actor, 'stores.manage')
    const code = input.code.trim().toUpperCase()
    assertStoreCode(code)
    assertStoreDraft(input.store)
    if (await deps.storeAdmin.codeTaken(code)) {
      throw new DomainError('store_code_taken', 'this store code is already used')
    }
    const storeId = await deps.storeAdmin.create(
      { ...input.store, code, timezone: ADMIN_TIME_ZONE },
      DEFAULT_WEEKLY_HOURS,
    )
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'store.create',
      targetType: 'store',
      targetId: storeId,
      targetCode: code,
      storeId,
      after: input.store,
    })
    return storeId
  }
}

/** A-18 店舗編集: base information and booking settings (open date = F-MIG-04 cutover). */
export function makeUpdateStore(deps: StoreAdminDeps) {
  return async function updateStore(
    actor: StaffActor,
    storeId: number,
    draft: StoreDraft,
  ): Promise<void> {
    const before = await loadStore(deps, actor, storeId)
    assertStoreDraft(draft)
    const { id: _id, code: _code, timezone: _tz, weekly: _weekly, ...previous } = before
    await deps.storeAdmin.update(storeId, draft)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'store.update',
      targetType: 'store',
      targetId: storeId,
      targetCode: before.code,
      storeId,
      before: previous,
      after: draft,
    })
  }
}

/** A-18 通常営業時間 (all seven weekdays). */
export function makeSetWeeklyHours(deps: StoreAdminDeps) {
  return async function setWeeklyHours(
    actor: StaffActor,
    storeId: number,
    weekly: readonly WeeklyHours[],
  ): Promise<void> {
    const before = await loadStore(deps, actor, storeId)
    assertWeeklyHours(weekly)
    await deps.storeAdmin.setWeeklyHours(storeId, weekly)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'store.hours_update',
      targetType: 'store',
      targetId: storeId,
      targetCode: before.code,
      storeId,
      before: before.weekly,
      after: weekly,
    })
  }
}

/** A-18 休業日・特別営業時間 (store_calendar_days); one row per date. */
export function makeSaveCalendarDay(deps: StoreAdminDeps) {
  return async function saveCalendarDay(
    actor: StaffActor,
    storeId: number,
    day: CalendarDayView,
  ): Promise<void> {
    const store = await loadStore(deps, actor, storeId)
    assertCalendarOverride(day)
    const normalized: CalendarDayView = {
      ...day,
      opensMinute: day.isClosed ? null : day.opensMinute,
      closesMinute: day.isClosed ? null : day.closesMinute,
      reason: optionalText(day.reason, 500),
    }
    const before = (await deps.storeAdmin.calendarDays(storeId, day.date)).find(
      (d) => d.date === day.date,
    )
    await deps.storeAdmin.upsertCalendarDay(storeId, normalized)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'store.calendar_save',
      targetType: 'store',
      targetId: storeId,
      targetCode: store.code,
      storeId,
      before: before ?? null,
      after: normalized,
    })
  }
}

export function makeDeleteCalendarDay(deps: StoreAdminDeps) {
  return async function deleteCalendarDay(
    actor: StaffActor,
    storeId: number,
    date: LocalDate,
  ): Promise<void> {
    const store = await loadStore(deps, actor, storeId)
    parseLocalDate(date)
    const before = (await deps.storeAdmin.calendarDays(storeId, date)).find((d) => d.date === date)
    if (!before) return
    await deps.storeAdmin.deleteCalendarDay(storeId, date)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'store.calendar_delete',
      targetType: 'store',
      targetId: storeId,
      targetCode: store.code,
      storeId,
      before,
    })
  }
}

// ---------------------------------------------------------------- A-19 rooms

const ROOM_STATUSES: readonly RoomStatus[] = ['active', 'paused', 'broken']
const BOOKING_MODES: readonly BookingMode[] = ['group', 'named']
const MAX_PHOTOS = 10

function assertCode(code: string): string {
  const normalized = code.trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(normalized)) {
    throw new DomainError('invalid_code', 'use 1-32 letters, digits, - or _')
  }
  return normalized
}

function assertRoomDraft(d: RoomDraft): RoomDraft {
  if (!ROOM_STATUSES.includes(d.operatingStatus)) throw new DomainError('invalid_room', 'status')
  if (!Number.isInteger(d.sortOrder) || d.sortOrder < 0) {
    throw new DomainError('invalid_room', 'sort order must be zero or more')
  }
  return {
    ...d,
    name: requireText(d.name, 'name_required', 100),
    description: optionalText(d.description, 2000),
  }
}

/** Photo URLs (R2 upload is a follow-up; URLs of uploaded images are entered for now). */
function assertPhotos(photos: readonly RoomPhoto[]): RoomPhoto[] {
  if (photos.length > MAX_PHOTOS) throw new DomainError('invalid_room', 'too many photos')
  return photos.map((p) => {
    const url = p.url.trim()
    if (!/^https?:\/\/\S+$/.test(url) || url.length > 1000) {
      throw new DomainError('invalid_photo_url', 'photo URLs must start with http(s)://')
    }
    return { url, alt: optionalText(p.alt, 250) }
  })
}

/** A-19 部屋マスタ of one store: room types, room groups and rooms. */
export function makeGetRoomMaster(deps: StoreAdminDeps) {
  return async function getRoomMaster(actor: StaffActor, storeId: number) {
    const store = await loadStore(deps, actor, storeId)
    const [roomTypes, groups, rooms] = await Promise.all([
      deps.rooms.roomTypes(),
      deps.rooms.groups(storeId),
      deps.rooms.rooms(storeId, deps.clock.now()),
    ])
    return { store, roomTypes, groups, rooms }
  }
}

export function makeGetRoom(deps: StoreAdminDeps) {
  return async function getRoom(actor: StaffActor, roomId: number) {
    assertCan(actor.access, 'stores.manage')
    const room = await deps.rooms.findRoom(roomId, deps.clock.now())
    if (!room) throw new DomainError('room_not_found', 'room not found')
    assertStore(actor, 'stores.manage', room.storeId)
    return room
  }
}

/** Room types are shared by every store (4麻 / 3麻 / コンセプト / VIP …). */
export function makeSaveRoomType(deps: StoreAdminDeps) {
  return async function saveRoomType(
    actor: StaffActor,
    input: { id?: number | null; code: string; name: string; capacity: number; isActive: boolean },
  ): Promise<number> {
    assertAllStores(actor, 'stores.manage')
    const name = requireText(input.name, 'name_required', 100)
    if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 20) {
      throw new DomainError('invalid_room', 'capacity must be 1-20')
    }
    const values = { name, capacity: input.capacity, isActive: input.isActive }
    if (input.id) {
      const before = (await deps.rooms.roomTypes()).find((t) => t.id === input.id)
      if (!before) throw new DomainError('room_type_not_found', 'room type not found')
      await deps.rooms.updateRoomType(input.id, values)
      await deps.audit.record({
        actor: auditActor(actor),
        action: 'room_type.update',
        targetType: 'room_type',
        targetId: input.id,
        targetCode: before.code,
        before,
        after: values,
      })
      return input.id
    }
    const code = assertCode(input.code).toUpperCase()
    if (await deps.rooms.roomTypeCodeTaken(code)) {
      throw new DomainError('code_taken', 'this code is already used')
    }
    const id = await deps.rooms.createRoomType({ code, ...values })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'room_type.create',
      targetType: 'room_type',
      targetId: id,
      targetCode: code,
      after: values,
    })
    return id
  }
}

/** Room groups: the inventory unit customers book (booking mode group = any room, named = pick one). */
export function makeSaveRoomGroup(deps: StoreAdminDeps) {
  return async function saveRoomGroup(
    actor: StaffActor,
    input: {
      id?: number | null
      storeId: number
      roomTypeId: number
      code: string
      name: string
      bookingMode: string
      sortOrder: number
      isActive: boolean
    },
  ): Promise<number> {
    const bookingMode = BOOKING_MODES.find((m) => m === input.bookingMode)
    if (!bookingMode) throw new DomainError('invalid_room', 'unknown booking mode')
    const name = requireText(input.name, 'name_required', 100)
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
      throw new DomainError('invalid_room', 'sort order must be zero or more')
    }
    if (input.id) {
      const before = await deps.rooms.findGroup(input.id)
      if (!before) throw new DomainError('room_group_not_found', 'room group not found')
      assertStore(actor, 'stores.manage', before.storeId)
      const values = { name, bookingMode, sortOrder: input.sortOrder, isActive: input.isActive }
      await deps.rooms.updateGroup(input.id, values)
      await deps.audit.record({
        actor: auditActor(actor),
        action: 'room_group.update',
        targetType: 'room_group',
        targetId: input.id,
        targetCode: before.code,
        storeId: before.storeId,
        before,
        after: values,
      })
      return input.id
    }
    await loadStore(deps, actor, input.storeId)
    const code = assertCode(input.code)
    if (!(await deps.rooms.roomTypes()).some((t) => t.id === input.roomTypeId)) {
      throw new DomainError('room_type_not_found', 'room type not found')
    }
    if (await deps.rooms.groupCodeTaken(input.storeId, code)) {
      throw new DomainError('code_taken', 'this code is already used')
    }
    const values = {
      storeId: input.storeId,
      roomTypeId: input.roomTypeId,
      code,
      name,
      bookingMode,
      sortOrder: input.sortOrder,
    }
    const id = await deps.rooms.createGroup(values)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'room_group.create',
      targetType: 'room_group',
      targetId: id,
      targetCode: code,
      storeId: input.storeId,
      after: values,
    })
    return id
  }
}

/**
 * Rooms. Group (and so room type) is fixed after creation because bookings reference the
 * room/group pair; to move a room, pause it and add a new one.
 */
export function makeCreateRoom(deps: StoreAdminDeps) {
  return async function createRoom(
    actor: StaffActor,
    input: RoomDraft & { groupId: number; code: string; photos: readonly RoomPhoto[] },
  ): Promise<number> {
    const group = await deps.rooms.findGroup(input.groupId)
    if (!group) throw new DomainError('room_group_not_found', 'room group not found')
    assertStore(actor, 'stores.manage', group.storeId)
    const code = assertCode(input.code)
    const draft = assertRoomDraft(input)
    const photos = assertPhotos(input.photos)
    if (await deps.rooms.roomCodeTaken(group.storeId, code)) {
      throw new DomainError('code_taken', 'this room number is already used')
    }
    const id = await deps.rooms.createRoom({ ...draft, groupId: group.id, code })
    if (photos.length > 0) await deps.rooms.setPhotos(id, photos)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'room.create',
      targetType: 'room',
      targetId: id,
      targetCode: code,
      storeId: group.storeId,
      after: { ...draft, groupId: group.id, photos },
    })
    return id
  }
}

export function makeUpdateRoom(deps: StoreAdminDeps) {
  return async function updateRoom(
    actor: StaffActor,
    roomId: number,
    input: RoomDraft & { photos: readonly RoomPhoto[] },
  ): Promise<void> {
    const before = await deps.rooms.findRoom(roomId, deps.clock.now())
    if (!before) throw new DomainError('room_not_found', 'room not found')
    assertStore(actor, 'stores.manage', before.storeId)
    const draft = assertRoomDraft(input)
    const photos = assertPhotos(input.photos)
    await deps.rooms.updateRoom(roomId, draft)
    await deps.rooms.setPhotos(roomId, photos)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'room.update',
      targetType: 'room',
      targetId: roomId,
      targetCode: before.code,
      storeId: before.storeId,
      before: {
        name: before.name,
        description: before.description,
        operatingStatus: before.operatingStatus,
        isNamedBooking: before.isNamedBooking,
        isVipCandidate: before.isVipCandidate,
        sortOrder: before.sortOrder,
        photos: before.photos,
      },
      after: { ...draft, photos },
    })
  }
}
