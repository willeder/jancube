import 'server-only'
import { DomainError } from '@jancube/domain'

/** Customer-facing Japanese messages for business-rule errors raised by use cases. */
const messages: Record<string, string> = {
  store_not_found: '店舗が見つかりません',
  store_closed: 'この日は休業日です',
  date_not_bookable: 'この日はご予約いただけません',
  room_not_found: 'お部屋が見つかりません',
  price_not_set: 'このお部屋の料金が設定されていません',
  unavailable: 'ご希望の時間は空きがありません。別の時間をお選びください',
  below_minimum: 'ご利用時間が最低利用時間に満たないため、ご予約できません',
  too_late: 'この時間はご予約受付を終了しました',
  outside_opening_hours: '営業時間外のためご予約できません',
  not_slot_aligned: '開始・終了は30分単位でお選びください',
  invalid_time: '時間の指定が正しくありません',
  invalid_date: '日付の指定が正しくありません',
  hold_not_found: 'ご予約手続き中の情報が見つかりません。最初からやり直してください',
  hold_expired:
    '仮押さえの期限が切れました。お手数ですが、もう一度お日にちと時間の選択からお願いします',
  hold_not_active: 'このご予約の手続きは終了しています',
  invalid_guest_count: 'ご利用人数を正しく選択してください',
}

export function toUserMessage(error: unknown): string {
  if (error instanceof DomainError) return messages[error.code] ?? 'ご予約を進められませんでした'
  console.error(error)
  return 'エラーが発生しました。時間をおいて再度お試しください'
}

export function isDomainError(error: unknown, ...codes: string[]): error is DomainError {
  return error instanceof DomainError && (codes.length === 0 || codes.includes(error.code))
}
