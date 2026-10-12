import { describe, expect, it } from 'vitest'
import { normalizeCouponCode } from '../coupon/coupon-master'
import { includedTax } from '../pricing/price-version'
import { assertRoleGrants, normalizeStaffEmail } from '../staff/role-grants'
import { assertCalendarOverride, formatClock, parseClock } from './store-settings'

describe('admin master rules', () => {
  it('parses clock times including after-midnight closing', () => {
    expect(parseClock('10:00')).toBe(600)
    expect(parseClock('26:30')).toBe(1590)
    expect(formatClock(1590)).toBe('26:30')
    expect(() => parseClock('10:5')).toThrow()
  })

  it('needs both special opening and closing on a calendar day', () => {
    expect(() =>
      assertCalendarOverride({
        date: '2026-12-31',
        isClosed: false,
        opensMinute: 600,
        closesMinute: null,
      }),
    ).toThrow()
    expect(() =>
      assertCalendarOverride({
        date: '2026-12-31',
        isClosed: false,
        opensMinute: 600,
        closesMinute: 1500,
      }),
    ).not.toThrow()
  })

  it('checks role grants per store', () => {
    expect(() => assertRoleGrants([])).toThrow()
    expect(() => assertRoleGrants([{ role: 'cleaning', storeId: null }])).toThrow()
    expect(() =>
      assertRoleGrants([
        { role: 'store_staff', storeId: 1 },
        { role: 'store_staff', storeId: 1 },
      ]),
    ).toThrow()
    expect(() => assertRoleGrants([{ role: 'admin', storeId: null }])).not.toThrow()
  })

  it('normalizes codes and emails', () => {
    expect(normalizeCouponCode(' spring-2026 ')).toBe('SPRING-2026')
    expect(() => normalizeCouponCode('ク')).toThrow()
    expect(normalizeStaffEmail(' Tamaki@Actpro.co.jp ')).toBe('tamaki@actpro.co.jp')
    expect(() => normalizeStaffEmail('nope')).toThrow()
  })

  it('computes tax contained in a tax-inclusive price', () => {
    expect(includedTax(6600, 10)).toBe(600)
    expect(includedTax(1000, 0)).toBe(0)
  })
})
