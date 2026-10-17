import type { NotificationEvent } from '@jancube/domain'
import { BOOKING_TEMPLATE_VARIABLES } from './booking-notifications'

/**
 * Variables each notification event provides (A-21). Templates may only use these; publishing a
 * template with any other `{{name}}` is rejected. Code that sends an event must supply every one.
 */
export const TEMPLATE_VARIABLES: Readonly<Record<NotificationEvent, readonly string[]>> = {
  booking_confirmed: BOOKING_TEMPLATE_VARIABLES,
  room_assigned: [
    ...BOOKING_TEMPLATE_VARIABLES,
    'entryCode',
    'codeValidFrom',
    'codeValidTo',
    'previousRoomName',
  ],
  booking_changed: BOOKING_TEMPLATE_VARIABLES,
  booking_canceled: [...BOOKING_TEMPLATE_VARIABLES, 'cancellationFee', 'refundAmount'],
  // Assumption: the refund notice also states the amount refunded.
  refund_completed: [...BOOKING_TEMPLATE_VARIABLES, 'refundAmount'],
  usage_reminder: BOOKING_TEMPLATE_VARIABLES,
  usage_completed: BOOKING_TEMPLATE_VARIABLES,
  coupon_granted: ['couponName', 'couponExpiresAt'],
  payment_link: ['storeName', 'date', 'startTime', 'linkExpiresAt', 'paymentUrl'],
}

/** Japanese labels for the A-21 variable chips. */
export const TEMPLATE_VARIABLE_LABELS: Readonly<Record<string, string>> = {
  bookingCode: '予約番号',
  storeName: '店舗名',
  storeAddress: '店舗住所',
  date: '利用日',
  startTime: '開始時刻',
  endTime: '終了時刻',
  roomType: '部屋タイプ',
  roomName: '部屋名',
  customerName: '予約名',
  roomLocation: '部屋の場所',
  roomPhotoUrl: '部屋の扉写真URL',
  entryGuideText: '店舗入室案内',
  previousRoomName: '変更前の部屋',
  guestCount: '人数',
  total: 'お支払い金額',
  myPageUrl: 'マイページURL',
  entryCode: '入室コード',
  codeValidFrom: 'コード有効開始',
  codeValidTo: 'コード有効終了',
  cancellationFee: 'キャンセル料',
  refundAmount: '返金額',
  couponName: 'クーポン名',
  couponExpiresAt: 'クーポン有効期限',
  linkExpiresAt: '決済期限',
  paymentUrl: '決済URL',
}

/** Sample values for the A-21 preview. */
export const TEMPLATE_SAMPLE_VALUES: Readonly<Record<string, string>> = {
  bookingCode: 'JC-2026-1027',
  storeName: '大阪本町店',
  storeAddress: '大阪市中央区瓦町3-2-7 グリーンビル2階',
  date: '11月8日(日)',
  startTime: '13:00',
  endTime: '16:00',
  roomType: '4麻',
  roomName: 'Room6',
  customerName: '山田 太郎',
  roomLocation: '2階奥の右側',
  roomPhotoUrl: 'https://example.com/room-door.jpg',
  entryGuideText: '入口のキーパッドにコードを入力してください。',
  previousRoomName: 'Room5',
  guestCount: '4名',
  total: '6,100円',
  myPageUrl: 'https://example.com/mypage/bookings/JC-2026-1027',
  entryCode: '1234',
  codeValidFrom: '12:45',
  codeValidTo: '16:15',
  cancellationFee: '0円',
  refundAmount: '6,100円',
  couponName: '初回ご利用 500円OFF',
  couponExpiresAt: '2026年12月31日',
  linkExpiresAt: '11月7日 18:00',
  paymentUrl: 'https://example.com/pay/sample',
}

export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEvent, string>> = {
  booking_confirmed: '予約完了',
  room_assigned: '前日通知（部屋番号＋入室コード）',
  booking_changed: '予約変更',
  booking_canceled: 'キャンセル・返金',
  refund_completed: '返金完了',
  coupon_granted: 'クーポン付与',
  payment_link: '決済リンク（代理予約）',
  usage_reminder: '利用前リマインド',
  usage_completed: '利用後のお礼・お支払い完了',
}
