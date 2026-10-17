import type { StaffAccess } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { fakeBookingDeps, jst } from '../booking/test-fixtures'
import type { AdminBookingQueries, AlertWorkRepository, StoreFilter } from '../ports/admin-bookings'
import { makeGetDashboard, monthRange } from './dashboard'

const storeStaff: StaffAccess = { staffId: 7, grants: [{ role: 'admin', storeId: 1 }] }

describe('monthRange', () => {
  it('covers the calendar month of a date', () => {
    expect(monthRange('2026-11-10')).toEqual({ first: '2026-11-01', last: '2026-11-30' })
    expect(monthRange('2028-02-03')).toEqual({ first: '2028-02-01', last: '2028-02-29' })
  })
})

describe('getDashboard (A-02)', () => {
  it('computes month sales, utilization and the last 14 days for the staff member’s store', async () => {
    const base = fakeBookingDeps({ now: '2026-11-10T12:00:00+09:00' })
    const scopes: StoreFilter[] = []
    const queries = {
      dailySales: async (stores: StoreFilter, from: string) => {
        scopes.push(stores)
        return from === '2026-11-01'
          ? [
              { date: '2026-11-02', amount: 10_000, count: 2 },
              { date: '2026-11-20', amount: 5_000, count: 1 },
            ]
          : [{ date: '2026-11-09', amount: 8_000, count: 1 }]
      },
      // 2 rooms × 14 h × 30 days = 50,400 room-minutes; 5,040 booked = 10%.
      bookedMinutes: async () => 5_040,
      activeRoomCounts: async () => [{ storeId: 1, rooms: 2 }],
      sources: async () => [
        { source: 'web', count: 1, amount: 1_000 },
        { source: 'proxy', count: 2, amount: 9_000 },
      ],
      unassignedCount: async () => 3,
      dirtyRoomCount: async () => 1,
      search: async () => ({
        rows: [
          { bookingCode: 'B', status: 'confirmed', start: jst('2026-11-10', '18:00') },
          { bookingCode: 'A', status: 'confirmed', start: jst('2026-11-10', '13:00') },
          {
            bookingCode: 'H',
            status: 'draft',
            start: jst('2026-11-10', '15:00'),
            holdExpiresAt: jst('2026-11-10', '11:00'),
          },
        ],
        total: 3,
      }),
    } as unknown as AdminBookingQueries
    const alerts = { list: async () => [] } as unknown as AlertWorkRepository
    const dashboard = await makeGetDashboard({
      queries,
      alerts,
      stores: base.stores,
      clock: base.clock,
    })(storeStaff, null)

    expect(scopes.every((s) => JSON.stringify(s) === '[1]')).toBe(true)
    expect(dashboard).toMatchObject({
      today: '2026-11-10',
      monthSales: 15_000,
      monthBookings: 3,
      utilizationPercent: 10,
      todayCount: 2,
      unassignedCount: 3,
      roomsNeedingCleaning: 1,
    })
    expect(dashboard.daily).toHaveLength(14)
    expect(dashboard.daily.at(-2)).toEqual({ date: '2026-11-09', amount: 8_000, count: 1 })
    expect(dashboard.daily.at(-1)).toEqual({ date: '2026-11-10', amount: 0, count: 0 })
    expect(dashboard.todayBookings.map((b) => b.bookingCode)).toEqual(['A', 'B'])
    expect(dashboard.sources[0]?.source).toBe('proxy')
  })
})
