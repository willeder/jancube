import {
  addDays,
  type LocalDate,
  openingWindow,
  type StaffAccess,
  type Store,
  utcToLocal,
} from '@jancube/domain'
import type {
  AdminBookingQueries,
  AdminBookingRow,
  AlertRow,
  AlertWorkRepository,
  DailySales,
  SourceBreakdown,
  StoreFilter,
} from '../ports/admin-bookings'
import type { Clock } from '../ports/clock'
import type { StoreRepository } from '../ports/store-repository'
import { storeFilter } from './access'

export interface DashboardDeps {
  readonly queries: AdminBookingQueries
  readonly alerts: AlertWorkRepository
  readonly stores: StoreRepository
  readonly clock: Clock
}

/**
 * A-02 ダッシュボード. Which metrics are required, their period and scope are still open (tracker #25);
 * this is the first set shown in the wireframe:
 * - sales = total of confirmed/completed bookings whose business date is in the current month
 * - utilization = booked room-minutes ÷ (rooms in service × opening minutes) for the whole month
 * - unassigned = confirmed group bookings from today on without a room
 */
export interface Dashboard {
  readonly today: LocalDate
  readonly monthLabel: string
  readonly monthSales: number
  readonly monthBookings: number
  /** null when no opening hours or rooms are configured. */
  readonly utilizationPercent: number | null
  readonly todayCount: number
  readonly unassignedCount: number
  readonly roomsNeedingCleaning: number
  readonly criticalAlerts: readonly AlertRow[]
  readonly daily: readonly DailySales[]
  readonly todayBookings: readonly AdminBookingRow[]
  readonly sources: readonly SourceBreakdown[]
}

const DAILY_DAYS = 14

export function monthRange(today: LocalDate): { first: LocalDate; last: LocalDate } {
  const first = `${today.slice(0, 7)}-01`
  const [y, m] = first.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { first, last }
}

/** Opening minutes × rooms in service of the stores over [first, last]. */
export async function capacityMinutes(
  stores: StoreRepository,
  targets: readonly Store[],
  rooms: readonly { storeId: number; rooms: number }[],
  first: LocalDate,
  last: LocalDate,
): Promise<number> {
  let total = 0
  for (const store of targets) {
    const roomCount = rooms.find((r) => r.storeId === store.id)?.rooms ?? 0
    if (roomCount === 0) continue
    const [weekly, overrides] = await Promise.all([
      stores.weeklyHours(store.id),
      stores.calendarOverrides(store.id, first, last),
    ])
    for (let date = first; date <= last; date = addDays(date, 1)) {
      const window = openingWindow(
        date,
        store.timezone,
        weekly,
        overrides.find((o) => o.date === date),
      )
      if (window) total += (window.closesMinute - window.opensMinute) * roomCount
    }
  }
  return total
}

export function makeGetDashboard(deps: DashboardDeps) {
  return async function getDashboard(
    access: StaffAccess,
    selectedStoreId: number | null,
  ): Promise<Dashboard> {
    const stores: StoreFilter = storeFilter(access, 'dashboard.view', selectedStoreId)
    const active = await deps.stores.listActive()
    const targets = stores === null ? active : active.filter((s) => stores.includes(s.id))
    const timezone = targets[0]?.timezone ?? 'Asia/Tokyo'
    const now = deps.clock.now()
    const today = utcToLocal(now, timezone).date
    const { first, last } = monthRange(today)
    const dailyFrom = addDays(today, -(DAILY_DAYS - 1))

    const [month, daily, booked, rooms, sources, unassigned, dirty, todayList, alerts] =
      await Promise.all([
        deps.queries.dailySales(stores, first, last),
        deps.queries.dailySales(stores, dailyFrom, today),
        deps.queries.bookedMinutes(stores, first, last),
        deps.queries.activeRoomCounts(stores),
        deps.queries.sources(stores, first, last),
        deps.queries.unassignedCount(stores, today),
        deps.queries.dirtyRoomCount(stores),
        deps.queries.search({
          stores,
          dateFrom: today,
          dateTo: today,
          statuses: ['confirmed', 'completed', 'draft'],
          offset: 0,
          limit: 100,
        }),
        deps.alerts.list({
          stores,
          statuses: ['open', 'in_progress'],
          severity: 'critical',
          limit: 5,
        }),
      ])
    const capacity = await capacityMinutes(deps.stores, targets, rooms, first, last)

    // Show every one of the last 14 days, including days without sales.
    const byDate = new Map(daily.map((d) => [d.date, d]))
    const days: DailySales[] = []
    for (let date = dailyFrom; date <= today; date = addDays(date, 1)) {
      days.push(byDate.get(date) ?? { date, amount: 0, count: 0 })
    }
    const live = todayList.rows.filter(
      (b) => b.status !== 'draft' || (b.holdExpiresAt !== null && b.holdExpiresAt > now),
    )
    return {
      today,
      monthLabel: `${Number(today.slice(5, 7))}月`,
      monthSales: month.reduce((sum, d) => sum + d.amount, 0),
      monthBookings: month.reduce((sum, d) => sum + d.count, 0),
      utilizationPercent: capacity > 0 ? Math.round((booked / capacity) * 1000) / 10 : null,
      todayCount: live.filter((b) => b.status !== 'draft').length,
      unassignedCount: unassigned,
      roomsNeedingCleaning: dirty,
      criticalAlerts: alerts,
      daily: days,
      todayBookings: live.sort((a, b) => a.start.getTime() - b.start.getTime()),
      sources: [...sources].sort((a, b) => b.amount - a.amount || b.count - a.count),
    }
  }
}
