/** Display helpers for admin screens (times shown in Japan time). */

const TZ = 'Asia/Tokyo'

export const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`

const parts = (d: Date) => {
  const f = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? ''
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') }
}

/** 2026-10-12 */
export function ymd(d: Date | null | undefined): string {
  if (!d) return '—'
  const p = parts(d)
  return `${p.y}-${p.m}-${p.d}`
}

/** 2026-10-12 13:05 */
export function ymdhm(d: Date | null | undefined): string {
  if (!d) return '—'
  const p = parts(d)
  return `${p.y}-${p.m}-${p.d} ${p.h}:${p.min}`
}

/** Last valid day of an exclusive end instant, as YYYY-MM-DD (for "until" date inputs). */
export function lastDay(exclusiveEnd: Date): string {
  return ymd(new Date(exclusiveEnd.getTime() - 1))
}

/** Minutes from midnight → HH:MM (26:00 after midnight). */
export function hhmm(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return ''
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 曜日 bit mask → "月火水木金" / "毎日". */
export function weekdayLabel(mask: number): string {
  if (mask === 127) return '毎日'
  return WEEKDAYS.filter((_, i) => mask & (1 << i)).join('')
}

/** 240 → "4時間", 270 → "4時間30分". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h ? `${h}時間` : ''}${m ? `${m}分` : ''}` || '0分'
}

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  active: '有効',
  caution: '要注意',
  suspended: '利用停止',
  withdrawn: '退会',
}

export const memberStatusTone = (s: string): 'green' | 'gold' | 'red' | 'gray' =>
  s === 'active' ? 'green' : s === 'caution' ? 'gold' : s === 'suspended' ? 'red' : 'gray'

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  draft: '仮押さえ',
  confirmed: '確定',
  completed: '利用済',
  canceled: 'キャンセル',
  expired: '期限切れ',
}

export const COUPON_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  active: '有効',
  disabled: '停止',
}

export const STORE_STATUS_LABELS: Record<string, string> = {
  preparing: '開業準備',
  open: '営業中',
  closed: '閉店',
}

export const ROOM_STATUS_LABELS: Record<string, string> = {
  active: '稼働',
  paused: '休止',
  broken: '故障',
}

export const STAFF_STATUS_LABELS: Record<string, string> = {
  invited: '招待中',
  active: '有効',
  disabled: '無効',
}

export const CHANNEL_LABELS: Record<string, string> = { line: 'LINE', email: 'メール', sms: 'SMS' }

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  queued: '待機',
  running: '実行中',
  completed: '完了',
  failed: '失敗（再実行可）',
}
