import type {
  AdminBookingQueries,
  AdminBookingRow,
  AlertRow,
  AlertSeverity,
  AlertStatus,
  AlertWorkRepository,
  BookingDetail,
  BookingSearchFilter,
  BookingStatus,
  IssuedPaymentLink,
  LockedBlockTx,
  MoneyMovementRow,
  NotificationResendRepository,
  OccupyingBookingRef,
  PaymentHistoryFilter,
  PaymentHistoryRepository,
  PaymentLinkRepository,
  RoomBlockRepository,
  StoreFilter,
  TimelineBooking,
} from '@jancube/application'
import type { LocalDate } from '@jancube/domain'
import { sql } from 'kysely'
import type { Database } from './create-db'
import { withInventoryDayLock } from './kysely-booking-repository'
import { KyselyInventoryRepository } from './kysely-inventory-repository'
import { toLocalDate, toNumber } from './sql-values'

const dateValue = (date: LocalDate) => new Date(`${date}T00:00:00Z`)

/** `column IN (stores)`; no condition for all stores. */
function inStores(column: string, stores: StoreFilter) {
  if (stores === null) return sql<boolean>`TRUE`
  const ids = stores.length > 0 ? stores : [-1]
  return sql<boolean>`${sql.ref(column)} IN (${sql.join(ids)})`
}

/** LIKE pattern for a user-entered fragment (wildcards in the input are matched literally). */
const contains = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

const fullName = (family: string | null, given: string | null) =>
  [family, given].filter(Boolean).join(' ') || null

/** Contact snapshot on the booking, otherwise the member's registered name. */
const customerName = sql<string | null>`COALESCE(
  NULLIF(CONCAT_WS(' ', b.contact_family_name, b.contact_given_name), ''),
  NULLIF(CONCAT_WS(' ', m.family_name, m.given_name), ''))`

const parseJson = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value)

const OCCUPYING = (now: Date) =>
  sql<boolean>`(b.status IN ('confirmed','completed') OR (b.status = 'draft' AND b.hold_expires_at > ${now}))`

// ---------------------------------------------------------------- A-02〜A-05 read models

export class KyselyAdminBookingQueries implements AdminBookingQueries {
  constructor(private readonly db: Database) {}

  private bookingRows() {
    return this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .leftJoin('booking_assignments as a', (join) =>
        join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
      )
      .leftJoin('rooms as ar', 'ar.id', 'a.room_id')
      .leftJoin('rooms as rr', 'rr.id', 'b.requested_room_id')
      .leftJoin('members as m', 'm.id', 'b.member_id')
  }

  private static readonly rowColumns = [
    'b.id',
    'b.booking_code',
    'b.status',
    'b.source',
    'b.store_id',
    's.code as store_code',
    's.timezone',
    'b.business_date',
    'b.starts_at',
    'b.ends_at',
    'g.name as group_name',
    'ar.name as assigned_room',
    'rr.name as requested_room',
    'a.assignment_status',
    'b.contact_phone_e164',
    'm.phone_e164 as member_phone',
    'b.guest_count',
    'b.total_amount',
    'b.hold_expires_at',
    'b.member_id',
  ] as const

  private static toRow(r: {
    id: number
    booking_code: string
    status: string
    source: string
    store_id: number
    store_code: string
    timezone: string
    business_date: Date | string
    starts_at: Date
    ends_at: Date
    group_name: string
    assigned_room: string | null
    requested_room: string | null
    assignment_status: string | null
    customer_name: string | null
    contact_phone_e164: string | null
    member_phone: string | null
    guest_count: number
    total_amount: number | string
    hold_expires_at: Date | null
    member_id: number | null
  }): AdminBookingRow {
    return {
      id: Number(r.id),
      bookingCode: r.booking_code,
      status: r.status as BookingStatus,
      source: r.source,
      storeId: Number(r.store_id),
      storeCode: r.store_code,
      timezone: r.timezone,
      businessDate: toLocalDate(r.business_date),
      start: r.starts_at,
      end: r.ends_at,
      roomGroupName: r.group_name,
      roomName: r.assigned_room ?? r.requested_room,
      assignmentStatus: r.assigned_room
        ? r.assignment_status === 'final'
          ? 'final'
          : 'provisional'
        : null,
      customerName: r.customer_name,
      phone: r.contact_phone_e164 ?? r.member_phone,
      guestCount: r.guest_count,
      total: toNumber(r.total_amount),
      holdExpiresAt: r.hold_expires_at,
      memberId: r.member_id === null ? null : Number(r.member_id),
    }
  }

