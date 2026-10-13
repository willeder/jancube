import { formatJapaneseMobile, minuteOfBusinessDay, utcToLocal } from '@jancube/domain'
import { dateLabel, hhmm } from '@/lib/format'
import { Badge } from './ui'

/** Labels shared by the admin booking screens (A-02〜A-08, A-22, A-25, A-26). */

export const DEFAULT_TIMEZONE = 'Asia/Tokyo'

type Tone = 'green' | 'gold' | 'red' | 'gray'

export const BOOKING_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: '仮押さえ', tone: 'gold' },
  confirmed: { label: '確定', tone: 'green' },
  completed: { label: '利用済', tone: 'gray' },
  canceled: { label: 'キャンセル', tone: 'red' },
  expired: { label: '期限切れ', tone: 'gray' },
}

export const BOOKING_SOURCE: Record<string, string> = {
  web: '自社サイト',
  liff: 'LINE(LIFF)',
  line: 'LINE',
  proxy: '代理予約(電話)',
}

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: '未決済', tone: 'gold' },
  processing: { label: '処理中', tone: 'gold' },
  succeeded: { label: '成功', tone: 'green' },
  failed: { label: '失敗', tone: 'red' },
  canceled: { label: '取消', tone: 'gray' },
  requested: { label: '依頼中', tone: 'gold' },
}

export const PAYMENT_METHOD: Record<string, string> = {
  card: 'カード',
  paypay: 'PayPay',
  other: 'その他',
}

export const NOTIFICATION_EVENT: Record<string, string> = {
  booking_confirmed: '予約完了',
  room_assigned: '部屋・入室コード',
  booking_changed: '予約変更',
  booking_canceled: 'キャンセル',
  refund_completed: '返金完了',
  coupon_granted: 'クーポン付与',
  payment_link: '決済リンク',
  usage_reminder: '利用リマインド',
}

export const CHANNEL: Record<string, string> = { line: 'LINE', email: 'メール', sms: 'SMS' }

export function StatusBadge({ status }: { status: string }) {
  const s = BOOKING_STATUS[status] ?? { label: status, tone: 'gray' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function PaymentBadge({ status }: { status: string }) {
  const s = PAYMENT_STATUS[status] ?? { label: status, tone: 'gray' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** "7/6 10:14" in the store's timezone. */
export function shortDateTime(at: Date | null, timezone = DEFAULT_TIMEZONE): string {
  if (!at) return '—'
  const l = utcToLocal(at, timezone)
  return `${Number(l.date.slice(5, 7))}/${Number(l.date.slice(8))} ${hhmm(l.minuteOfDay)}`
}

/** "7月8日(水) 13:00-16:00" (times after midnight shown as 25:00 etc.). */
export function bookingWhen(b: {
  businessDate: string
  start: Date
  end: Date
  timezone: string
}): string {
  return `${dateLabel(b.businessDate)} ${bookingTimes(b)}`
}

export function bookingTimes(b: {
  businessDate: string
  start: Date
  end: Date
  timezone: string
}): string {
  const s = minuteOfBusinessDay(b.businessDate, b.start, b.timezone)
  const e = minuteOfBusinessDay(b.businessDate, b.end, b.timezone)
  return `${hhmm(s)}-${hhmm(e)}`
}

export function phoneLabel(e164: string | null): string {
  if (!e164) return '—'
  try {
    return formatJapaneseMobile(e164)
  } catch {
    return e164
  }
}

/** Compact JSON for audit/change values. */
export function jsonLabel(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const text = JSON.stringify(value)
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}
