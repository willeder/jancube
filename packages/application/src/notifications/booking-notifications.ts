import { minuteOfBusinessDay, type NotificationEvent, weekdayOf } from '@jancube/domain'
import type { BookingNotificationQuery, BookingNotificationView } from '../ports/notifications'
import type { OutboxEvent } from '../ports/ops'
import type { NotifyRequest, NotifyResult } from './notify'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** Template variables every booking notification can use (A-21 shows this list). */
export const BOOKING_TEMPLATE_VARIABLES = [
  'bookingCode',
  'storeName',
  'storeAddress',
  'date',
  'startTime',
  'endTime',
  'roomType',
  'roomName',
  'guestCount',
  'total',
  'myPageUrl',
  'customerName',
  'roomLocation',
  'roomPhotoUrl',
  'entryGuideText',
] as const

export function bookingTemplateValues(
  view: BookingNotificationView,
  appUrl: string,
): Record<(typeof BOOKING_TEMPLATE_VARIABLES)[number], string> {
  const [, m, d] = view.businessDate.split('-').map(Number)
  return {
    bookingCode: view.bookingCode,
    storeName: view.storeName,
    storeAddress: view.storeAddress ?? '',
    date: `${m}月${d}日(${WEEKDAYS[weekdayOf(view.businessDate)]})`,
    startTime: hhmm(minuteOfBusinessDay(view.businessDate, view.start, view.timezone)),
    endTime: hhmm(minuteOfBusinessDay(view.businessDate, view.end, view.timezone)),
    roomType: view.roomTypeName,
    roomName: view.roomName ?? '前日にお知らせします',
    guestCount: `${view.guestCount}名`,
    total: `${view.total.toLocaleString('ja-JP')}円`,
    myPageUrl: `${appUrl}/mypage/bookings/${view.bookingCode}`,
    customerName: view.customerName ?? '',
    roomLocation: view.roomLocation ?? '',
    roomPhotoUrl: view.roomPhotoUrl ?? '',
    entryGuideText: view.entryGuideText ?? '',
  }
}

/** Sends a booking notification to the booking's member. */
export function makeNotifyBooking(deps: {
  readonly bookings: BookingNotificationQuery
  readonly notify: (request: NotifyRequest) => Promise<NotifyResult>
  readonly appUrl: string
}) {
  return async function notifyBooking(
    bookingId: number,
    event: NotificationEvent,
    extra: {
      values?: Record<string, string>
      secretValueNames?: string[]
      dedupSuffix?: string
    } = {},
  ): Promise<NotifyResult> {
    const view = await deps.bookings.bookingView(bookingId)
    if (!view) throw new Error(`booking ${bookingId} not found`)
    return deps.notify({
      event,
      storeId: view.storeId,
      memberId: view.memberId,
      bookingId,
      values: { ...bookingTemplateValues(view, deps.appUrl), ...extra.values },
      secretValueNames: ['customerName', ...(extra.secretValueNames ?? [])],
      deduplicationKey: `${event}:${bookingId}${extra.dedupSuffix ? `:${extra.dedupSuffix}` : ''}`,
    })
  }
}

/** Outbox handler: booking.confirmed → 予約完了通知 (F-NTF-01). */
export function bookingConfirmedHandler(notifyBooking: ReturnType<typeof makeNotifyBooking>) {
  return async (event: OutboxEvent) => {
    await notifyBooking(event.aggregateId, 'booking_confirmed')
  }
}
