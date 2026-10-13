import {
  addDays,
  DomainError,
  type LocalDate,
  localToUtc,
  minuteOfBusinessDay,
  openingWindow,
  parseLocalDate,
  type StaffAccess,
  type Store,
  utcToLocal,
} from '@jancube/domain'
import type {
  AdminBookingQueries,
  BookingDetail,
  NotificationResendRepository,
  TimelineBlock,
  TimelineBooking,
  TimelineRoom,
} from '../ports/admin-bookings'
import type { BookingStatus } from '../ports/booking-repository'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import type { StoreRepository } from '../ports/store-repository'
import { assertStoreAccess, staffActor, storeFilter } from './access'

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'draft',
  'confirmed',
  'completed',
  'canceled',
  'expired',
]

export const BOOKING_PAGE_SIZE = 20

export interface BookingSearchInput {
  readonly dateFrom?: string | null
  readonly dateTo?: string | null
  readonly status?: string | null
  readonly code?: string | null
  readonly name?: string | null
  readonly phone?: string | null
  readonly source?: string | null
  readonly page?: number
}

const optionalDate = (value: string | null | undefined): LocalDate | null => {
  if (!value) return null
  parseLocalDate(value)
  return value
}

/** A-04 予約一覧・検索 */
export function makeSearchBookings(deps: { readonly queries: AdminBookingQueries }) {
  return async function searchBookings(
    access: StaffAccess,
    selectedStoreId: number | null,
    input: BookingSearchInput,
  ) {
    const stores = storeFilter(access, 'bookings.view', selectedStoreId)
    const page = Math.max(1, Math.floor(input.page ?? 1))
    const status = BOOKING_STATUSES.find((s) => s === input.status) ?? null
    // Phone numbers are matched on their digits; the leading 0 of a national number is dropped
    // because numbers are stored in E.164 (+81…).
    const digits = (input.phone ?? '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/\D/g, '')
      .replace(/^0/, '')
    const result = await deps.queries.search({
      stores,
      dateFrom: optionalDate(input.dateFrom),
      dateTo: optionalDate(input.dateTo),
      statuses: status ? [status] : null,
      code: input.code?.trim() || null,
      name: input.name?.replace(/\s/g, '') || null,
      phoneDigits: digits || null,
      source: input.source?.trim() || null,
      offset: (page - 1) * BOOKING_PAGE_SIZE,
      limit: BOOKING_PAGE_SIZE,
    })
    return {
      ...result,
      page,
      pages: Math.max(1, Math.ceil(result.total / BOOKING_PAGE_SIZE)),
    }
  }
}

/** A-05 予約詳細 */
export function makeGetBookingDetail(deps: { readonly queries: AdminBookingQueries }) {
  return async function getBookingDetail(
    access: StaffAccess,
    bookingCode: string,
  ): Promise<BookingDetail> {
    const detail = await deps.queries.detail(bookingCode)
    if (!detail) throw new DomainError('booking_not_found', 'booking not found')
    assertStoreAccess(access, 'bookings.view', detail.booking.storeId)
    return detail
  }
}

/**
 * A-05 「通知を再送」: queues a copy of a delivery under a new de-duplication key. The stored rendered
 * message is reused (it may contain an entry code that is not kept in clear text anywhere else).
 */
export function makeResendNotification(deps: {
  readonly deliveries: NotificationResendRepository
  readonly audit: AuditLog
  readonly clock: Clock
}) {
  return async function resendNotification(access: StaffAccess, deliveryId: number) {
    const delivery = await deps.deliveries.findDelivery(deliveryId)
    if (!delivery?.bookingId) throw new DomainError('notification_not_found', 'not found')
    assertStoreAccess(access, 'bookings.manage', delivery.storeId)
    const now = deps.clock.now()
    const key = `${delivery.deduplicationKey.slice(0, 150)}:resend:${now.getTime()}`
    await deps.deliveries.requeueCopy(delivery.id, key, now)
    await deps.audit.record({
      actor: staffActor(access),
      action: 'notification.resend',
      targetType: 'notification_delivery',
      targetId: delivery.id,
      storeId: delivery.storeId,
      after: { deduplicationKey: key, bookingId: delivery.bookingId },
    })
  }
}

// ---------------------------------------------------------------- A-03 timeline

export interface TimelineItem {
  readonly kind: 'booking' | 'hold' | 'block'
  readonly startMinute: number
  readonly endMinute: number
  readonly label: string
  readonly bookingCode: string | null
  readonly status: BookingStatus | null
  readonly provisional: boolean
}

export interface TimelineRow {
  readonly key: string
  readonly label: string
  readonly sub: string
  readonly roomId: number | null
  /** Room not in service (paused / broken). */
  readonly inactive: boolean
  readonly dirty: boolean
  readonly unassigned: boolean
  readonly items: readonly TimelineItem[]
}

/** Puts overlapping items on separate rows (first-fit), for unassigned group bookings. */
export function packRows<T extends { startMinute: number; endMinute: number }>(
  items: readonly T[],
): T[][] {
  const rows: T[][] = []
  for (const item of [...items].sort((a, b) => a.startMinute - b.startMinute)) {
    const row = rows.find((r) => (r[r.length - 1]?.endMinute ?? 0) <= item.startMinute)
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows
}

export function buildTimelineRows(input: {
  readonly date: LocalDate
  readonly timezone: string
  readonly now: Date
  readonly rooms: readonly TimelineRoom[]
  readonly bookings: readonly TimelineBooking[]
  readonly blocks: readonly TimelineBlock[]
}): TimelineRow[] {
  const minute = (d: Date) => minuteOfBusinessDay(input.date, d, input.timezone)
  const bookingItem = (b: TimelineBooking): TimelineItem => {
    const hold = b.status === 'draft'
    return {
      kind: hold ? 'hold' : 'booking',
      startMinute: minute(b.start),
      endMinute: minute(b.end),
      label: `${b.customerName ?? (hold ? '仮押さえ' : '—')} ${b.guestCount}名`,
      bookingCode: b.bookingCode,
      status: b.status,
      provisional: b.assignmentStatus === 'provisional',
    }
  }
  const live = input.bookings.filter(
    (b) => b.status !== 'draft' || (b.holdExpiresAt !== null && b.holdExpiresAt > input.now),
  )
  const roomIds = new Set(input.rooms.map((r) => r.id))
  const rows: TimelineRow[] = []
  const groups = [...new Map(input.rooms.map((r) => [r.groupId, r])).values()]
  for (const head of groups) {
    for (const room of input.rooms.filter((r) => r.groupId === head.groupId)) {
      rows.push({
        key: `room:${room.id}`,
        label: room.name,
        sub: room.operatingStatus === 'active' ? head.groupName : `${head.groupName} 休止`,
        roomId: room.id,
        inactive: room.operatingStatus !== 'active',
        dirty: room.cleaningStatus === 'dirty',
        unassigned: false,
        items: [
          ...live.filter((b) => b.roomId === room.id).map(bookingItem),
          ...input.blocks
            .filter((k) => k.roomId === room.id)
            .map(
              (k): TimelineItem => ({
                kind: 'block',
                startMinute: minute(k.start),
                endMinute: minute(k.end),
                label: k.reason,
                bookingCode: null,
                status: null,
                provisional: false,
              }),
            ),
        ].sort((a, b) => a.startMinute - b.startMinute),
      })
    }
    const waiting = live
      .filter((b) => b.groupId === head.groupId && (b.roomId === null || !roomIds.has(b.roomId)))
      .map(bookingItem)
    packRows(waiting).forEach((items, i) => {
      rows.push({
        key: `unassigned:${head.groupId}:${i}`,
        label: '未割当',
        sub: head.groupName,
        roomId: null,
        inactive: false,
        dirty: false,
        unassigned: true,
        items,
      })
    })
  }
  return rows
}

/** A-03 予約状況タイムライン: rooms × time for one business date, with the next days' counts. */
export function makeGetTimeline(deps: {
  readonly queries: AdminBookingQueries
  readonly stores: StoreRepository
  readonly clock: Clock
}) {
  return async function getTimeline(
    access: StaffAccess,
    selectedStoreId: number | null,
    date: string | null,
  ) {
    const filter = storeFilter(access, 'bookings.view', selectedStoreId)
    const active = await deps.stores.listActive()
    const choices = filter === null ? active : active.filter((s) => filter.includes(s.id))
    const store: Store | undefined = choices[0]
    if (!store) throw new DomainError('store_not_found', 'store not found')
    const now = deps.clock.now()
    const today = utcToLocal(now, store.timezone).date
    if (date) parseLocalDate(date)
    const day = date || today

    const [weekly, overrides] = await Promise.all([
      deps.stores.weeklyHours(store.id),
      deps.stores.calendarOverrides(store.id, day, day),
    ])
    const window = openingWindow(day, store.timezone, weekly, overrides[0])
    // Closed days still show the day so bookings made earlier remain visible (10:00–24:00 frame).
    const opensMinute = window?.opensMinute ?? 600
    const closesMinute = window?.closesMinute ?? 1440
    const { rooms, bookings, blocks } = await deps.queries.timeline(
      store.id,
      window?.opensAt ?? localToUtc(day, opensMinute, store.timezone),
      window?.closesAt ?? localToUtc(day, closesMinute, store.timezone),
      now,
    )
    const counts = await deps.queries.dailySales([store.id], today, addDays(today, 6))
    const week: { date: LocalDate; count: number }[] = []
    for (let d = today; d <= addDays(today, 6); d = addDays(d, 1)) {
      week.push({ date: d, count: counts.find((c) => c.date === d)?.count ?? 0 })
    }
    return {
      store: { id: store.id, code: store.code, name: store.name },
      date: day,
      closed: window === null,
      opensMinute,
      closesMinute,
      week,
      rows: buildTimelineRows({
        date: day,
        timezone: store.timezone,
        now,
        rooms,
        bookings,
        blocks,
      }),
    }
  }
}
