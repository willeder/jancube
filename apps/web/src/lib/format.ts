/** Presentation helpers (no business rules). */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

export function yen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`
}

/** Minutes from local midnight → "13:00". After midnight stays above 24 (e.g. "25:30"). */
export function hhmm(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60)
  const m = minuteOfDay % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}分`
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}

/** "YYYY-MM-DD" → "11月10日(火)". */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}月${d}日(${weekday})`
}

export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export { WEEKDAYS }

/** "YYYY-MM-DD" → "2026/7/8(水)" (C-12 lists). */
export function slashDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${y}/${m}/${d}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}

/** "YYYY-MM-DD" → "2026年7月8日(水)" (C-13 details). */
export function fullDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${y}年${m}月${d}日(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}

/** An instant in a store's time zone → "2026年7月8日 13:05". */
export function localDateTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant)
}

/** An instant in a store's time zone → "2026年7月8日". */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(instant)
}
