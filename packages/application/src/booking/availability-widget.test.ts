import { describe, expect, it } from 'vitest'
import { makeGetAvailabilityWidget } from './availability-widget'
import { fakeBookingDeps, jst } from './test-fixtures'

describe('availability widget (C-23)', () => {
  it('summarises three days per room type in two-hour blocks', async () => {
    const deps = fakeBookingDeps({
      now: '2026-11-10T03:00:00Z', // 12:00 JST
      overrides: [{ date: '2026-11-11', isClosed: true, opensMinute: null, closesMinute: null }],
      bookings: [
        // Both 4麻 rooms taken 18:00-20:00 today; one of them 14:00-16:00.
        ...[1, 2].map((roomId) => ({
          groupId: 10,
          roomId,
          range: { start: jst('2026-11-10', '18:00'), end: jst('2026-11-10', '20:00') },
        })),
        {
          groupId: 10,
          roomId: 1,
          range: { start: jst('2026-11-10', '14:00'), end: jst('2026-11-10', '16:00') },
        },
      ],
      store: { openDate: '2026-10-01' },
    })
    const widget = await makeGetAvailabilityWidget(deps)('JC001', 3)
    expect(widget.dates).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
    expect(widget.blocks).toEqual([600, 720, 840, 960, 1080, 1200, 1320])
    expect(widget.roomTypes.map((t) => t.code)).toEqual(['4MA', 'VIP'])

    const today = widget.roomTypes[0]?.rows[0]?.cells
    // 10-12 past, 12-14 partly within the lead time, 14-16 one room left, 18-20 full.
    expect(today?.[0]).toBe('past')
    expect(today?.[2]).toBe('available')
    expect(today?.[4]).toBe('full')
    expect(widget.roomTypes[0]?.rows[1]?.cells.every((c) => c === 'closed')).toBe(true)
    expect(widget.roomTypes[1]?.rows[2]?.cells.every((c) => c === 'available')).toBe(true)
  })

  it('rejects an unknown store', async () => {
    const deps = fakeBookingDeps({ now: '2026-11-10T03:00:00Z' })
    await expect(makeGetAvailabilityWidget(deps)('NOPE')).rejects.toMatchObject({
      code: 'store_not_found',
    })
  })
})
