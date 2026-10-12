import type {
  MemberAdminRepository,
  MemberListRow,
  MemberProfileView,
  MemberSearch,
  MemberStatus,
} from '@jancube/application'
import { sql } from 'kysely'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

/** Bookings that count as a use: confirmed (upcoming) or completed. */
const USED = ['confirmed', 'completed']

const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

/** A-11 / A-12 member read models and CS writes. */
export class KyselyMemberAdminRepository implements MemberAdminRepository {
  constructor(private readonly db: Database) {}

  /** Members joined with their LINE link, filtered by the A-11 search (all members when null). */
  private filtered(search: MemberSearch | null) {
    return this.db
      .selectFrom('members as m')
      .leftJoin('member_line_links as l', 'l.member_id', 'm.id')
      .where((eb) => {
        const conditions = []
        if (search?.text || search?.phoneDigits) {
          const any = []
          if (search.text) {
            const like = `%${likeEscape(search.text)}%`
            // member_code is an ascii_bin column: compare only ASCII input, upper-cased.
            if (/^[\x20-\x7e]+$/.test(search.text)) {
              any.push(eb('m.member_code', 'like', like.toUpperCase()))
            }
            any.push(
              eb('m.email_normalized', 'like', like.toLowerCase()),
              eb('m.family_name', 'like', like),
              eb('m.given_name', 'like', like),
              eb(
                sql<string>`concat(m.family_name, m.given_name)`,
                'like',
                like.replace(/\s+/g, ''),
              ),
            )
          }
          if (search.phoneDigits) {
            any.push(eb('m.phone_e164', 'like', `+81%${likeEscape(search.phoneDigits)}%`))
          }
          conditions.push(eb.or(any))
        }
        if (search?.status) conditions.push(eb('m.status', '=', search.status))
        if (search?.line === 'linked') conditions.push(eb('l.id', 'is not', null))
        if (search?.line === 'unlinked') conditions.push(eb('l.id', 'is', null))
        if (search?.storeIds) {
          const stores = search.storeIds.length > 0 ? [...search.storeIds] : [0]
          conditions.push(
            eb.exists(
              eb
                .selectFrom('bookings as sb')
                .select('sb.id')
                .whereRef('sb.member_id', '=', 'm.id')
                .where('sb.store_id', 'in', stores)
                .where('sb.status', '<>', 'draft'),
            ),
          )
        }
        return eb.and(conditions)
      })
  }

  private detailed(search: MemberSearch | null) {
    return this.filtered(search)
      .select([
        'm.id',
        'm.member_code',
        'm.family_name',
        'm.given_name',
        'm.phone_e164',
        'm.email_normalized',
        'm.status',
        'm.created_at',
        'm.registration_source',
        'm.withdrawn_at',
        'l.linked_at',
        'l.friend_status',
      ])
      .select((eb) => [
        eb
          .selectFrom('bookings as b')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('b.member_id', '=', 'm.id')
          .where('b.status', 'in', USED)
          .as('use_count'),
        eb
          .selectFrom('bookings as b')
          .select((e) => e.fn.max('b.business_date').as('d'))
          .whereRef('b.member_id', '=', 'm.id')
          .where('b.status', 'in', USED)
          .as('last_use'),
      ])
  }

  async search(search: MemberSearch) {
    const [count, rows] = await Promise.all([
      this.filtered(search)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
      this.detailed(search)
        .orderBy('m.id', 'desc')
        .offset(search.offset)
        .limit(search.limit)
        .execute(),
    ])
    return { total: Number(count.n), rows: rows.map(toProfile) }
  }

  async findByCode(memberCode: string) {
    const row = await this.detailed(null).where('m.member_code', '=', memberCode).executeTakeFirst()
    return row ? toProfile(row) : null
  }

  async hasBookingAt(memberId: number, storeIds: readonly number[]) {
    if (storeIds.length === 0) return false
    const row = await this.db
      .selectFrom('bookings')
      .select('id')
      .where('member_id', '=', memberId)
      .where('store_id', 'in', [...storeIds])
      .where('status', '<>', 'draft')
      .limit(1)
      .executeTakeFirst()
    return !!row
  }

  async bookings(memberId: number, storeIds: readonly number[] | null) {
    let query = this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .leftJoin('booking_assignments as a', (j) =>
        j.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
      )
      .leftJoin('rooms as ar', 'ar.id', 'a.room_id')
      .leftJoin('rooms as rr', 'rr.id', 'b.requested_room_id')
      .select([
        'b.booking_code',
        's.code as store_code',
        's.timezone',
        'g.name as group_name',
        'ar.code as assigned_room',
        'rr.code as requested_room',
        'b.business_date',
        'b.starts_at',
        'b.ends_at',
        'b.total_amount',
        'b.status',
      ])
      .where('b.member_id', '=', memberId)
      .where('b.status', '<>', 'draft')
    if (storeIds) query = query.where('b.store_id', 'in', storeIds.length ? [...storeIds] : [0])
    const rows = await query.orderBy('b.starts_at', 'desc').limit(50).execute()
    return rows.map((r) => ({
      bookingCode: r.booking_code,
      storeCode: r.store_code,
      roomLabel: r.assigned_room ?? r.requested_room ?? r.group_name,
      businessDate: toLocalDate(r.business_date),
      start: r.starts_at,
      end: r.ends_at,
      timezone: r.timezone,
      total: Number(r.total_amount),
      status: r.status,
    }))
  }

