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
  invalid_phone: '携帯電話番号（070・080・090）を正しく入力してください',
  resend_too_soon: '認証コードは60秒ほど待ってから再送してください',
  too_many_codes: '認証コードの送信回数が上限に達しました。1時間ほどおいて再度お試しください',
  challenge_not_found: '認証の有効期限が切れました。電話番号の入力からやり直してください',
  invalid_code: '認証コードが正しくありません',
  code_expired: '認証コードの有効期限が切れました。コードを再送してください',
  code_locked: '認証コードを続けて間違えたため、このコードは使えません。コードを再送してください',
  verification_required: '電話番号の認証からやり直してください',
  member_cannot_book: 'このアカウントではご予約いただけません。店舗までお問い合わせください',
  member_not_found: '会員情報が見つかりません。もう一度ログインしてください',
  name_required: '姓と名を入力してください',
  name_too_long: 'お名前が長すぎます',
  invalid_email: 'メールアドレスを正しく入力してください',
  terms_required: '利用規約・プライバシーポリシーへの同意が必要です',
  adult_required: '18歳以上の方のみご利用いただけます',
  coupon_not_found: 'このクーポンコードはご利用いただけません',
  coupon_not_applicable: 'このクーポンはこのご予約には使えません',
  payment_not_found: 'お支払い情報が見つかりません。最初からやり直してください',
  invalid_credentials: 'メールアドレスまたはパスワードが正しくありません',
  weak_password: 'パスワードは英字と数字を含む12文字以上で設定してください',
  token_invalid: 'リンクが無効か期限切れです。もう一度お手続きください',
  staff_not_invitable: 'このスタッフには招待メールを送信できません',
  forbidden: 'この操作を行う権限がありません',
  booking_not_found: 'ご予約が見つかりません',
  booking_not_cancellable: 'このご予約はキャンセルできません',
  invalid_fee_rate: 'キャンセル料率は0〜100%で入力してください',
  reason_required: '理由を入力してください',
  template_variable_missing: 'テンプレートの差し込み項目が不足しています',
  template_variable_unknown: 'テンプレートに使用できない差し込み項目があります',
  notification_not_found: '通知が見つかりません',
  payment_link_invalid: 'このお支払いリンクは無効です。お手数ですが店舗へご連絡ください',
  payment_link_expired:
    'このお支払いリンクは有効期限が切れました。お手数ですが店舗へご連絡ください',
  invalid_block_period: 'ブロック期間は31日以内で指定してください',
  reason_too_long: '理由は500文字以内で入力してください',
  block_not_found: '枠ブロックが見つかりません',
  alert_not_found: 'アラートが見つかりません',
  alert_resolved: 'このアラートは解決済みです',
  refund_not_found: '返金が見つかりません',
  refund_not_retryable: 'この返金は再実行できません',
  invalid_time_range: '終了は開始より後にしてください',
  legal_documents_missing: 'ただいま会員登録を受け付けられません。時間をおいて再度お試しください',
  // C-12〜C-22 マイページ・ログイン
  booking_not_changeable: 'このご予約は変更できません。最新の内容をご確認ください',
  change_not_allowed:
    'ご利用開始24時間前以降（キャンセル料が発生する期間）は、日程変更もできません',
  change_price_increase:
    '変更後の料金が現在のご予約より高くなるため、この画面では変更できません。無料キャンセル期間中にキャンセルのうえ新しくご予約いただくか、店舗までお問い合わせください',
  change_coupon_not_applicable:
    'ご利用中のクーポンの条件に合わないため、この日時・お部屋には変更できません',
  change_same_as_current: '現在のご予約と同じ内容です。別の日時またはお部屋をお選びください',
  guest_count_exceeds_capacity:
    'ご利用人数がお部屋の定員を超えるため、このお部屋には変更できません',
  withdrawal_blocked:
    'ご利用前のご予約があるため退会できません。ご予約のご利用またはキャンセル後にお手続きください',
  receipt_not_available: 'このご予約の領収書はまだ発行できません',
  recipient_required: '宛名を入力してください',
  recipient_too_long: '宛名は100文字以内で入力してください',
  legal_document_not_found: 'この文書は現在公開されていません',
  maintenance: 'ただいまメンテナンス中です。しばらくしてから再度お試しください',
  // Rooms, cleaning and keys (A-07 / A-09 / A-10 / A-20 / K-01〜K-03)
  booking_not_assignable: 'このご予約は部屋割当を変更できません',
  room_unchanged: '現在と同じ部屋です',
  room_unavailable: 'この部屋には変更できません。空き状況を確認してください',
  key_revoke_failed: '現在の入室コードを失効できませんでした。時間をおいて再度お試しください',
  key_issue_failed: '入室コードを発行できませんでした。鍵デバイスの状態を確認してください',
  key_not_issued: '入室コードが発行されていません',
  room_not_assigned: '部屋が割り当てられていません',
  lock_device_missing: 'この店舗に有効な鍵デバイスが登録されていません',
  lock_device_not_found: '鍵デバイスが見つかりません',
  lock_device_invalid: 'デバイス名・事業者アカウント・外部IDを半角英数字で入力してください',
  lock_device_exists: 'この店舗には有効な鍵デバイスが既にあります（店舗入口に1台）',
  cleaning_task_not_found: '清掃タスクが見つかりません',
  cleaning_task_closed: 'この清掃タスクは既に完了または取消されています',
  cleaning_worker_invalid: '担当者を選択し直してください',
  memo_required: 'メモを入力してください',
  memo_too_long: 'メモは500文字以内で入力してください',
  line_token_invalid: 'LINEの認証が確認できませんでした。LINEアプリからもう一度開いてください',
  line_not_configured: 'ただいまLINE連携をご利用いただけません。Webサイトからご予約ください',
  line_already_linked:
    'このLINEアカウントは別の会員に連携済みです。連携を解除してから再度お試しください',
  line_link_expired: 'LINE連携の有効期限が切れました。LINEアプリからもう一度開いてください',
  invalid_period: '期間の指定が正しくありません（終了日が開始日より前です）',
  period_too_long: '期間は1年以内で指定してください',
  report_type_unknown: '指定されたレポートは出力できません',
  invalid_url: 'URLの形式が正しくありません',
}