  async search(f: BookingSearchFilter) {
    let q = this.bookingRows().where(inStores('b.store_id', f.stores))
    if (f.dateFrom) q = q.where('b.business_date', '>=', dateValue(f.dateFrom))
    if (f.dateTo) q = q.where('b.business_date', '<=', dateValue(f.dateTo))
    if (f.statuses?.length) q = q.where('b.status', 'in', [...f.statuses])
    if (f.code) q = q.where('b.booking_code', 'like', contains(f.code.toUpperCase()))
    if (f.source) q = q.where('b.source', '=', f.source)
    if (f.name) {
      const pattern = contains(f.name)
      q = q.where(
        sql<boolean>`(CONCAT(COALESCE(b.contact_family_name,''), COALESCE(b.contact_given_name,'')) LIKE ${pattern}
          OR CONCAT(COALESCE(m.family_name,''), COALESCE(m.given_name,'')) LIKE ${pattern})`,
      )
    }
    if (f.phoneDigits) {
      const pattern = contains(f.phoneDigits)
      q = q.where(
        sql<boolean>`(b.contact_phone_e164 LIKE ${pattern} OR m.phone_e164 LIKE ${pattern})`,
      )
    }
    const [rows, count] = await Promise.all([
      q
        .select(KyselyAdminBookingQueries.rowColumns)
        .select(customerName.as('customer_name'))
        .orderBy('b.business_date', 'desc')
        .orderBy('b.starts_at', 'desc')
        .orderBy('b.id', 'desc')
        .offset(f.offset)
        .limit(f.limit)
        .execute(),
      q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ])
    return { rows: rows.map(KyselyAdminBookingQueries.toRow), total: Number(count.n) }
  }

  async dailySales(stores: StoreFilter, from: LocalDate, to: LocalDate) {
    const rows = await this.db
      .selectFrom('bookings as b')
      .select([
        'b.business_date',
        (eb) => eb.fn.sum<number>('b.total_amount').as('amount'),
        (eb) => eb.fn.countAll<number>().as('n'),
      ])
      .where(inStores('b.store_id', stores))
      .where('b.status', 'in', ['confirmed', 'completed'])
      .where('b.business_date', '>=', dateValue(from))
      .where('b.business_date', '<=', dateValue(to))
      .groupBy('b.business_date')
      .orderBy('b.business_date')
      .execute()
    return rows.map((r) => ({
      date: toLocalDate(r.business_date),
      amount: toNumber(r.amount ?? 0),
      count: Number(r.n),
    }))
  }

  async bookedMinutes(stores: StoreFilter, from: LocalDate, to: LocalDate) {
    const row = await this.db
      .selectFrom('bookings as b')
      .select(sql<number>`COALESCE(SUM(TIMESTAMPDIFF(MINUTE, b.starts_at, b.ends_at)), 0)`.as('m'))
      .where(inStores('b.store_id', stores))
      .where('b.status', 'in', ['confirmed', 'completed'])
      .where('b.business_date', '>=', dateValue(from))
      .where('b.business_date', '<=', dateValue(to))
      .executeTakeFirstOrThrow()
    return toNumber(row.m)
  }

  async sources(stores: StoreFilter, from: LocalDate, to: LocalDate) {
    const source = sql<string>`COALESCE(b.acquisition_source, b.source)`
    const rows = await this.db
      .selectFrom('bookings as b')
      .select([
        source.as('source'),
        (eb) => eb.fn.countAll<number>().as('n'),
        (eb) => eb.fn.sum<number>('b.total_amount').as('amount'),
      ])
      .where(inStores('b.store_id', stores))
      .where('b.status', 'in', ['confirmed', 'completed'])
      .where('b.business_date', '>=', dateValue(from))
      .where('b.business_date', '<=', dateValue(to))
      .groupBy(source)
      .execute()
    return rows.map((r) => ({
      source: r.source,
      count: Number(r.n),
      amount: toNumber(r.amount ?? 0),
    }))
  }

