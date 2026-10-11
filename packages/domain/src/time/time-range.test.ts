import { describe, expect, it } from 'vitest'
import { DomainError } from '../shared/errors'
import { assertSlotAligned, createTimeRange, durationMinutes, overlaps } from './time-range'

const at = (iso: string) => new Date(iso)

describe('time ranges', () => {
  it('measures duration in minutes', () => {
    expect(
      durationMinutes(createTimeRange(at('2026-11-10T04:00:00Z'), at('2026-11-10T07:30:00Z'))),
    ).toBe(210)
  })

  it('treats ranges as half-open: back-to-back bookings do not overlap', () => {
    const a = createTimeRange(at('2026-11-10T04:00:00Z'), at('2026-11-10T07:00:00Z'))
    const b = createTimeRange(at('2026-11-10T07:00:00Z'), at('2026-11-10T09:00:00Z'))
    const c = createTimeRange(at('2026-11-10T06:30:00Z'), at('2026-11-10T08:00:00Z'))
    expect(overlaps(a, b)).toBe(false)
    expect(overlaps(a, c)).toBe(true)
  })

  it('requires 30-minute alignment', () => {
    expect(() =>
      assertSlotAligned(createTimeRange(at('2026-11-10T04:15:00Z'), at('2026-11-10T05:15:00Z'))),
    ).toThrow(DomainError)
  })

  it('rejects an end before the start', () => {
    expect(() => createTimeRange(at('2026-11-10T05:00:00Z'), at('2026-11-10T04:00:00Z'))).toThrow(
      DomainError,
    )
  })
})
