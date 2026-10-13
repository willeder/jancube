import type {
  BookingMode,
  CalendarDayView,
  RoomAdminRepository,
  RoomDraft,
  RoomPhoto,
  RoomStatus,
  RoomView,
  StoreAdminRepository,
  StoreAdminView,
} from '@jancube/application'
import type { LocalDate, StoreDraft, StoreStatus, WeeklyHours } from '@jancube/domain'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

const dateValue = (date: LocalDate) => new Date(`${date}T00:00:00Z`)

const storeValues = (d: StoreDraft) => ({
  name: d.name,
  address: d.address,
  phone: d.phone,
  access_text: d.accessText,
  notice_text: d.noticeText,
  map_url: d.mapUrl,
  entry_guide_url: d.entryGuideUrl,
  entry_guide_text: d.entryGuideText,
  booking_open_date: dateValue(d.bookingOpenDate),
  booking_horizon_days: d.bookingHorizonDays,
  hold_minutes: d.holdMinutes,
  proxy_hold_minutes: d.proxyHoldMinutes,
  cleaning_buffer_minutes: d.cleaningBufferMinutes,
  room_finalize_minutes: d.roomFinalizeMinutes,
  key_before_minutes: d.keyBeforeMinutes,
  key_after_minutes: d.keyAfterMinutes,
  status: d.status,
  is_active: d.isActive ? 1 : 0,
})

/** A-18 store master: every store (including inactive ones), hours and calendar days. */
export class KyselyStoreAdminRepository implements StoreAdminRepository {
  constructor(private readonly db: Database) {}