  async payments(memberId: number, storeIds: readonly number[] | null) {
    let query = this.db
      .selectFrom('payments as p')
      .innerJoin('bookings as b', 'b.id', 'p.booking_id')
      .select(['p.paid_at', 'p.created_at', 'b.booking_code', 'p.method', 'p.amount', 'p.status'])
      .where('b.member_id', '=', memberId)
    if (storeIds) query = query.where('b.store_id', 'in', storeIds.length ? [...storeIds] : [0])
    const rows = await query.orderBy('p.created_at', 'desc').limit(50).execute()
    return rows.map((r) => ({
      at: r.paid_at ?? r.created_at,
      bookingCode: r.booking_code,
      method: r.method,
      amount: Number(r.amount),
      status: r.status,
    }))
  }

  async coupons(memberId: number) {
    const rows = await this.db
      .selectFrom('coupon_grants as g')
      .innerJoin('coupon_versions as v', 'v.id', 'g.coupon_version_id')
      .innerJoin('coupons as c', 'c.id', 'v.coupon_id')
      .select([
        'g.id',
        'c.name',
        'v.discount_type',
        'v.discount_value',
        'g.max_uses',
        'g.expires_at',
        'g.granted_at',
        'g.revoked_at',
      ])
      .select((eb) =>
        eb
          .selectFrom('coupon_redemptions as r')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('r.coupon_grant_id', '=', 'g.id')
          .where('r.status', 'in', ['reserved', 'applied'])
          .as('used'),
      )
      .where('g.member_id', '=', memberId)
      .orderBy('g.granted_at', 'desc')
      .limit(100)
      .execute()
    return rows.map((r) => ({
      grantId: Number(r.id),
      couponName: r.name,
      discountType: r.discount_type as 'amount' | 'percent',
      discountValue: Number(r.discount_value),
      maxUses: r.max_uses,
      used: Number(r.used ?? 0),
      expiresAt: r.expires_at,
      grantedAt: r.granted_at,
      revokedAt: r.revoked_at,
    }))
  }

  async consents(memberId: number) {
    const rows = await this.db
      .selectFrom('member_consents as c')
      .innerJoin('legal_documents as d', 'd.id', 'c.legal_document_id')
      .select(['d.document_type', 'd.title', 'd.version', 'c.agreed_at', 'c.channel'])
      .where('c.member_id', '=', memberId)
      .orderBy('c.agreed_at', 'desc')
      .execute()
    return rows.map((r) => ({
      documentType: r.document_type,
      title: r.title,
      version: r.version,
      agreedAt: r.agreed_at,
      channel: r.channel,
    }))
  }

  async notes(memberId: number) {
    const rows = await this.db
      .selectFrom('member_notes as n')
      .innerJoin('staff as s', 's.id', 'n.staff_id')
      .leftJoin('bookings as b', 'b.id', 'n.booking_id')
      .select(['n.id', 'n.occurred_at', 's.name', 'n.body', 'b.booking_code'])
      .where('n.member_id', '=', memberId)
      .orderBy('n.occurred_at', 'desc')
      .limit(100)
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      occurredAt: r.occurred_at,
      staffName: r.name,
      body: r.body,
      bookingCode: r.booking_code,
    }))
  }

  async bookingIdForMember(memberId: number, bookingCode: string) {
    const row = await this.db
      .selectFrom('bookings')
      .select('id')
      .where('member_id', '=', memberId)
      .where('booking_code', '=', bookingCode)
      .executeTakeFirst()
    return row ? Number(row.id) : null
  }

  async setStatus(memberId: number, status: MemberStatus) {
    await this.db
      .updateTable('members')
      .set({ status })
      .where('id', '=', memberId)
      .where('status', '<>', 'withdrawn')
      .execute()
  }

  async addNote(note: Parameters<MemberAdminRepository['addNote']>[0]) {
    const result = await this.db
      .insertInto('member_notes')
      .values({
        member_id: note.memberId,
        staff_id: note.staffId,
        booking_id: note.bookingId,
        body: note.body,
        occurred_at: note.occurredAt,
      })
      .executeTakeFirstOrThrow()
    return Number(result.insertId)
  }
}

function toProfile(r: {
  id: number
  member_code: string
  family_name: string | null
  given_name: string | null
  phone_e164: string | null
  email_normalized: string | null
  status: string
  created_at: Date
  registration_source: string | null
  withdrawn_at: Date | null
  linked_at: Date | null
  friend_status: string | null
  use_count: number | null
  last_use: Date | string | null
}): MemberProfileView & MemberListRow {
  return {
    id: Number(r.id),
    memberCode: r.member_code,
    familyName: r.family_name,
    givenName: r.given_name,
    phone: r.phone_e164,
    email: r.email_normalized,
    lineLinked: r.linked_at !== null,
    useCount: Number(r.use_count ?? 0),
    lastUseDate: r.last_use ? toLocalDate(r.last_use) : null,
    status: r.status as MemberStatus,
    registeredAt: r.created_at,
    registrationSource: r.registration_source,
    lineLinkedAt: r.linked_at,
    lineFriendStatus: r.friend_status,
    withdrawnAt: r.withdrawn_at,
  }
}
