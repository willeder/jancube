import type { ListedStore, StoreRepository } from '@jancube/application'
import type { CalendarOverride, LocalDate, Store, StoreStatus, WeeklyHours } from '@jancube/domain'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

const storeColumns = [
  'id',
  'code',
  'name',
  'address',
  'access_text',
  'map_url',
  'timezone',
  'status',
  'is_active',
  'booking_open_date',
  'booking_horizon_days',
  'hold_minutes',
  'proxy_hold_minutes',
  'cleaning_buffer_minutes',
] as const

export class KyselyStoreRepository implements StoreRepository {
  constructor(private readonly db: Database) {}

  async listActive(): Promise<ListedStore[]> {
    const rows = await this.db
      .selectFrom('stores')
      .select(storeColumns)
      .where('is_active', '=', 1)
      .orderBy('code')
      .execute()
    if (rows.length === 0) return []
    // One hours query for the entire listing avoids an extra query per store as the estate grows.
    const hours = await this.db
      .selectFrom('store_business_hours')
      .select(['store_id', 'weekday', 'opens_minute', 'closes_minute', 'is_closed'])
      .where(
        'store_id',
        'in',
        rows.map((row) => row.id),
      )
      .execute()
    const byStore = new Map<number, WeeklyHours[]>()
    for (const row of hours) {
      const id = Number(row.store_id)
      const weekly = byStore.get(id) ?? []
      weekly.push({
        weekday: row.weekday,
        opensMinute: row.opens_minute,
        closesMinute: row.closes_minute,
        isClosed: row.is_closed === 1,
      })
      byStore.set(id, weekly)
    }
    return rows.map((row) => ({ ...toStore(row), regularHours: byStore.get(Number(row.id)) ?? [] }))
  }

  async findActiveByCode(code: string): Promise<Store | null> {
    const row = await this.db
      .selectFrom('stores')
      .select(storeColumns)
      .where('code', '=', code)
      .where('is_active', '=', 1)
      .executeTakeFirst()
    return row ? toStore(row) : null
  }

  async weeklyHours(storeId: number): Promise<WeeklyHours[]> {
    const rows = await this.db
      .selectFrom('store_business_hours')
      .select(['weekday', 'opens_minute', 'closes_minute', 'is_closed'])
      .where('store_id', '=', storeId)
      .execute()
    return rows.map((r) => ({
      weekday: r.weekday,
      opensMinute: r.opens_minute,
      closesMinute: r.closes_minute,
      isClosed: r.is_closed === 1,
    }))
  }

  async calendarOverrides(
    storeId: number,
    from: LocalDate,
    to: LocalDate,
  ): Promise<CalendarOverride[]> {
    const rows = await this.db
      .selectFrom('store_calendar_days')
      .select(['business_date', 'is_closed', 'opens_minute', 'closes_minute'])
      .where('store_id', '=', storeId)
      .where('business_date', '>=', new Date(`${from}T00:00:00Z`))
      .where('business_date', '<=', new Date(`${to}T00:00:00Z`))
      .execute()
    return rows.map((r) => ({
      date: toLocalDate(r.business_date),
      isClosed: r.is_closed === 1,
      opensMinute: r.opens_minute,
      closesMinute: r.closes_minute,
    }))
  }
}

type StoreRow = {
  id: number
  code: string
  name: string
  address: string
  access_text: string | null
  map_url: string | null
  timezone: string
  status: string
  is_active: number
  booking_open_date: Date | string
  booking_horizon_days: number
  hold_minutes: number
  proxy_hold_minutes: number
  cleaning_buffer_minutes: number
}

function toStore(r: StoreRow): Store {
  return {
    id: Number(r.id),
    code: r.code,
    name: r.name,
    address: r.address,
    accessText: r.access_text,
    mapUrl: r.map_url,
    timezone: r.timezone,
    status: r.status as StoreStatus,
    isActive: r.is_active === 1,
    booking: {
      openDate: toLocalDate(r.booking_open_date),
      horizonDays: r.booking_horizon_days,
      holdMinutes: r.hold_minutes,
      proxyHoldMinutes: r.proxy_hold_minutes,
      cleaningBufferMinutes: r.cleaning_buffer_minutes,
    },
  }
}
