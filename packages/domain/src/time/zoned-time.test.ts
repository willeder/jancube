import { describe, expect, it } from 'vitest'
import { openingWindow } from '../store/business-hours'
import { addDays, localToUtc, utcToLocal, weekdayOf } from './zoned-time'

describe('zoned time', () => {
  it('converts local store time to UTC (Asia/Tokyo is UTC+9)', () => {
    expect(localToUtc('2026-11-10', 600, 'Asia/Tokyo').toISOString()).toBe(
      '2026-11-10T01:00:00.000Z',
    )
    expect(localToUtc('2026-11-10', 1440, 'Asia/Tokyo').toISOString()).toBe(
      '2026-11-10T15:00:00.000Z',
    )
  })

  it('converts UTC back to local date and minute', () => {
    expect(utcToLocal(new Date('2026-11-10T15:30:00Z'), 'Asia/Tokyo')).toEqual({
      date: '2026-11-11',
      minuteOfDay: 30,
    })
  })

  it('handles weekdays and date arithmetic', () => {
    expect(weekdayOf('2026-11-10')).toBe(2) // Tuesday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('openingWindow', () => {
  const weekly = [{ weekday: 2, opensMinute: 600, closesMinute: 1440, isClosed: false }]

  it('uses the weekday hours', () => {
    const w = openingWindow('2026-11-10', 'Asia/Tokyo', weekly)
    expect(w?.opensAt.toISOString()).toBe('2026-11-10T01:00:00.000Z')
  })

  it('is closed on days without hours or with a closed override', () => {
    expect(openingWindow('2026-11-11', 'Asia/Tokyo', weekly)).toBeNull()
    expect(
      openingWindow('2026-11-10', 'Asia/Tokyo', weekly, {
        date: '2026-11-10',
        isClosed: true,
        opensMinute: null,
        closesMinute: null,
      }),
    ).toBeNull()
  })

  it('applies special hours from an override', () => {
    const w = openingWindow('2026-11-10', 'Asia/Tokyo', weekly, {
      date: '2026-11-10',
      isClosed: false,
      opensMinute: 720,
      closesMinute: 1320,
    })
    expect(w?.opensMinute).toBe(720)
    expect(w?.closesMinute).toBe(1320)
  })
})