  private async load(storeId?: number): Promise<StoreAdminView[]> {
    let query = this.db
      .selectFrom('stores')
      .select([
        'id',
        'code',
        'name',
        'address',
        'phone',
        'access_text',
        'notice_text',
        'map_url',
        'entry_guide_url',
        'entry_guide_text',
        'timezone',
        'booking_open_date',
        'booking_horizon_days',
        'hold_minutes',
        'proxy_hold_minutes',
        'cleaning_buffer_minutes',
        'room_finalize_minutes',
        'key_before_minutes',
        'key_after_minutes',
        'status',
        'is_active',
      ])
    if (storeId !== undefined) query = query.where('id', '=', storeId)
    const rows = await query.orderBy('code').execute()
    const ids = rows.map((r) => r.id)
    const hours = ids.length
      ? await this.db
          .selectFrom('store_business_hours')
          .select(['store_id', 'weekday', 'opens_minute', 'closes_minute', 'is_closed'])
          .where('store_id', 'in', ids)
          .orderBy('weekday')
          .execute()
      : []
    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      timezone: r.timezone,
      name: r.name,
      address: r.address,
      phone: r.phone,
      accessText: r.access_text,
      noticeText: r.notice_text,
      mapUrl: r.map_url,
      entryGuideUrl: r.entry_guide_url,
      entryGuideText: r.entry_guide_text,
      bookingOpenDate: toLocalDate(r.booking_open_date),
      bookingHorizonDays: r.booking_horizon_days,
      holdMinutes: r.hold_minutes,
      proxyHoldMinutes: r.proxy_hold_minutes,
      cleaningBufferMinutes: r.cleaning_buffer_minutes,
      roomFinalizeMinutes: r.room_finalize_minutes,
      keyBeforeMinutes: r.key_before_minutes,
      keyAfterMinutes: r.key_after_minutes,
      status: r.status as StoreStatus,
      isActive: r.is_active === 1,
      weekly: hours
        .filter((h) => h.store_id === r.id)
        .map((h) => ({
          weekday: h.weekday,
          opensMinute: h.opens_minute,
          closesMinute: h.closes_minute,
          isClosed: h.is_closed === 1,
        })),
    }))
  }

  list() {
    return this.load()
  }

  async find(storeId: number) {
    const [store] = await this.load(storeId)
    return store ?? null
  }

  async codeTaken(code: string) {
    const row = await this.db
      .selectFrom('stores')
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst()
    return !!row
  }

  create(store: StoreDraft & { code: string; timezone: string }, weekly: readonly WeeklyHours[]) {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('stores')
        .values({ ...storeValues(store), code: store.code, timezone: store.timezone })
        .executeTakeFirstOrThrow()
      const storeId = Number(inserted.insertId)
      await trx
        .insertInto('store_business_hours')
        .values(
          weekly.map((h) => ({
            store_id: storeId,
            weekday: h.weekday,
            opens_minute: h.opensMinute,
            closes_minute: h.closesMinute,
            is_closed: h.isClosed ? 1 : 0,
          })),
        )
        .execute()
      return storeId
    })
  }

  async update(storeId: number, store: StoreDraft) {
    await this.db.updateTable('stores').set(storeValues(store)).where('id', '=', storeId).execute()
  }

  async setWeeklyHours(storeId: number, weekly: readonly WeeklyHours[]) {
    await this.db.transaction().execute(async (trx) => {
      for (const h of weekly) {
        await trx
          .insertInto('store_business_hours')
          .values({
            store_id: storeId,
            weekday: h.weekday,
            opens_minute: h.opensMinute,
            closes_minute: h.closesMinute,
            is_closed: h.isClosed ? 1 : 0,
          })
          .onDuplicateKeyUpdate({
            opens_minute: h.opensMinute,
            closes_minute: h.closesMinute,
            is_closed: h.isClosed ? 1 : 0,
          })
          .execute()
      }
    })
  }

  async calendarDays(storeId: number, from: LocalDate): Promise<CalendarDayView[]> {
    const rows = await this.db
      .selectFrom('store_calendar_days')
      .select([
        'business_date',
        'is_closed',
        'is_holiday',
        'opens_minute',
        'closes_minute',
        'reason',
      ])
      .where('store_id', '=', storeId)
      .where('business_date', '>=', dateValue(from))
      .orderBy('business_date')
      .limit(500)
      .execute()
    return rows.map((r) => ({
      date: toLocalDate(r.business_date),
      isClosed: r.is_closed === 1,
      isHoliday: r.is_holiday === 1,
      opensMinute: r.opens_minute,
      closesMinute: r.closes_minute,
      reason: r.reason,
    }))
  }

  async upsertCalendarDay(storeId: number, day: CalendarDayView) {
    const values = {
      is_closed: day.isClosed ? 1 : 0,
      is_holiday: day.isHoliday ? 1 : 0,
      opens_minute: day.opensMinute,
      closes_minute: day.closesMinute,
      reason: day.reason,
    }
    await this.db
      .insertInto('store_calendar_days')
      .values({ store_id: storeId, business_date: dateValue(day.date), ...values })
      .onDuplicateKeyUpdate(values)
      .execute()
  }

  async deleteCalendarDay(storeId: number, date: LocalDate) {
    await this.db
      .deleteFrom('store_calendar_days')
      .where('store_id', '=', storeId)
      .where('business_date', '=', dateValue(date))
      .execute()
  }
}

/** A-19 room master: room types, room groups, rooms and photos. */
export class KyselyRoomAdminRepository implements RoomAdminRepository {
  constructor(private readonly db: Database) {}

