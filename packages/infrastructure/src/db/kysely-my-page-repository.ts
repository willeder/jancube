import type {
  BookingStatus,
  LegalDocumentType,
  LegalTextRepository,
  MemberAccount,
  MemberBookingDetail,
  MemberBookingRow,
  MemberCouponGrant,
  MemberStatus,
  MyPageRepository,
  PaymentMethod,
  RoomAssignmentState,
} from '@jancube/application'
import type { Database } from './create-db'
import { toLocalDate, toNumber } from './sql-values'

/** Keys in these states are the booking's current key (access_keys.active_marker = 1). */
const CURRENT_KEY_STATES = ['pending', 'issued', 'active', 'revoke_pending']

function assignmentState(
  requestedRoomId: number | null,
  assignmentStatus: string | null,
): RoomAssignmentState {
  if (requestedRoomId !== null) return 'named'
  if (assignmentStatus === null) return 'none'
  return assignmentStatus === 'final' ? 'final' : 'provisional'
}

/** C-12〜C-17 read models and the member's own account changes. */
export class KyselyMyPageRepository implements MyPageRepository {
  constructor(private readonly db: Database) {}

  async memberBookings(memberId: number): Promise<MemberBookingRow[]> {
    const rows = await this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .leftJoin('rooms as rr', 'rr.id', 'b.requested_room_id')
      .leftJoin('booking_assignments as a', (join) =>
        join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
      )
      .leftJoin('rooms as ar', 'ar.id', 'a.room_id')
      .select([
        'b.booking_code',
        'b.status',
        's.code as store_code',
        's.name as store_name',
        's.timezone',
        'b.business_date',
        'b.starts_at',
        'b.ends_at',
        'g.name as group_name',
        'b.requested_room_id',
        'rr.name as requested_room_name',
        'a.assignment_status',
        'ar.name as assigned_room_name',
        'b.total_amount',
      ])
      .where('b.member_id', '=', memberId)
      .where('b.status', 'in', ['confirmed', 'completed', 'canceled'])
      .orderBy('b.starts_at', 'desc')
      .limit(200)
      .execute()
    return rows.map((r) => {
      const requested = r.requested_room_id === null ? null : Number(r.requested_room_id)
      return {
        bookingCode: r.booking_code,
        status: r.status as BookingStatus,
        storeCode: r.store_code,
        storeName: r.store_name,
        timezone: r.timezone,
        businessDate: toLocalDate(r.business_date),
        start: r.starts_at,
        end: r.ends_at,
        roomGroupName: r.group_name,
        roomName: r.requested_room_name ?? r.assigned_room_name ?? null,
        assignment: assignmentState(requested, r.assignment_status),
        total: Number(r.total_amount),
      }
    })
  }

