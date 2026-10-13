import { describe, expect, it } from 'vitest'
import { changeSettlement } from '../booking/change-policy'
import { dayBeforeNoticeAt, isEntryInfoDisclosed } from '../booking/disclosure'
import { assertCanWithdraw, normalizeOptionalEmail } from '../member/account'
import {
  normalizeRecipientName,
  receiptAvailability,
  receiptNumber,
  taxInclusiveBreakdown,
} from './receipt'

describe('receipt (C-19)', () => {
  it('splits a tax-inclusive amount, rounding the tax down', () => {
    expect(taxInclusiveBreakdown(6_100, 10)).toEqual({
      ratePercent: 10,
      taxable: 5_546,
      tax: 554,
      gross: 6_100,
    })
    expect(taxInclusiveBreakdown(1_100, 10)).toMatchObject({ taxable: 1_000, tax: 100 })
    expect(taxInclusiveBreakdown(0, 10)).toMatchObject({ taxable: 0, tax: 0 })
  })

  it('is issued after use or for a cancellation fee, never before use', () => {
    const end = new Date('2026-11-10T08:00:00Z')
    const before = new Date('2026-11-10T07:00:00Z')
    const after = new Date('2026-11-10T08:00:00Z')
    expect(receiptAvailability({ status: 'confirmed', end, now: before, netPaid: 6_100 })).toEqual({
      ok: false,
      reason: 'not_used_yet',
    })
    expect(receiptAvailability({ status: 'confirmed', end, now: after, netPaid: 6_100 }).ok).toBe(
      true,
    )
    expect(receiptAvailability({ status: 'completed', end, now: before, netPaid: 1 }).ok).toBe(true)
    expect(receiptAvailability({ status: 'canceled', end, now: before, netPaid: 3_050 }).ok).toBe(
      true,
    )
    expect(receiptAvailability({ status: 'canceled', end, now: after, netPaid: 0 })).toEqual({
      ok: false,
      reason: 'nothing_paid',
    })
    expect(receiptAvailability({ status: 'expired', end, now: after, netPaid: 100 }).ok).toBe(false)
  })

  it('numbers re-issues and validates the recipient', () => {
    expect(receiptNumber('JC-2026-000012', 2)).toBe('JC-2026-000012-R2')
    expect(normalizeRecipientName('  山田　 太郎 ')).toBe('山田 太郎')
    expect(() => normalizeRecipientName('   ')).toThrow('recipient')
    expect(() => normalizeRecipientName('あ'.repeat(101))).toThrow()
  })
})

describe('day-before disclosure (C-13)', () => {
  it('opens at 20:00 store time on the previous day', () => {
    expect(dayBeforeNoticeAt('2026-11-10', 'Asia/Tokyo').toISOString()).toBe(
      '2026-11-09T11:00:00.000Z',
    )
    expect(isEntryInfoDisclosed('2026-11-10', 'Asia/Tokyo', new Date('2026-11-09T10:59:59Z'))).toBe(
      false,
    )
    expect(isEntryInfoDisclosed('2026-11-10', 'Asia/Tokyo', new Date('2026-11-09T11:00:00Z'))).toBe(
      true,
    )
  })
})

describe('booking change settlement (C-14)', () => {
  it('refunds a cheaper change and refuses a more expensive one', () => {
    expect(changeSettlement(6_100, 6_100)).toEqual({ kind: 'none' })
    expect(changeSettlement(6_100, 4_500)).toEqual({ kind: 'refund', amount: 1_600 })
    expect(changeSettlement(6_100, 8_000)).toEqual({ kind: 'increase_not_allowed', amount: 1_900 })
  })
})

describe('member account (C-17)', () => {
  it('normalizes the optional email', () => {
    expect(normalizeOptionalEmail(' Taro@Example.COM ')).toBe('taro@example.com')
    expect(normalizeOptionalEmail('')).toBeNull()
    expect(() => normalizeOptionalEmail('not-an-email')).toThrow()
  })

  it('blocks withdrawal while upcoming bookings exist', () => {
    expect(() => assertCanWithdraw(1)).toThrow('upcoming')
    expect(() => assertCanWithdraw(0)).not.toThrow()
  })
})