  async roomTypes() {
    const rows = await this.db
      .selectFrom('room_types')
      .select(['id', 'code', 'name', 'capacity', 'is_active'])
      .orderBy('id')
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      name: r.name,
      capacity: r.capacity,
      isActive: r.is_active === 1,
    }))
  }

  async roomTypeCodeTaken(code: string) {
    const row = await this.db
      .selectFrom('room_types')
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst()
    return !!row
  }

  async createRoomType(type: { code: string; name: string; capacity: number; isActive: boolean }) {
    const inserted = await this.db
      .insertInto('room_types')
      .values({
        code: type.code,
        name: type.name,
        capacity: type.capacity,
        is_active: type.isActive ? 1 : 0,
      })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async updateRoomType(id: number, values: { name: string; capacity: number; isActive: boolean }) {
    await this.db
      .updateTable('room_types')
      .set({ name: values.name, capacity: values.capacity, is_active: values.isActive ? 1 : 0 })
      .where('id', '=', id)
      .execute()
  }

  private groupQuery() {
    return this.db
      .selectFrom('room_groups as g')
      .innerJoin('room_types as t', 't.id', 'g.room_type_id')
      .select([
        'g.id',
        'g.store_id',
        'g.room_type_id',
        't.name as room_type_name',
        'g.code',
        'g.name',
        'g.booking_mode',
        'g.sort_order',
        'g.is_active',
      ])
      .select((eb) =>
        eb
          .selectFrom('rooms')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('rooms.room_group_id', '=', 'g.id')
          .as('room_count'),
      )
  }

  async groups(storeId: number) {
    const rows = await this.groupQuery()
      .where('g.store_id', '=', storeId)
      .orderBy('g.sort_order')
      .orderBy('g.code')
      .execute()
    return rows.map(toGroup)
  }

  async findGroup(groupId: number) {
    const row = await this.groupQuery().where('g.id', '=', groupId).executeTakeFirst()
    return row ? toGroup(row) : null
  }

  async groupCodeTaken(storeId: number, code: string) {
    const row = await this.db
      .selectFrom('room_groups')
      .select('id')
      .where('store_id', '=', storeId)
      .where('code', '=', code)
      .executeTakeFirst()
    return !!row
  }

  async createGroup(group: Parameters<RoomAdminRepository['createGroup']>[0]) {
    const inserted = await this.db
      .insertInto('room_groups')
      .values({
        store_id: group.storeId,
        room_type_id: group.roomTypeId,
        code: group.code,
        name: group.name,
        booking_mode: group.bookingMode,
        sort_order: group.sortOrder,
      })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async updateGroup(groupId: number, values: Parameters<RoomAdminRepository['updateGroup']>[1]) {
    await this.db
      .updateTable('room_groups')
      .set({
        name: values.name,
        booking_mode: values.bookingMode,
        sort_order: values.sortOrder,
        is_active: values.isActive ? 1 : 0,
      })
      .where('id', '=', groupId)
      .execute()
  }

  private roomQuery(at: Date) {
    return this.db
      .selectFrom('rooms as r')
      .innerJoin('room_groups as g', 'g.id', 'r.room_group_id')
      .innerJoin('room_types as t', 't.id', 'r.room_type_id')
      .select([
        'r.id',
        'r.store_id',
        'r.room_group_id',
        'g.name as group_name',
        't.name as room_type_name',
        'r.code',
        'r.name',
        'r.description',
        'r.operating_status',
        'r.cleaning_status',
        'r.is_named_booking',
        'r.is_vip_candidate',
        'r.sort_order',
      ])
      .select((eb) => [
        eb
          .selectFrom('room_photos')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('room_photos.room_id', '=', 'r.id')
          .as('photo_count'),
        eb
          .selectFrom('price_assignments as a')
          .innerJoin('price_profile_versions as v', 'v.id', 'a.price_version_id')
          .innerJoin('price_profiles as p', 'p.id', 'v.price_profile_id')
          .select('p.name')
          .whereRef('a.room_id', '=', 'r.id')
          .where('a.valid_from', '<=', at)
          .where((e) => e.or([e('a.valid_to', 'is', null), e('a.valid_to', '>', at)]))
          .orderBy('a.priority', 'desc')
          .orderBy('a.valid_from', 'desc')
          .limit(1)
          .as('price_profile_name'),
      ])
  }

  async rooms(storeId: number, at: Date) {
    const rows = await this.roomQuery(at)
      .where('r.store_id', '=', storeId)
      .orderBy('r.sort_order')
      .orderBy('r.code')
      .execute()
    return rows.map(toRoom)
  }

  async findRoom(roomId: number, at: Date) {
    const row = await this.roomQuery(at).where('r.id', '=', roomId).executeTakeFirst()
    if (!row) return null
    const photos = await this.db
      .selectFrom('room_photos')
      .select(['asset_url', 'alt_text'])
      .where('room_id', '=', roomId)
      .orderBy('sort_order')
      .orderBy('id')
      .execute()
    return { ...toRoom(row), photos: photos.map((p) => ({ url: p.asset_url, alt: p.alt_text })) }
  }

  async roomCodeTaken(storeId: number, code: string) {
    const row = await this.db
      .selectFrom('rooms')
      .select('id')
      .where('store_id', '=', storeId)
      .where('code', '=', code)
      .executeTakeFirst()
    return !!row
  }

  async createRoom(room: RoomDraft & { groupId: number; code: string }) {
    const group = await this.db
      .selectFrom('room_groups')
      .select(['store_id', 'room_type_id'])
      .where('id', '=', room.groupId)
      .executeTakeFirstOrThrow()
    const inserted = await this.db
      .insertInto('rooms')
      .values({
        store_id: group.store_id,
        room_group_id: room.groupId,
        room_type_id: group.room_type_id,
        code: room.code,
        ...roomValues(room),
      })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async updateRoom(roomId: number, values: RoomDraft) {
    await this.db.updateTable('rooms').set(roomValues(values)).where('id', '=', roomId).execute()
  }

  async setPhotos(roomId: number, photos: readonly RoomPhoto[]) {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('room_photos').where('room_id', '=', roomId).execute()
      if (photos.length > 0) {
        await trx
          .insertInto('room_photos')
          .values(
            photos.map((p, i) => ({
              room_id: roomId,
              asset_url: p.url,
              alt_text: p.alt,
              sort_order: i + 1,
            })),
          )
          .execute()
      }
    })
  }
}

