import { utcToLocal } from '@jancube/domain'

/** Excel opens UTF-8 CSV correctly only with a byte order mark. */
export const CSV_BOM = '﻿'

/** Reports are in Japan time (all stores are in Asia/Tokyo; JST has no daylight saving). */
export const REPORT_TIME_ZONE = 'Asia/Tokyo'

export type CsvValue = string | number | boolean | null | undefined

/**
 * One RFC 4180 cell. Text starting with = + - @ (or a tab/CR) is prefixed with ' so spreadsheet apps
 * do not run it as a formula (CSV injection); numbers are written as they are.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? '1' : '0'
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvLine(values: readonly CsvValue[]): string {
  return `${values.map(csvCell).join(',')}\r\n`
}

/** "2026-11-01 13:05:09" in Japan time; empty for null. */
export function formatReportTime(instant: Date | null): string {
  if (!instant) return ''
  const { date, minuteOfDay } = utcToLocal(instant, REPORT_TIME_ZONE)
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const mm = String(minuteOfDay % 60).padStart(2, '0')
  const ss = String(instant.getUTCSeconds()).padStart(2, '0')
  return `${date} ${hh}:${mm}:${ss}`
}

/** Percentage with one decimal, or null when the denominator is zero. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null
}
