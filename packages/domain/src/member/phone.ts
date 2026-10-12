import { DomainError } from '../shared/errors'

/** A phone number in E.164 format, e.g. +819012345678. */
export type E164 = string

/**
 * Normalises a Japanese mobile number entered by a customer (090-1234-5678, 09012345678,
 * +81 90 1234 5678, full-width digits) to E.164. Only mobile prefixes are accepted because the
 * number is used for SMS sign-in.
 */
export function normalizeJapaneseMobile(input: string): E164 {
  const ascii = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[＋]/g, '+')
  // Separators customers type: spaces, ASCII/full-width hyphens and dashes, long vowel mark, brackets.
  const digits = ascii.replace(/[\s\-‐‑–—−ー－()（）]/g, '')
  let national: string
  if (/^\+81\d+$/.test(digits)) national = `0${digits.slice(3)}`
  else if (/^0\d+$/.test(digits)) national = digits
  else throw new DomainError('invalid_phone', 'enter a Japanese mobile number')

  if (!/^0[789]0\d{8}$/.test(national)) {
    throw new DomainError('invalid_phone', 'enter a Japanese mobile number (070/080/090)')
  }
  return `+81${national.slice(1)}`
}

/** 090-1234-5678 style display. */
export function formatJapaneseMobile(e164: E164): string {
  const national = `0${e164.replace(/^\+81/, '')}`
  return `${national.slice(0, 3)}-${national.slice(3, 7)}-${national.slice(7)}`
}

/** 090-****-5678 for screens and logs. */
export function maskPhone(e164: E164): string {
  const formatted = formatJapaneseMobile(e164)
  return `${formatted.slice(0, 4)}****${formatted.slice(8)}`
}
