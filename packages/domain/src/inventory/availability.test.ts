import { describe, expect, it } from 'vitest'
import { DomainError } from '../shared/errors'
import { openingWindow, type WeeklyHours } from '../store/business-hours'
import { createTimeRange } from '../time/time-range'
import type { AllocationInput } from './allocation'
import { assertBookable, endOptions, slotStates } from './availability'

const tz = 'Asia/Tokyo'
const weekly: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensMinute: 600,
  closesMinute: 1440,
  isClosed: false,
}))
const window = openingWindow('2026-11-10', tz, weekly)
if (!window) throw new Error('fixture: store should be open')
const t = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00+09:00`)
const rules = { minimumMinutes: 60, leadMinutes: 30 }
const now = new Date('2026-11-09T12:00:00+09:00')

// One room, busy 13:00–15:00 (+15 min buffer → free again at 15:15, i.e. from 15:30 on the grid).
const load: AllocationInput = {
  rooms: [{ roomId: 1, bookings: [createTimeRange(t('13:00'), t('15:00'))], blocks: [] }],
  flexible: [],
  bufferMinutes: 15,
}

describe('slotStates', () => {
  it('allows immediate 13:08 use billed from 13:00 while enforcing capacity and earlier-slot rejection', () => {
    const immediate = { minimumMinutes: 60, leadMinutes: 0, allowImmediate: true }
    const empty = { ...load, rooms: [{ roomId: 1, bookings: [], blocks: [] }], bufferMinutes: 30 }
    const at = t('13:08')
    expect(() =>
      assertBookable(window, empty, createTimeRange(t('13:00'), t('14:00')), at, immediate),
    ).not.toThrow()
    expect(() =>
      assertBookable(window, empty, createTimeRange(t('12:30'), t('14:00')), at, immediate),
    ).toThrow()
    expect(() =>
      assertBookable(window, load, createTimeRange(t('13:00'), t('14:00')), at, immediate),
    ).toThrow()
  })
  it('covers the opening window in 30-minute cells', () => {
    const cells = slotStates(window, load, now, rules)
    expect(cells).toHaveLength(28) // 10:00–24:00
    expect(cells[0]?.start).toEqual(t('10:00'))
  })

  it('marks cells taken by a booking or its cleaning buffer as unavailable', () => {
    const byTime = new Map(
      slotStates(window, load, now, rules).map((c) => [c.start.getTime(), c.available]),
    )
    expect(byTime.get(t('12:30').getTime())).toBe(false) // would end 13:00, buffer runs into the booking
    expect(byTime.get(t('13:00').getTime())).toBe(false)
    expect(byTime.get(t('15:00').getTime())).toBe(false) // still within 15 min cleaning
    expect(byTime.get(t('15:30').getTime())).toBe(true)
  })

  it('marks cells before now + lead time as unavailable', () => {
    const sameDay = new Date('2026-11-10T11:10:00+09:00')
    const byTime = new Map(
      slotStates(window, { ...load, rooms: [] }, sameDay, rules).map((c) => [
        c.start.getTime(),
        c.available,
      ]),
    )
    expect(byTime.get(t('11:30').getTime())).toBe(false)
  })
})

describe('endOptions', () => {
  it('lists ends from the minimum length until the next booking (with buffer)', () => {
    const ends = endOptions(window, load, t('10:00'), now, rules)
    expect(ends.map((e) => e.toISOString())).toEqual(
      [t('11:00'), t('11:30'), t('12:00'), t('12:30')].map((e) => e.toISOString()),
    )
  })

  it('runs to closing time when nothing is in the way', () => {
    const ends = endOptions(window, load, t('22:00'), now, rules)
    expect(ends.at(-1)).toEqual(t('24:00'))
  })
})

describe('assertBookable', () => {
  it('accepts a valid booking', () => {
    expect(() =>
      assertBookable(window, load, createTimeRange(t('16:00'), t('19:00')), now, rules),
    ).not.toThrow()
  })

  it.each([
    ['unavailable', t('12:00'), t('14:00')],
    ['below_minimum', t('16:00'), t('16:30')],
    ['outside_opening_hours', t('09:00'), t('11:00')],
    ['not_slot_aligned', t('16:15'), t('18:15')],
  ])('rejects %s', (code, start, end) => {
    try {
      assertBookable(window, load, createTimeRange(start, end), now, rules)
      throw new Error('expected a DomainError')
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError)
      expect((e as DomainError).code).toBe(code)
    }
  })
})