  async unassignedCount(stores: StoreFilter, from: LocalDate) {
    const row = await this.db
      .selectFrom('bookings as b')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where(inStores('b.store_id', stores))
      .where('b.status', '=', 'confirmed')
      .where('g.booking_mode', '=', 'group')
      .where('b.requested_room_id', 'is', null)
      .where('b.business_date', '>=', dateValue(from))
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('booking_assignments as a')
              .select('a.id')
              .whereRef('a.booking_id', '=', 'b.id')
              .where('a.released_at', 'is', null),
          ),
        ),
      )
      .executeTakeFirstOrThrow()
    return Number(row.n)
  }

  async dirtyRoomCount(stores: StoreFilter) {
    const row = await this.db
      .selectFrom('rooms as r')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where(inStores('r.store_id', stores))
      .where('r.operating_status', '=', 'active')
      .where('r.cleaning_status', '=', 'dirty')
      .executeTakeFirstOrThrow()
    return Number(row.n)
  }

  async activeRoomCounts(stores: StoreFilter) {
    const rows = await this.db
      .selectFrom('rooms as r')
      .select(['r.store_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where(inStores('r.store_id', stores))
      .where('r.operating_status', '=', 'active')
      .groupBy('r.store_id')
      .execute()
    return rows.map((r) => ({ storeId: Number(r.store_id), rooms: Number(r.n) }))
  }

  async timeline(storeId: number, from: Date, to: Date, now: Date) {
    const [rooms, bookings, blocks] = await Promise.all([
      this.db
        .selectFrom('rooms as r')
        .innerJoin('room_groups as g', 'g.id', 'r.room_group_id')
        .select([
          'r.id',
          'r.room_group_id',
          'g.name as group_name',
          'g.booking_mode',
          'r.code',
          'r.name',
          'r.operating_status',
          'r.cleaning_status',
        ])
        .where('r.store_id', '=', storeId)
        .where('g.is_active', '=', 1)
        .orderBy('g.sort_order')
        .orderBy('r.sort_order')
        .orderBy('r.id')
        .execute(),
      this.bookingRows()
        .select([
          'b.booking_code',
          'b.status',
          'b.room_group_id',
          'a.room_id',
          'b.requested_room_id',
          'a.assignment_status',
          'b.starts_at',
          'b.ends_at',
          'b.guest_count',
          'b.hold_expires_at',
        ])
        .select(customerName.as('customer_name'))
        .where('b.store_id', '=', storeId)
        .where('b.starts_at', '<', to)
        .where('b.ends_at', '>', from)
        .where(OCCUPYING(now))
        .orderBy('b.starts_at')
        .execute(),
      this.db
        .selectFrom('room_blocks as k')
        .innerJoin('rooms as r', 'r.id', 'k.room_id')
        .select(['k.id', 'k.room_id', 'k.starts_at', 'k.ends_at', 'k.reason'])
        .where('r.store_id', '=', storeId)
        .where('k.released_at', 'is', null)
        .where('k.starts_at', '<', to)
        .where('k.ends_at', '>', from)
        .execute(),
    ])
    return {
      rooms: rooms.map((r) => ({
        id: Number(r.id),
        groupId: Number(r.room_group_id),
        groupName: r.group_name,
        bookingMode: r.booking_mode === 'named' ? ('named' as const) : ('group' as const),
        code: r.code,
        name: r.name,
        operatingStatus: r.operating_status as 'active' | 'paused' | 'broken',
        cleaningStatus: r.cleaning_status === 'clean' ? ('clean' as const) : ('dirty' as const),
      })),
      bookings: bookings.map(
        (b): TimelineBooking => ({
          bookingCode: b.booking_code,
          status: b.status as BookingStatus,
          groupId: Number(b.room_group_id),
          roomId:
            b.room_id !== null
              ? Number(b.room_id)
              : b.requested_room_id !== null
                ? Number(b.requested_room_id)
                : null,
          assignmentStatus:
            b.room_id === null ? null : b.assignment_status === 'final' ? 'final' : 'provisional',
          start: b.starts_at,
          end: b.ends_at,
          customerName: b.customer_name,
          guestCount: b.guest_count,
          holdExpiresAt: b.hold_expires_at,
        }),
      ),
      blocks: blocks.map((k) => ({
        id: Number(k.id),
        roomId: Number(k.room_id),
        start: k.starts_at,
        end: k.ends_at,
        reason: k.reason,
      })),
    }
  }

  async detail(bookingCode: string): Promise<BookingDetail | null> {
    const row = await this.bookingRows()
      .innerJoin('room_types as t', 't.id', 'g.room_type_id')
      .leftJoin('staff as cs', 'cs.id', 'b.created_by_staff_id')
      .select(KyselyAdminBookingQueries.rowColumns)
      .select(customerName.as('customer_name'))
      .select([
        's.name as store_name',
        'b.room_group_id',
        'b.created_at',
        'b.confirmed_at',
        'cs.name as created_by_name',
        'b.acquisition_source',
        'b.utm_source',
        'b.utm_medium',
        'b.utm_campaign',
        'b.utm_content',
        'b.contact_email',
        'b.subtotal_amount',
        'b.discount_amount',
      ])
      .where('b.booking_code', '=', bookingCode)
      .executeTakeFirst()
    if (!row) return null
    const id = Number(row.id)
    const db = this.db
    const [
      member,
      cancellation,
      calcs,
      payments,
      refunds,
      coupons,
      assignments,
      keys,
      keyEvents,
      deliveries,
      attempts,
      changes,
      audit,
      links,
    ] = await Promise.all([
      row.member_id === null
        ? null
        : db
            .selectFrom('members as m')
            .leftJoin('member_line_links as l', 'l.member_id', 'm.id')
            .select([
              'm.id',
              'm.member_code',
              'm.family_name',
              'm.given_name',
              'm.phone_e164',
              'm.email_normalized',
              'm.status',
              'l.id as line_link_id',
            ])
            .where('m.id', '=', row.member_id)
            .executeTakeFirst(),
      db
        .selectFrom('booking_cancellations as c')
        .leftJoin('staff as st', 'st.id', 'c.staff_id')
        .selectAll('c')
        .select('st.name as staff_name')
        .where('c.booking_id', '=', id)
        .executeTakeFirst(),
      db
        .selectFrom('price_calculations')
        .selectAll()
        .where('booking_id', '=', id)
        .orderBy('revision_no')
        .execute(),
      db
        .selectFrom('payments')
        .selectAll()
        .where('booking_id', '=', id)
        .orderBy('created_at')
        .execute(),
      db
        .selectFrom('refunds')
        .selectAll()
        .where('booking_id', '=', id)
        .orderBy('created_at')
        .execute(),
      db
        .selectFrom('coupon_redemptions as r')
        .innerJoin('coupon_grants as cg', 'cg.id', 'r.coupon_grant_id')
        .innerJoin('coupon_versions as v', 'v.id', 'cg.coupon_version_id')
        .innerJoin('coupons as c', 'c.id', 'v.coupon_id')
        .select(['c.name', 'r.discount_amount', 'r.status'])
        .where('r.booking_id', '=', id)
        .orderBy('r.id')
        .execute(),
      db
        .selectFrom('booking_assignments as a')
        .innerJoin('rooms as r', 'r.id', 'a.room_id')
        .leftJoin('staff as st', 'st.id', 'a.staff_id')
        .select([
          'r.name as room_name',
          'a.assignment_status',
          'a.source',
          'a.assigned_at',
          'a.released_at',
          'a.reason',
          'st.name as staff_name',
        ])
        .where('a.booking_id', '=', id)
        .orderBy('a.assigned_at')
        .execute(),
      db
        .selectFrom('access_keys as k')
        .innerJoin('lock_devices as d', 'd.id', 'k.lock_device_id')
        .select([
          'k.id',
          'd.name as device_name',
          'k.status',
          'k.valid_from',
          'k.valid_to',
          'k.issued_at',
          'k.revoked_at',
        ])
        .where('k.booking_id', '=', id)
        .orderBy('k.id')
        .execute(),
      db
        .selectFrom('key_events as e')
        .innerJoin('lock_devices as d', 'd.id', 'e.lock_device_id')
        .select(['e.occurred_at', 'e.event_type', 'e.result', 'e.error_code', 'd.name as device'])
        .where('e.booking_id', '=', id)
        .orderBy('e.occurred_at')
        .execute(),
      db
        .selectFrom('notification_deliveries as d')
        .innerJoin('notification_template_versions as v', 'v.id', 'd.template_version_id')
        .innerJoin('notification_templates as t', 't.id', 'v.template_id')
        .select(['d.id', 't.event_type', 'd.channel', 'd.status', 'd.scheduled_at', 'd.sent_at'])
        .where('d.booking_id', '=', id)
        .orderBy('d.scheduled_at')
        .execute(),
      db
        .selectFrom('notification_attempts as n')
        .innerJoin('notification_deliveries as d', 'd.id', 'n.delivery_id')
        .select(['n.delivery_id', 'n.attempt_no', 'n.result', 'n.error_message', 'n.attempted_at'])
        .where('d.booking_id', '=', id)
        .orderBy('n.attempt_no')
        .execute(),
      db
        .selectFrom('booking_change_history as h')
        .leftJoin('staff as st', 'st.id', 'h.staff_id')
        .select([
          'h.changed_at',
          'h.actor_type',
          'st.name as staff_name',
          'h.before_values',
          'h.after_values',
          'h.reason',
        ])
        .where('h.booking_id', '=', id)
        .orderBy('h.changed_at')
        .execute(),
      db
        .selectFrom('audit_logs as l')
        .leftJoin('staff as st', 'st.id', 'l.staff_id')
        .select([
          'l.occurred_at',
          'l.actor_type',
          'st.name as staff_name',
          'l.action',
          'l.before_values',
          'l.after_values',
          'l.reason',
        ])
        .where('l.target_type', '=', 'booking')
        .where('l.target_id', '=', id)
        .orderBy('l.occurred_at')
        .execute(),
      db
        .selectFrom('payment_links as p')
        .leftJoin('staff as st', 'st.id', 'p.issued_by')
        .select([
          'p.created_at',
          'p.expires_at',
          'p.used_at',
          'p.revoked_at',
          'st.name as issued_by_name',
        ])
        .where('p.booking_id', '=', id)
        .orderBy('p.created_at')
        .execute(),
    ])
    const actorLabel = (type: string, staffName: string | null) =>
      type === 'staff' ? (staffName ?? 'スタッフ') : type === 'member' ? '顧客' : 'system'
    const utm = [row.utm_source, row.utm_medium, row.utm_campaign, row.utm_content]
      .filter(Boolean)
      .join(' / ')
    return {
      booking: {
        ...KyselyAdminBookingQueries.toRow(row),
        storeName: row.store_name,
        roomGroupId: Number(row.room_group_id),
        requestedRoomName: row.requested_room,
        createdAt: row.created_at,
        confirmedAt: row.confirmed_at,
        createdByStaffName: row.created_by_name,
        acquisitionSource: row.acquisition_source,
        utm: utm || null,
        contactEmail: row.contact_email,
        subtotal: toNumber(row.subtotal_amount),
        discount: toNumber(row.discount_amount),
      },
      member: member
        ? {
            id: Number(member.id),
            memberCode: member.member_code,
            name: fullName(member.family_name, member.given_name),
            phone: member.phone_e164,
            email: member.email_normalized,
            status: member.status,
            lineLinked: member.line_link_id !== null,
          }
        : null,
      cancellation: cancellation
        ? {
            requestedAt: cancellation.requested_at,
            automaticFeeRate: toNumber(cancellation.automatic_fee_rate),
            appliedFeeRate: toNumber(cancellation.applied_fee_rate),
            paidAmount: toNumber(cancellation.paid_amount),
            feeAmount: toNumber(cancellation.fee_amount),
            refundAmount: toNumber(cancellation.refund_amount),
            reason: cancellation.reason,
            staffName: cancellation.staff_name,
            manualOverride: cancellation.is_manual_override === 1,
          }
        : null,
      priceCalculations: calcs.map((c) => ({
        revisionNo: c.revision_no,
        durationMinutes: c.duration_minutes,
        baseAmount: toNumber(c.base_amount),
        packageDiscount: toNumber(c.package_discount_amount),
        timeDiscount: toNumber(c.time_discount_amount),
        couponDiscount: toNumber(c.coupon_discount_amount),
        total: toNumber(c.total_amount),
        taxRate: toNumber(c.tax_rate),
        createdAt: c.created_at,
      })),
      payments: payments.map((p) => ({
        id: Number(p.id),
        method: p.method,
        status: p.status,
        amount: toNumber(p.amount),
        provider: p.provider,
        paidAt: p.paid_at,
        createdAt: p.created_at,
        failureMessage: p.failure_message,
      })),
      refunds: refunds.map((r) => ({
        id: Number(r.id),
        status: r.status,
        amount: toNumber(r.amount),
        reason: r.reason,
        createdAt: r.created_at,
        refundedAt: r.refunded_at,
        failureMessage: r.failure_message,
      })),
      coupons: coupons.map((c) => ({
        couponName: c.name,
        discount: toNumber(c.discount_amount),
        status: c.status,
      })),
      assignments: assignments.map((a) => ({
        roomName: a.room_name,
        status: a.assignment_status,
        source: a.source,
        assignedAt: a.assigned_at,
        releasedAt: a.released_at,
        reason: a.reason,
        staffName: a.staff_name,
      })),
      keys: keys.map((k) => ({
        id: Number(k.id),
        deviceName: k.device_name,
        status: k.status,
        validFrom: k.valid_from,
        validTo: k.valid_to,
        issuedAt: k.issued_at,
        revokedAt: k.revoked_at,
      })),
      keyEvents: keyEvents.map((e) => ({
        occurredAt: e.occurred_at,
        eventType: e.event_type,
        result: e.result,
        errorCode: e.error_code,
        deviceName: e.device,
      })),
      notifications: deliveries.map((d) => ({
        id: Number(d.id),
        event: d.event_type,
        channel: d.channel,
        status: d.status,
        scheduledAt: d.scheduled_at,
        sentAt: d.sent_at,
        attempts: attempts
          .filter((a) => Number(a.delivery_id) === Number(d.id))
          .map((a) => ({
            attemptNo: a.attempt_no,
            result: a.result,
            error: a.error_message,
            at: a.attempted_at,
          })),
      })),
      changes: changes.map((h) => ({
        changedAt: h.changed_at,
        actor: actorLabel(h.actor_type, h.staff_name),
        before: parseJson(h.before_values),
        after: parseJson(h.after_values),
        reason: h.reason,
      })),
      audit: audit.map((l) => ({
        occurredAt: l.occurred_at,
        actor: actorLabel(l.actor_type, l.staff_name),
        action: l.action,
        before: parseJson(l.before_values),
        after: parseJson(l.after_values),
        reason: l.reason,
      })),
      paymentLinks: links.map((p) => ({
        createdAt: p.created_at,
        expiresAt: p.expires_at,
        usedAt: p.used_at,
        revokedAt: p.revoked_at,
        issuedByName: p.issued_by_name,
      })),
    }
  }
}

// ---------------------------------------------------------------- A-06 / C-18 payment links

export class KyselyPaymentLinkRepository implements PaymentLinkRepository {
  constructor(private readonly db: Database) {}

  async create(link: Parameters<PaymentLinkRepository['create']>[0]) {
    const inserted = await this.db
      .insertInto('payment_links')
      .values({
        booking_id: link.bookingId,
        token_hash: Buffer.from(link.tokenHash, 'hex'),
        expires_at: link.expiresAt,
        issued_by: link.issuedBy,
      })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async findByTokenHash(tokenHash: string) {
    const row = await this.db
      .selectFrom('payment_links as p')
      .innerJoin('bookings as b', 'b.id', 'p.booking_id')
      .leftJoin('staff as st', 'st.id', 'p.issued_by')
      .select([
        'p.id',
        'p.booking_id',
        'b.booking_code',
        'b.client_request_key',
        'b.contact_phone_e164',
        'p.expires_at',
        'p.used_at',
        'p.revoked_at',
        'st.name as issued_by_name',
      ])
      .where('p.token_hash', '=', Buffer.from(tokenHash, 'hex'))
      .executeTakeFirst()
    if (!row) return null
    return {
      id: Number(row.id),
      bookingId: Number(row.booking_id),
      bookingCode: row.booking_code,
      requestKey: row.client_request_key,
      contactPhone: row.contact_phone_e164,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
      issuedByName: row.issued_by_name,
    }
  }

  async listIssued(stores: StoreFilter, since: Date): Promise<IssuedPaymentLink[]> {
    const rows = await this.db
      .selectFrom('payment_links as p')
      .innerJoin('bookings as b', 'b.id', 'p.booking_id')
      .leftJoin('members as m', 'm.id', 'b.member_id')
      .select([
        'p.id',
        'p.created_at',
        'b.booking_code',
        'b.status',
        'b.total_amount',
        'p.expires_at',
        'p.used_at',
        'p.revoked_at',
      ])
      .select(customerName.as('customer_name'))
      .where(inStores('b.store_id', stores))
      .where('p.created_at', '>=', since)
      .orderBy('p.created_at', 'desc')
      .limit(100)
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      issuedAt: r.created_at,
      bookingCode: r.booking_code,
      bookingStatus: r.status as BookingStatus,
      customerName: r.customer_name,
      total: toNumber(r.total_amount),
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      revokedAt: r.revoked_at,
    }))
  }
}