const roomValues = (d: RoomDraft) => ({
  name: d.name,
  description: d.description,
  operating_status: d.operatingStatus,
  is_named_booking: d.isNamedBooking ? 1 : 0,
  is_vip_candidate: d.isVipCandidate ? 1 : 0,
  sort_order: d.sortOrder,
})

function toGroup(r: {
  id: number
  store_id: number
  room_type_id: number
  room_type_name: string
  code: string
  name: string
  booking_mode: string
  sort_order: number
  is_active: number
  room_count: number | null
}) {
  return {
    id: Number(r.id),
    storeId: Number(r.store_id),
    roomTypeId: Number(r.room_type_id),
    roomTypeName: r.room_type_name,
    code: r.code,
    name: r.name,
    bookingMode: r.booking_mode as BookingMode,
    sortOrder: r.sort_order,
    isActive: r.is_active === 1,
    roomCount: Number(r.room_count ?? 0),
  }
}

function toRoom(r: {
  id: number
  store_id: number
  room_group_id: number
  group_name: string
  room_type_name: string
  code: string
  name: string
  description: string | null
  operating_status: string
  cleaning_status: string
  is_named_booking: number
  is_vip_candidate: number
  sort_order: number
  photo_count: number | null
  price_profile_name: string | null
}): RoomView {
  return {
    id: Number(r.id),
    storeId: Number(r.store_id),
    groupId: Number(r.room_group_id),
    groupName: r.group_name,
    roomTypeName: r.room_type_name,
    code: r.code,
    name: r.name,
    description: r.description,
    operatingStatus: r.operating_status as RoomStatus,
    cleaningStatus: r.cleaning_status,
    isNamedBooking: r.is_named_booking === 1,
    isVipCandidate: r.is_vip_candidate === 1,
    sortOrder: r.sort_order,
    photoCount: Number(r.photo_count ?? 0),
    priceProfileName: r.price_profile_name,
  }
}
