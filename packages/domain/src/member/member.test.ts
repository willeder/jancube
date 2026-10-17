import { describe, expect, it } from 'vitest'
import { DomainError } from '../shared/errors'
import { OTP_POLICY, signInCodeMessage } from './otp-policy'
import { formatJapaneseMobile, maskPhone, normalizeJapaneseMobile } from './phone'
import { validateMemberProfile } from './profile'

describe('normalizeJapaneseMobile', () => {
  it.each([
    ['090-1234-5678', '+819012345678'],
    ['08012345678', '+818012345678'],
    ['+81 70 1234 5678', '+817012345678'],
    ['０９０－１２３４－５６７８', '+819012345678'],
  ])('%s → %s', (input, e164) => {
    expect(normalizeJapaneseMobile(input)).toBe(e164)
  })

  it.each(['03-1234-5678', '090-1234-567', '1234', '+1 415 555 0100'])('rejects %s', (input) => {
    expect(() => normalizeJapaneseMobile(input)).toThrow(DomainError)
  })

  it('formats and masks for display', () => {
    expect(formatJapaneseMobile('+819012345678')).toBe('090-1234-5678')
    expect(maskPhone('+819012345678')).toBe('090-****-5678')
  })
})

describe('sign-in code message', () => {
  it('fits in one Japanese SMS (70 characters)', () => {
    expect(signInCodeMessage('123456').length).toBeLessThanOrEqual(70)
    expect(OTP_POLICY.digits).toBe(6)
  })
})

describe('validateMemberProfile', () => {
  const ok = {
    familyName: ' 山田 ',
    givenName: '太郎',
    email: ' Taro@Example.com ',
    agreesToTerms: true,
    confirmsAdult: true,
  }

  it('trims names and lower-cases email', () => {
    expect(validateMemberProfile(ok)).toEqual({
      familyName: '山田',
      givenName: '太郎',
      email: 'taro@example.com',
    })
  })

  it('requires email under the confirmed notification policy', () => {
    expect(() => validateMemberProfile({ ...ok, email: '  ' })).toThrow(
      expect.objectContaining({ code: 'email_required' }),
    )
  })

  it.each([
    ['name_required', { givenName: '' }],
    ['invalid_email', { email: 'not-an-email' }],
    ['terms_required', { agreesToTerms: false }],
    ['adult_required', { confirmsAdult: false }],
  ])('rejects %s', (code, change) => {
    expect(() => validateMemberProfile({ ...ok, ...change })).toThrow(
      expect.objectContaining({ code }),
    )
  })
})