// ---------------------------------------------------------------- A-22 room blocks

export class KyselyRoomBlockRepository implements RoomBlockRepository {
  constructor(private readonly db: Database) {}

  withInventoryLock<T>(
    roomGroupId: number,
    businessDate: LocalDate,
    fn: (tx: LockedBlockTx) => Promise<T>,
  ): Promise<T> {
    return withInventoryDayLock(this.db, roomGroupId, businessDate, (trx) => {
      const inventory = new KyselyInventoryRepository(trx)
      return fn({
        loadInventory: (storeId, from, to, now) => inventory.load(storeId, from, to, now),
        occupyingBookings: async (storeId, from, to, now): Promise<OccupyingBookingRef[]> => {
          const rows = await trx
            .selectFrom('bookings as b')
            .leftJoin('booking_assignments as a', (join) =>
              join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
            )
            .select([
              'b.booking_code',
              'b.status',
              'b.room_group_id',
              'a.room_id',
              'b.requested_room_id',
              'b.starts_at',
              'b.ends_at',
            ])
            .where('b.store_id', '=', storeId)
            .where('b.starts_at', '<', to)
            .where('b.ends_at', '>', from)
            .where(OCCUPYING(now))
            .execute()
          return rows.map((b) => ({
            bookingCode: b.booking_code,
            status: b.status as BookingStatus,
            groupId: Number(b.room_group_id),
            roomId:
              b.room_id !== null
                ? Number(b.room_id)
                : b.requested_room_id !== null
                  ? Number(b.requested_room_id)
                  : null,
            start: b.starts_at,
            end: b.ends_at,
          }))
        },
        createBlock: async (block) => {
          const inserted = await trx
            .insertInto('room_blocks')
            .values({
              room_id: block.roomId,
              starts_at: block.start,
              ends_at: block.end,
              reason: block.reason,
              created_by: block.createdBy,
            })
            .executeTakeFirstOrThrow()
          return Number(inserted.insertId)
        },
      })
    })
  }

