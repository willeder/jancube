import type { LocalDate } from '@jancube/domain'

/**
 * DATE columns arrive as Date at UTC midnight (connection timezone 'Z') or as 'YYYY-MM-DD' strings,
 * depending on driver settings. Both map to the same local calendar date.
 */
export function toLocalDate(value: Date | string): LocalDate {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

/** DECIMAL columns arrive as strings. */
export function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
