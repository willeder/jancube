import { describe, expect, it } from 'vitest'
import { authPaths, loginPath, safeNext } from './auth-flow'

describe('sign-in redirect target (C-22)', () => {
  it('accepts same-site paths only', () => {
    expect(safeNext('/mypage/bookings/JC-2026-000001')).toBe('/mypage/bookings/JC-2026-000001')
    expect(safeNext('/mypage/coupons?tab=used')).toBe('/mypage/coupons?tab=used')
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'mypage',
      '/my page',
      '/\nset-cookie',
      '',
      null,
      undefined,
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safeNext(bad)).toBe('/mypage')
    }
  })

  it('keeps the booking flow on its fixed screens', () => {
    expect(authPaths('booking', '/mypage/account')).toMatchObject({
      start: '/booking/auth',
      verify: '/booking/auth/verify',
      profile: '/booking/auth/profile',
      done: '/booking/payment',
    })
  })

  it('carries the target through the login screens', () => {
    expect(authPaths('login', '/mypage/coupons')).toMatchObject({
      start: '/login?next=%2Fmypage%2Fcoupons',
      verify: '/login/verify?next=%2Fmypage%2Fcoupons',
      verifyResent: '/login/verify?next=%2Fmypage%2Fcoupons&resent=1',
      done: '/mypage/coupons',
    })
    expect(authPaths('login', '//evil')).toMatchObject({ start: '/login', done: '/mypage' })
    expect(loginPath('/mypage')).toBe('/login')
  })
})
