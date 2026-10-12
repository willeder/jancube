import { DomainError } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { makeGetBookingCalendar } from './get-booking-calendar'
import { makeGetDayAvailability } from './get-day-availability'
import { makeGetEndOptions } from './get-end-options'
import { fakeBookingDeps, jst } from './test-fixtures'

const D = '2026-11-10'

describe('getBookingCalendar (C-02)', () => {
  it('lists today through the booking horizon, before cutover as not bookable', async () => {
    const deps = fakeBookingDeps({ now: '2026-10-15T12:00:00+09:00' })
    const cal = await makeGetBookingCalendar(deps)('JC001')
    expect(cal.today).toBe('2026-10-15')
    expect(cal.firstBookable).toBe('2026-10-19')
    expect(cal.lastBookable).toBe('2026-12-14')
    expect(cal.days[0]).toEqual({ date: '2026-10-15', status: 'not_bookable' })
    expect(cal.days.find((d) => d.date === '2026-10-19')?.status).toBe('available')
    expect(deps.inventoryLoads).toBe(1) // one inventory query for the whole range
  })

  it('shows closed days and full days', async () => {
    const deps = fakeBookingDeps({
      now: '2026-11-01T12:00:00+09:00',
      overrides: [{ date: D, isClosed: true, opensMinute: null, closesMinute: null }],
      bookings: [1, 2, 12].map((roomId) => ({
        groupId: roomId === 12 ? 20 : 10,
        roomId,
        range: { start: jst('2026-11-11', '10:00'), end: jst('2026-11-11', '24:00') },
      })),
    })
    const cal = await makeGetBookingCalendar(deps)('JC001')
    expect(cal.days.find((d) => d.date === D)?.status).toBe('closed')
    expect(cal.days.find((d) => d.date === '2026-11-11')?.status).toBe('full')
  })
})

describe('getDayAvailability (C-03)', () => {
  it('returns a lane per room type and per named room, with prices', async () => {
    const deps = fakeBookingDeps({ now: '2026-11-01T12:00:00+09:00' })
    const day = await makeGetDayAvailability(deps)('JC001', D)
    expect(day.lanes.map((l) => [l.key, l.roomCount, l.hourlyRate])).toEqual([
      ['g:4MA', 2, 1_500],
      ['r:Room12', 1, 2_500],
    ])
    expect(day.lanes[0]?.slots).toHaveLength(28)
    expect(day.lanes[0]?.slots[0]?.minuteOfDay).toBe(600)
  })

  it('a group lane stays open until every room is taken', async () => {
    const busy = { start: jst(D, '13:00'), end: jst(D, '16:00') }
    const one = fakeBookingDeps({
      now: '2026-11-01T12:00:00+09:00',
      bookings: [{ groupId: 10, roomId: null, range: busy }],
    })
    const two = fakeBookingDeps({
      now: '2026-11-01T12:00:00+09:00',
      bookings: [
        { groupId: 10, roomId: null, range: busy },
        { groupId: 10, roomId: null, range: busy },
      ],
    })
    const at14 = (lanes: Awaited<ReturnType<ReturnType<typeof makeGetDayAvailability>>>['lanes']) =>
      lanes[0]?.slots.find((s) => s.minuteOfDay === 14 * 60)?.available
    expect(at14((await makeGetDayAvailability(one)('JC001', D)).lanes)).toBe(true)
    expect(at14((await makeGetDayAvailability(two)('JC001', D)).lanes)).toBe(false)
  })

  it('rejects dates outside the bookable range', async () => {
    const deps = fakeBookingDeps({ now: '2026-11-01T12:00:00+09:00' })
    await expect(makeGetDayAvailability(deps)('JC001', '2027-03-01')).rejects.toBeInstanceOf(
      DomainError,
    )
  })
})

describe('getEndOptions (C-03)', () => {
  it('lists end times from the minimum length with a price for each', async () => {
    const deps = fakeBookingDeps({ now: '2026-11-01T12:00:00+09:00' })
    const ends = await makeGetEndOptions(deps)({
      storeCode: 'JC001',
      date: D,
      laneKey: 'g:4MA',
      start: jst(D, '13:00').toISOString(),
    })
    expect(ends[0]).toMatchObject({ endMinuteOfDay: 14 * 60, durationMinutes: 60 })
    expect(ends[0]?.quote.price).toBe(1_500)
    const fourHours = ends.find((e) => e.durationMinutes === 240)
    expect(fourHours?.quote).toMatchObject({ price: 5_800, discountAmount: 200 })
    expect(ends.at(-1)?.endMinuteOfDay).toBe(1440)
  })
})