  async bookingDetail(bookingCode: string): Promise<MemberBookingDetail | null> {
    const b = await this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .innerJoin('room_types as t', 't.id', 'g.room_type_id')
      .leftJoin('rooms as rr', 'rr.id', 'b.requested_room_id')
      .leftJoin('booking_assignments as a', (join) =>
        join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
      )
      .leftJoin('rooms as ar', 'ar.id', 'a.room_id')
      .select([
        'b.id',
        'b.booking_code',
        'b.status',
        'b.member_id',
        's.id as store_id',
        's.code as store_code',
        's.name as store_name',
        's.address',
        's.phone',
        's.access_text',
        's.map_url',
        's.entry_guide_text',
        's.timezone',
        'b.business_date',
        'b.starts_at',
        'b.ends_at',
        'b.guest_count',
        'b.acquisition_source',
        'b.room_group_id',
        'g.room_type_id',
        'g.name as group_name',
        't.capacity',
        'rr.name as requested_name',
        'rr.code as requested_code',
        'ar.name as assigned_name',
        'ar.code as assigned_code',
        'a.assignment_status',
        'b.subtotal_amount',
        'b.discount_amount',
        'b.total_amount',
      ])
      .where('b.booking_code', '=', bookingCode)
      .executeTakeFirst()
    if (!b) return null
    const bookingId = Number(b.id)

    const [price, coupon, payments, refunds, cancellation, key, changes] = await Promise.all([
      this.db
        .selectFrom('price_calculations')
        .select([
          'duration_minutes',
          'base_amount',
          'package_discount_amount',
          'time_discount_amount',
          'tax_rate',
        ])
        .where('booking_id', '=', bookingId)
        .orderBy('revision_no', 'desc')
        .limit(1)
        .executeTakeFirst(),
      this.db
        .selectFrom('coupon_redemptions as r')
        .innerJoin('coupon_grants as cg', 'cg.id', 'r.coupon_grant_id')
        .innerJoin('coupon_versions as v', 'v.id', 'cg.coupon_version_id')
        .innerJoin('coupons as c', 'c.id', 'v.coupon_id')
        .select(['cg.id as grant_id', 'c.name', 'r.discount_amount'])
        .where('r.booking_id', '=', bookingId)
        .where('r.status', 'in', ['reserved', 'applied'])
        .executeTakeFirst(),
      this.db
        .selectFrom('payments')
        .select(['id', 'method', 'amount', 'paid_at'])
        .where('booking_id', '=', bookingId)
        .where('status', '=', 'succeeded')
        .orderBy('paid_at', 'desc')
        .execute(),
      this.db
        .selectFrom('refunds')
        .select(['amount', 'status', 'reason'])
        .where('booking_id', '=', bookingId)
        .orderBy('id')
        .execute(),
      this.db
        .selectFrom('booking_cancellations')
        .select(['requested_at', 'applied_fee_rate', 'fee_amount', 'refund_amount'])
        .where('booking_id', '=', bookingId)
        .executeTakeFirst(),
      this.db
        .selectFrom('access_keys')
        .select(['status', 'valid_from', 'valid_to', 'code_ciphertext'])
        .where('booking_id', '=', bookingId)
        .where('status', 'in', CURRENT_KEY_STATES)
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst(),
      this.db
        .selectFrom('booking_change_history')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('booking_id', '=', bookingId)
        .executeTakeFirstOrThrow(),
    ])

    const subtotal = Number(b.subtotal_amount)
    const regularPrice = price ? Number(price.base_amount) : subtotal
    return {
      id: bookingId,
      bookingCode: b.booking_code,
      status: b.status as BookingStatus,
      memberId: b.member_id === null ? null : Number(b.member_id),
      store: {
        id: Number(b.store_id),
        code: b.store_code,
        name: b.store_name,
        address: b.address,
        phone: b.phone,
        accessText: b.access_text,
        mapUrl: b.map_url,
        entryGuideText: b.entry_guide_text,
        timezone: b.timezone,
      },
      businessDate: toLocalDate(b.business_date),
      start: b.starts_at,
      end: b.ends_at,
      guestCount: b.guest_count,
      acquisitionSource: b.acquisition_source,
      roomGroupId: Number(b.room_group_id),
      roomTypeId: Number(b.room_type_id),
      roomGroupName: b.group_name,
      capacity: b.capacity,
      requestedRoom:
        b.requested_name && b.requested_code
          ? { name: b.requested_name, code: b.requested_code }
          : null,
      assignedRoom:
        b.assigned_name && b.assigned_code
          ? {
              name: b.assigned_name,
              code: b.assigned_code,
              status: b.assignment_status === 'final' ? 'final' : 'provisional',
            }
          : null,
      price: {
        durationMinutes:
          price?.duration_minutes ?? (b.ends_at.getTime() - b.starts_at.getTime()) / 60_000,
        regularPrice,
        packageDiscount: Math.max(0, regularPrice - subtotal),
        subtotal,
        discount: Number(b.discount_amount),
        total: Number(b.total_amount),
        taxRatePercent: price ? toNumber(price.tax_rate) : 10,
      },
      coupon: coupon
        ? {
            grantId: Number(coupon.grant_id),
            name: coupon.name,
            discount: Number(coupon.discount_amount),
          }
        : null,
      payments: payments.flatMap((p) =>
        p.paid_at
          ? [
              {
                id: Number(p.id),
                method: p.method as PaymentMethod | 'other',
                amount: Number(p.amount),
                paidAt: p.paid_at,
              },
            ]
          : [],
      ),
      refunds: refunds.map((r) => ({
        amount: Number(r.amount),
        status: r.status as 'requested' | 'processing' | 'succeeded' | 'failed',
        reason: r.reason,
      })),
      cancellation: cancellation
        ? {
            requestedAt: cancellation.requested_at,
            feeRate: toNumber(cancellation.applied_fee_rate),
            fee: Number(cancellation.fee_amount),
            refund: Number(cancellation.refund_amount),
          }
        : null,
      accessKey: key
        ? {
            status: key.status,
            validFrom: key.valid_from,
            validTo: key.valid_to,
            codeCiphertext: key.code_ciphertext ? new Uint8Array(key.code_ciphertext) : null,
          }
        : null,
      changeCount: Number(changes.n),
    }
  }