  async rooms(storeId: number) {
    const rows = await this.db
      .selectFrom('rooms as r')
      .innerJoin('room_groups as g', 'g.id', 'r.room_group_id')
      .select(['r.id', 'r.room_group_id', 'r.code', 'r.name'])
      .where('r.store_id', '=', storeId)
      .orderBy('g.sort_order')
      .orderBy('r.sort_order')
      .orderBy('r.id')
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      groupId: Number(r.room_group_id),
      code: r.code,
      name: r.name,
    }))
  }

  async list(stores: StoreFilter, from: Date) {
    const rows = await this.db
      .selectFrom('room_blocks as k')
      .innerJoin('rooms as r', 'r.id', 'k.room_id')
      .innerJoin('stores as s', 's.id', 'r.store_id')
      .leftJoin('staff as st', 'st.id', 'k.created_by')
      .select([
        'k.id',
        'r.store_id',
        's.code as store_code',
        'k.room_id',
        'r.name as room_name',
        'k.starts_at',
        'k.ends_at',
        'k.reason',
        'st.name as created_by_name',
      ])
      .where(inStores('r.store_id', stores))
      .where('k.released_at', 'is', null)
      .where('k.ends_at', '>', from)
      .orderBy('k.starts_at')
      .orderBy('r.sort_order')
      .limit(500)
      .execute()
    return rows.map((k) => ({
      id: Number(k.id),
      storeId: Number(k.store_id),
      storeCode: k.store_code,
      roomId: Number(k.room_id),
      roomName: k.room_name,
      start: k.starts_at,
      end: k.ends_at,
      reason: k.reason,
      createdByName: k.created_by_name,
    }))
  }

  async find(id: number) {
    const row = await this.db
      .selectFrom('room_blocks as k')
      .innerJoin('rooms as r', 'r.id', 'k.room_id')
      .select(['k.id', 'r.store_id', 'k.released_at'])
      .where('k.id', '=', id)
      .executeTakeFirst()
    return row
      ? { id: Number(row.id), storeId: Number(row.store_id), releasedAt: row.released_at }
      : null
  }

  async release(id: number, staffId: number, at: Date) {
    await this.db
      .updateTable('room_blocks')
      .set({ released_at: at, released_by: staffId })
      .where('id', '=', id)
      .where('released_at', 'is', null)
      .execute()
  }
}

