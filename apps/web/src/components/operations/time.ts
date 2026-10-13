import { utcToLocal } from '@jancube/domain'

/** Store-local "13:05" of an instant (presentation only). */
export function localTime(instant: Date | null, timeZone: string): string {
  if (!instant) return '—'
  const m = utcToLocal(instant, timeZone).minuteOfDay
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Store-local "11/10 13:05". */
export function localDateTime(instant: Date | null, timeZone: string): string {
  if (!instant) return '—'
  const { date } = utcToLocal(instant, timeZone)
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d} ${localTime(instant, timeZone)}`
}

/** "22分" / "2時間52分" until `due` (past → "5分超過"). */
export function remaining(due: Date, now: Date): string {
  const minutes = Math.round((due.getTime() - now.getTime()) / 60_000)
  if (minutes < 0) return `${-minutes}分超過`
  const h = Math.floor(minutes / 60)
  return h > 0 ? `${h}時間${minutes % 60}分` : `${minutes}分`
}

export const TASK_TYPE_LABEL = { opening: '開店前', spot: 'スポット' } as const

export const TASK_STATUS_LABEL = {
  pending: '未着手',
  in_progress: '清掃中',
  done: '完了',
  canceled: '取消',
} as const

export const KEY_STATUS_LABEL: Record<string, string> = {
  pending: '発行待ち',
  issued: '発行済',
  active: '有効',
  revoke_pending: '失効待ち',
  revoked: '失効',
  expired: '期限切れ',
  failed: '発行失敗',
}

export const KEY_EVENT_LABEL: Record<string, string> = {
  issue: '発行',
  revoke: '失効',
  manual_reissue: '手動再発行',
  manual_unlock: '手動解錠(記録)',
  status_check: '疎通テスト',
}

export const KEY_RESULT_LABEL: Record<string, string> = {
  requested: '要求',
  success: '成功',
  failure: '失敗',
  unknown: '不明',
}