export function toUserMessage(error: unknown): string {
  if (error instanceof DomainError) return messages[error.code] ?? 'ご予約を進められませんでした'
  console.error(error)
  return 'エラーが発生しました。時間をおいて再度お試しください'
}

/** Message for an error code passed in a URL (e.g. after a failed CSV download). */
export function messageForCode(code: string | null | undefined): string | null {
  if (!code) return null
  return messages[code] ?? 'エラーが発生しました。時間をおいて再度お試しください'
}

export function isDomainError(error: unknown, ...codes: string[]): error is DomainError {
  return error instanceof DomainError && (codes.length === 0 || codes.includes(error.code))
}

/**
 * Staff-facing messages for the admin master screens (A-11〜A-23). Codes not listed here fall back
 * to the shared messages above.
 */
const adminMessages: Record<string, string> = {
  member_not_found: '会員が見つかりません（担当店舗の利用履歴がない会員は表示できません）',
  invalid_member_status: '会員の状態を選択してください',
  member_withdrawn: '退会済みの会員には操作できません',
  note_required: '対応内容を入力してください（2,000文字以内）',
  name_required: '名称を入力してください',
  text_too_long: '入力が長すぎます',
  invalid_request: '画面を再読み込みしてからやり直してください',
  invalid_coupon:
    'クーポンの条件が正しくありません。割引値・回数・期間・曜日・時間帯を確認してください',
  invalid_coupon_code:
    'クーポンコードは英数字・ハイフン・アンダースコアの3〜64文字で入力してください',
  coupon_code_taken: 'このクーポンコードは既に使われています',
  coupon_not_found: 'クーポンが見つかりません',
  coupon_not_grantable: 'このクーポンは発行できません（停止中または期限切れ）',
  invalid_segment: 'セグメントの条件が正しくありません',
  invalid_price:
    '料金の設定が正しくありません。金額・最低利用時間・パック（30分単位）を確認してください',
  invalid_duration: '利用時間は30分単位で指定してください',
  invalid_package: 'パックの時間は30分単位で指定してください',
  invalid_price_code: '料金コードは英数字・ハイフン・アンダースコアの2〜32文字で入力してください',
  price_code_taken: 'この料金コードは既に使われています',
  price_profile_not_found: '料金プロファイルが見つかりません',
  price_version_not_found: '公開済みの料金版が見つかりません',
  price_not_set: 'この部屋には指定日時の料金が割り当てられていません',
  rooms_required: '部屋を1つ以上選択してください',
  invalid_store: '店舗の設定が正しくありません。必須項目と数値の範囲を確認してください',
  invalid_store_code: '店舗コードは英数字・ハイフン・アンダースコアの2〜32文字で入力してください',
  store_code_taken: 'この店舗コードは既に使われています',
  invalid_time: '時刻は HH:MM 形式で入力してください（深夜は 26:00 のように入力）',
  invalid_room: '部屋の設定が正しくありません',
  invalid_code: 'コードは英数字・ハイフン・アンダースコアで入力してください',
  code_taken: 'このコード（部屋番号）は既に使われています',
  invalid_photo_url: '写真URLは http(s):// で始まるURLを入力してください',
  room_type_not_found: '部屋タイプが見つかりません',
  room_group_not_found: '部屋グループが見つかりません',
  invalid_template: 'テンプレートの設定が正しくありません',
  template_body_required: '本文を入力してください',
  template_too_long: '本文が長すぎます（SMSは670文字まで）',
  template_subject_required: 'メールの件名を入力してください（250文字以内）',
  template_exists: 'この通知種別・チャネル・店舗のテンプレートは既にあります',
  template_not_found: 'テンプレートが見つかりません',
  template_variable_unknown:
    'この通知種別では使えない差し込み項目があります。一覧の項目のみ使用できます',
  invalid_grants: 'ロールを1つ以上、重複なく設定してください',
  store_required: 'オーナー・本部管理者以外のロールは担当店舗を選択してください',
  invalid_email: 'メールアドレスを正しく入力してください',
  staff_not_found: 'スタッフが見つかりません',
  staff_email_taken: 'このメールアドレスは既に登録されています',
  last_owner: '有効なオーナーが1人もいなくなるため、この変更はできません',
  cannot_disable_self: '自分自身のアカウントは無効にできません',
  forbidden: 'この操作を行う権限がありません（担当店舗を確認してください）',
}

/** Japanese message for admin screens. */
export function toAdminMessage(error: unknown): string {
  if (error instanceof DomainError) {
    const message =
      adminMessages[error.code] ?? messages[error.code] ?? '操作を完了できませんでした'
    // Name the offending placeholders, e.g. （bookingCode）.
    return error.code === 'template_variable_unknown'
      ? `${message}（${error.message.replace(/^unknown variables: /, '')}）`
      : message
  }
  console.error(error)
  return 'エラーが発生しました。時間をおいて再度お試しください'
}