// ---------------------------------------------------------------- A-25 alerts

export class KyselyAlertWorkRepository implements AlertWorkRepository {
  constructor(private readonly db: Database) {}

  async list(filter: Parameters<AlertWorkRepository['list']>[0]): Promise<AlertRow[]> {
    let q = this.db
      .selectFrom('alerts as a')
      .leftJoin('stores as s', 's.id', 'a.store_id')
      .leftJoin('bookings as b', 'b.id', 'a.booking_id')
      .leftJoin('staff as st', 'st.id', 'a.assigned_staff_id')
      .select([
        'a.id',
        'a.alert_type',
        'a.severity',
        'a.status',
        'a.failure_reason',
        'a.recovery_steps',
        'a.detected_at',
        'a.resolved_at',
        'a.store_id',
        's.code as store_code',
        'b.booking_code',
        'a.assigned_staff_id',
        'st.name as staff_name',
      ])
      .where(inStores('a.store_id', filter.stores))
      .where('a.status', 'in', [...filter.statuses])
    if (filter.severity) q = q.where('a.severity', '=', filter.severity)
    if (filter.alertType) q = q.where('a.alert_type', '=', filter.alertType)
    const rows = await q
      .orderBy(sql`FIELD(a.severity, 'critical', 'warning', 'info')`)
      .orderBy('a.detected_at', 'desc')
      .limit(filter.limit)
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      alertType: r.alert_type,
      severity: r.severity as AlertSeverity,
      status: r.status as AlertStatus,
      failureReason: r.failure_reason,
      recoverySteps: r.recovery_steps,
      detectedAt: r.detected_at,
      resolvedAt: r.resolved_at,
      storeId: r.store_id === null ? null : Number(r.store_id),
      storeCode: r.store_code,
      bookingCode: r.booking_code,
      assignedStaffId: r.assigned_staff_id === null ? null : Number(r.assigned_staff_id),
      assignedStaffName: r.staff_name,
    }))
  }

  async counts(stores: StoreFilter, resolvedSince: Date) {
    const row = await this.db
      .selectFrom('alerts as a')
      .select([
        sql<number>`SUM(a.status = 'open')`.as('open'),
        sql<number>`SUM(a.status = 'in_progress')`.as('in_progress'),
        sql<number>`SUM(a.status = 'resolved' AND a.resolved_at >= ${resolvedSince})`.as(
          'resolved',
        ),
      ])
      .where(inStores('a.store_id', stores))
      .executeTakeFirstOrThrow()
    return {
      open: toNumber(row.open ?? 0),
      inProgress: toNumber(row.in_progress ?? 0),
      resolvedSince: toNumber(row.resolved ?? 0),
    }
  }

  async find(id: number) {
    const row = await this.db
      .selectFrom('alerts')
      .select(['id', 'store_id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst()
    return row
      ? {
          id: Number(row.id),
          storeId: row.store_id === null ? null : Number(row.store_id),
          status: row.status as AlertStatus,
        }
      : null
  }

  async assign(id: number, staffId: number) {
    await this.db
      .updateTable('alerts')
      .set({ status: 'in_progress', assigned_staff_id: staffId })
      .where('id', '=', id)
      .where('status', '<>', 'resolved')
      .execute()
  }

  async resolveById(id: number, at: Date) {
    await this.db
      .updateTable('alerts')
      .set({ status: 'resolved', resolved_at: at })
      .where('id', '=', id)
      .where('status', '<>', 'resolved')
      .execute()
  }
}

// ---------------------------------------------------------------- A-26 payments and refunds

export class KyselyPaymentHistoryRepository implements PaymentHistoryRepository {
  constructor(private readonly db: Database) {}

  async list(f: PaymentHistoryFilter): Promise<MoneyMovementRow[]> {
    const paymentAt = sql<Date>`COALESCE(p.paid_at, p.created_at)`
    const refundAt = sql<Date>`COALESCE(r.refunded_at, r.created_at)`
    const [payments, refunds] = await Promise.all([
      f.kind === 'refund'
        ? []
        : (() => {
            let q = this.db
              .selectFrom('payments as p')
              .innerJoin('bookings as b', 'b.id', 'p.booking_id')
              .innerJoin('stores as s', 's.id', 'b.store_id')
              .leftJoin('members as m', 'm.id', 'b.member_id')
              .select([
                'p.id',
                paymentAt.as('at'),
                'b.booking_code',
                's.code as store_code',
                'p.method',
                'p.amount',
                'p.status',
                'p.failure_message',
              ])
              .select(customerName.as('customer_name'))
              .where(inStores('b.store_id', f.stores))
              .where(paymentAt, '>=', f.from)
              .where(paymentAt, '<', f.to)
            if (f.method) q = q.where('p.method', '=', f.method)
            if (f.status) q = q.where('p.status', '=', f.status)
            return q.orderBy('at', 'desc').limit(f.limit).execute()
          })(),
      f.kind === 'payment'
        ? []
        : (() => {
            let q = this.db
              .selectFrom('refunds as r')
              .innerJoin('payments as p', 'p.id', 'r.payment_id')
              .innerJoin('bookings as b', 'b.id', 'r.booking_id')
              .innerJoin('stores as s', 's.id', 'b.store_id')
              .leftJoin('members as m', 'm.id', 'b.member_id')
              .select([
                'r.id',
                refundAt.as('at'),
                'b.booking_code',
                's.code as store_code',
                'p.method',
                'r.amount',
                'r.status',
                'r.failure_message',
              ])
              .select(customerName.as('customer_name'))
              .where(inStores('b.store_id', f.stores))
              .where(refundAt, '>=', f.from)
              .where(refundAt, '<', f.to)
            if (f.method) q = q.where('p.method', '=', f.method)
            if (f.status) q = q.where('r.status', '=', f.status)
            return q.orderBy('at', 'desc').limit(f.limit).execute()
          })(),
    ])
    const rows: MoneyMovementRow[] = [
      ...payments.map((p) => ({
        kind: 'payment' as const,
        id: Number(p.id),
        at: new Date(p.at),
        bookingCode: p.booking_code,
        storeCode: p.store_code,
        customerName: p.customer_name,
        method: p.method,
        amount: toNumber(p.amount),
        status: p.status,
        failureMessage: p.failure_message,
      })),
      ...refunds.map((r) => ({
        kind: 'refund' as const,
        id: Number(r.id),
        at: new Date(r.at),
        bookingCode: r.booking_code,
        storeCode: r.store_code,
        customerName: r.customer_name,
        method: r.method,
        amount: toNumber(r.amount),
        status: r.status,
        failureMessage: r.failure_message,
      })),
    ]
    return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, f.limit)
  }

  async totals(stores: StoreFilter, from: Date, to: Date) {
    const [paid, refunded, pending] = await Promise.all([
      this.db
        .selectFrom('payments as p')
        .innerJoin('bookings as b', 'b.id', 'p.booking_id')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('p.amount'), eb.lit(0)).as('n'))
        .where(inStores('b.store_id', stores))
        .where('p.status', '=', 'succeeded')
        .where('p.paid_at', '>=', from)
        .where('p.paid_at', '<', to)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('refunds as r')
        .innerJoin('bookings as b', 'b.id', 'r.booking_id')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('r.amount'), eb.lit(0)).as('n'))
        .where(inStores('b.store_id', stores))
        .where('r.status', '=', 'succeeded')
        .where('r.refunded_at', '>=', from)
        .where('r.refunded_at', '<', to)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('payments as p')
        .innerJoin('bookings as b', 'b.id', 'p.booking_id')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where(inStores('b.store_id', stores))
        .where('p.status', 'in', ['pending', 'processing'])
        .where('p.created_at', '>=', from)
        .where('p.created_at', '<', to)
        .executeTakeFirstOrThrow(),
    ])
    return {
      paid: toNumber(paid.n ?? 0),
      refunded: toNumber(refunded.n ?? 0),
      pending: Number(pending.n),
    }
  }

  async findRefund(id: number) {
    const row = await this.db
      .selectFrom('refunds as r')
      .innerJoin('payments as p', 'p.id', 'r.payment_id')
      .innerJoin('bookings as b', 'b.id', 'r.booking_id')
      .select([
        'r.id',
        'r.booking_id',
        'b.booking_code',
        'b.store_id',
        'r.payment_id',
        'p.external_payment_id',
        'r.amount',
        'r.idempotency_key',
        'r.status',
      ])
      .where('r.id', '=', id)
      .executeTakeFirst()
    if (!row) return null
    return {
      id: Number(row.id),
      bookingId: Number(row.booking_id),
      bookingCode: row.booking_code,
      storeId: Number(row.store_id),
      paymentId: Number(row.payment_id),
      externalPaymentId: row.external_payment_id,
      amount: toNumber(row.amount),
      idempotencyKey: row.idempotency_key,
      status: row.status,
    }
  }
}