  async couponGrants(memberId: number): Promise<MemberCouponGrant[]> {
    const rows = await this.db
      .selectFrom('coupon_grants as g')
      .innerJoin('coupon_versions as v', 'v.id', 'g.coupon_version_id')
      .innerJoin('coupons as c', 'c.id', 'v.coupon_id')
      .select([
        'g.id as grant_id',
        'c.name',
        'c.status as coupon_status',
        'v.id as version_id',
        'v.conditions_note',
        'v.discount_type',
        'v.discount_value',
        'v.maximum_discount_amount',
        'v.minimum_spend_amount',
        'v.weekday_mask',
        'v.start_minute',
        'v.end_minute',
        'v.valid_from as version_from',
        'v.valid_to as version_to',
        'g.max_uses',
        'g.valid_from',
        'g.expires_at',
        'g.revoked_at',
      ])
      .select((eb) => [
        eb
          .selectFrom('coupon_redemptions as r')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('r.coupon_grant_id', '=', 'g.id')
          .where('r.status', 'in', ['reserved', 'applied'])
          .as('used'),
        eb
          .selectFrom('coupon_redemptions as r')
          .select((e) => e.fn.max('r.applied_at').as('at'))
          .whereRef('r.coupon_grant_id', '=', 'g.id')
          .where('r.status', '=', 'applied')
          .as('last_used_at'),
      ])
      .where('g.member_id', '=', memberId)
      .orderBy('g.expires_at')
      .limit(200)
      .execute()
    if (rows.length === 0) return []
    const versionIds = [...new Set(rows.map((r) => Number(r.version_id)))]
    const stores = await this.db
      .selectFrom('coupon_stores as cs')
      .innerJoin('stores as s', 's.id', 'cs.store_id')
      .select(['cs.coupon_version_id', 's.code'])
      .where('cs.coupon_version_id', 'in', versionIds)
      .orderBy('s.code')
      .execute()
    const earlier = (a: Date, b: Date) => (a < b ? a : b)
    const later = (a: Date, b: Date) => (a > b ? a : b)
    return rows.map((r) => ({
      grantId: Number(r.grant_id),
      couponName: r.name,
      couponActive: r.coupon_status === 'active',
      conditionsNote: r.conditions_note,
      discountType: r.discount_type === 'percent' ? 'percent' : 'amount',
      discountValue: toNumber(r.discount_value),
      maximumDiscount:
        r.maximum_discount_amount === null ? null : Number(r.maximum_discount_amount),
      minimumSpend: Number(r.minimum_spend_amount),
      maxUses: r.max_uses,
      used: Number(r.used ?? 0),
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at as unknown as string | Date) : null,
      validFrom: later(r.valid_from, r.version_from),
      expiresAt: earlier(r.expires_at, r.version_to),
      revokedAt: r.revoked_at,
      weekdayMask: r.weekday_mask,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
      storeCodes: stores
        .filter((s) => Number(s.coupon_version_id) === Number(r.version_id))
        .map((s) => s.code),
    }))
  }

  async account(memberId: number): Promise<MemberAccount | null> {
    const row = await this.db
      .selectFrom('members as m')
      .leftJoin('member_line_links as l', 'l.member_id', 'm.id')
      .select([
        'm.id',
        'm.member_code',
        'm.phone_e164',
        'm.family_name',
        'm.given_name',
        'm.email_normalized',
        'm.status',
        'l.friend_status',
        'l.linked_at',
      ])
      .where('m.id', '=', memberId)
      .executeTakeFirst()
    if (!row) return null
    return {
      id: Number(row.id),
      memberCode: row.member_code,
      phone: row.phone_e164,
      familyName: row.family_name,
      givenName: row.given_name,
      email: row.email_normalized,
      status: row.status as MemberStatus,
      line: row.linked_at
        ? {
            friendStatus: (row.friend_status ?? 'unknown') as 'unknown' | 'friend' | 'blocked',
            linkedAt: row.linked_at,
          }
        : null,
    }
  }

  async updateEmail(memberId: number, email: string | null) {
    await this.db
      .updateTable('members')
      .set({ email_normalized: email, email_verified_at: null })
      .where('id', '=', memberId)
      .where('status', '<>', 'withdrawn')
      .execute()
  }

  async upcomingBookingCount(memberId: number, now: Date) {
    const row = await this.db
      .selectFrom('bookings')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('member_id', '=', memberId)
      .where('status', '=', 'confirmed')
      .where('ends_at', '>', now)
      .executeTakeFirstOrThrow()
    return Number(row.n)
  }

  async withdraw(memberId: number, at: Date) {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('members')
        .set({
          status: 'withdrawn',
          withdrawn_at: at,
          anonymized_at: at,
          family_name: null,
          given_name: null,
          phone_e164: null,
          phone_verified_at: null,
          email_normalized: null,
          email_verified_at: null,
        })
        .where('id', '=', memberId)
        .where('status', '<>', 'withdrawn')
        .execute()
      await trx.deleteFrom('member_line_links').where('member_id', '=', memberId).execute()
      // Holds in progress end now; past bookings keep the names for accounting but lose contacts.
      await trx
        .updateTable('bookings')
        .set({ status: 'expired' })
        .where('member_id', '=', memberId)
        .where('status', '=', 'draft')
        .execute()
      await trx
        .updateTable('bookings')
        .set({ contact_phone_e164: null, contact_email: null })
        .where('member_id', '=', memberId)
        .execute()
    })
  }
}

export class KyselyLegalTextRepository implements LegalTextRepository {
  constructor(private readonly db: Database) {}

  async currentDocument(type: LegalDocumentType, at: Date) {
    const row = await this.db
      .selectFrom('legal_documents')
      .select(['document_type', 'version', 'title', 'published_at', 'effective_at'])
      .where('document_type', '=', type)
      .where('effective_at', '<=', at)
      .orderBy('effective_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!row) return null
    return {
      type: row.document_type as LegalDocumentType,
      version: row.version,
      title: row.title,
      publishedAt: row.published_at,
      effectiveAt: row.effective_at,
    }
  }
}