// ---------------------------------------------------------------- A-05 notification resend

export class KyselyNotificationResendRepository implements NotificationResendRepository {
  constructor(private readonly db: Database) {}

  async findDelivery(id: number) {
    const row = await this.db
      .selectFrom('notification_deliveries as d')
      .leftJoin('bookings as b', 'b.id', 'd.booking_id')
      .select(['d.id', 'd.booking_id', 'b.store_id', 'd.deduplication_key'])
      .where('d.id', '=', id)
      .executeTakeFirst()
    if (!row) return null
    return {
      id: Number(row.id),
      bookingId: row.booking_id === null ? null : Number(row.booking_id),
      storeId: row.store_id === null ? null : Number(row.store_id),
      deduplicationKey: row.deduplication_key,
    }
  }

  async requeueCopy(deliveryId: number, deduplicationKey: string, scheduledAt: Date) {
    await this.db
      .insertInto('notification_deliveries')
      .columns([
        'member_id',
        'booking_id',
        'coupon_grant_id',
        'payment_link_id',
        'template_version_id',
        'channel',
        'destination_ciphertext',
        'message_ciphertext',
        'context_redacted',
        'deduplication_key',
        'status',
        'scheduled_at',
      ])
      .expression((eb) =>
        eb
          .selectFrom('notification_deliveries as d')
          .select([
            'd.member_id',
            'd.booking_id',
            'd.coupon_grant_id',
            'd.payment_link_id',
            'd.template_version_id',
            'd.channel',
            'd.destination_ciphertext',
            'd.message_ciphertext',
            'd.context_redacted',
            sql<string>`${deduplicationKey}`.as('deduplication_key'),
            sql<string>`'queued'`.as('status'),
            sql<Date>`${scheduledAt}`.as('scheduled_at'),
          ])
          .where('d.id', '=', deliveryId)
          .where('d.message_ciphertext', 'is not', null),
      )
      .execute()
  }
}
