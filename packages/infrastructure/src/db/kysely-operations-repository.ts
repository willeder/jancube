import type {
  AssignmentContext,
  BookingStatus,
  HoldExpiryRepository,
  LockedAssignmentTx,
  OperationsRepository,
  OpsBooking,
  OpsStore,
} from '@jancube/application'
import { type LocalDate, localToUtc } from '@jancube/domain'
import { sql } from 'kysely'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

const dateValue = (date: LocalDate) => new Date(`${date}T00:00:00Z`)
const HOUR = 3_600_000
/** Room usage is balanced over this many recent days (F-RM-04). */
const USAGE_DAYS = 30

function storeQuery(db: Database) {
  return db
    .selectFrom('stores')
    .select([
      'id',
      'code',
      'name',
      'timezone',
      'cleaning_buffer_minutes',
      'key_before_minutes',
      'key_after_minutes',
      'room_finalize_minutes',
    ])
}

function toStore(
  row: Awaited<ReturnType<ReturnType<typeof storeQuery>['executeTakeFirstOrThrow']>>,
): OpsStore {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    timezone: row.timezone,
    cleaningBufferMinutes: row.cleaning_buffer_minutes,
    keyBeforeMinutes: row.key_before_minutes,
    keyAfterMinutes: row.key_after_minutes,
    roomFinalizeMinutes: row.room_finalize_minutes,
  }
}

function bookingQuery(db: Database) {
  return db
    .selectFrom('bookings as b')
    .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
    .leftJoin('booking_assignments as a', (join) =>
      join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
    )
    .leftJoin('rooms as r', 'r.id', 'a.room_id')
    .select([
      'b.id',
      'b.booking_code',
      'b.status',
      'b.store_id',
      'b.room_group_id',
      'g.name as group_name',
      'b.requested_room_id',
      'b.business_date',
      'b.starts_at',
      'b.ends_at',
      'b.guest_count',
      'b.member_id',
      'b.contact_family_name',
      'b.contact_given_name',
      'a.id as assignment_id',
      'a.room_id',
      'r.code as room_code',
      'r.name as room_name',
      'a.assignment_status',
      'a.source as assignment_source',
      'a.assigned_at',
    ])
}

type BookingRow = Awaited<ReturnType<ReturnType<typeof bookingQuery>['execute']>>[number]

function toBooking(row: BookingRow): OpsBooking {
  const name = [row.contact_family_name, row.contact_given_name].filter(Boolean).join(' ')
  return {
    id: Number(row.id),
    bookingCode: row.booking_code,
    status: row.status as BookingStatus,
    storeId: Number(row.store_id),
    roomGroupId: Number(row.room_group_id),
    roomGroupName: row.group_name,
    requestedRoomId: row.requested_room_id === null ? null : Number(row.requested_room_id),
    businessDate: toLocalDate(row.business_date),
    start: row.starts_at,
    end: row.ends_at,
    guestCount: row.guest_count,
    memberId: row.member_id === null ? null : Number(row.member_id),
    contactName: name || null,
    assignment:
      row.assignment_id === null || row.room_id === null || !row.assigned_at
        ? null
        : {
            id: Number(row.assignment_id),
            roomId: Number(row.room_id),
            roomCode: row.room_code ?? '',
            roomName: row.room_name ?? '',
            status: row.assignment_status === 'final' ? 'final' : 'provisional',
            source: (row.assignment_source ?? 'batch') as 'batch' | 'manual' | 'named',
            assignedAt: row.assigned_at,
          },
  }
}

export class KyselyOperationsRepository implements OperationsRepository, HoldExpiryRepository {
  constructor(private readonly db: Database) {}

  async activeStores() {
    const rows = await storeQuery(this.db).where('is_active', '=', 1).orderBy('code').execute()
    return rows.map(toStore)
  }

  async store(storeId: number) {
    const row = await storeQuery(this.db).where('id', '=', storeId).executeTakeFirst()
    return row ? toStore(row) : null
  }

  async booking(bookingId: number) {
    const row = await bookingQuery(this.db).where('b.id', '=', bookingId).executeTakeFirst()
    return row ? toBooking(row) : null
  }

  async bookingByCode(bookingCode: string) {
    const row = await bookingQuery(this.db)
      .where('b.booking_code', '=', bookingCode)
      .executeTakeFirst()
    return row ? toBooking(row) : null
  }

  async bookingsOn(storeId: number, date: LocalDate, statuses: readonly BookingStatus[]) {
    if (statuses.length === 0) return []
    const rows = await bookingQuery(this.db)
      .where('b.store_id', '=', storeId)
      .where('b.business_date', '=', dateValue(date))
      .where('b.status', 'in', [...statuses])
      .orderBy('b.starts_at')
      .orderBy('b.id')
      .execute()
    return rows.map(toBooking)
  }

  async bookingsWithoutKey(from: Date, to: Date, limit: number) {
    const rows = await this.db
      .selectFrom('bookings as b')
      .select('b.id')
      .where('b.status', '=', 'confirmed')
      .where('b.ends_at', '>', from)
      .where('b.starts_at', '<', to)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('access_keys as k').select('k.id').whereRef('k.booking_id', '=', 'b.id'),
          ),
        ),
      )
      .orderBy('b.starts_at')
      .limit(limit)
      .execute()
    return rows.map((r) => Number(r.id))
  }

  async provisionalAssignments(until: Date) {
    const rows = await this.db
      .selectFrom('booking_assignments as a')
      .innerJoin('bookings as b', 'b.id', 'a.booking_id')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .select(['a.id', 'b.starts_at', 's.room_finalize_minutes'])
      .where('a.released_at', 'is', null)
      .where('a.assignment_status', '=', 'provisional')
      .where('b.status', '=', 'confirmed')
      .where('b.starts_at', '<', until)
      .execute()
    return rows.map((r) => ({
      assignmentId: Number(r.id),
      start: r.starts_at,
      finalizeMinutes: r.room_finalize_minutes,
    }))
  }

  async finalizeAssignments(assignmentIds: readonly number[], at: Date) {
    if (assignmentIds.length === 0) return 0
    const result = await this.db
      .updateTable('booking_assignments')
      .set({ assignment_status: 'final', finalized_at: at })
      .where('id', 'in', [...assignmentIds])
      .where('assignment_status', '=', 'provisional')
      .where('released_at', 'is', null)
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  }

  async cancellation(bookingId: number) {
    const row = await this.db
      .selectFrom('booking_cancellations')
      .select(['fee_amount', 'refund_amount'])
      .where('booking_id', '=', bookingId)
      .executeTakeFirst()
    return row ? { fee: Number(row.fee_amount), refund: Number(row.refund_amount) } : null
  }

  async markUsedRoomsDirty(now: Date) {
    const since = new Date(now.getTime() - 24 * HOUR)
    const result = await this.db
      .updateTable('rooms as r')
      .set({ cleaning_status: 'dirty' })
      .where('r.cleaning_status', '=', 'clean')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('booking_assignments as a')
            .innerJoin('bookings as b', 'b.id', 'a.booking_id')
            .select('a.id')
            .whereRef('a.room_id', '=', 'r.id')
            .where('a.released_at', 'is', null)
            .where('b.status', 'in', ['confirmed', 'completed'])
            .where('b.starts_at', '<=', now)
            .where('b.starts_at', '>', since)
            .where((inner) =>
              inner.or([
                inner('r.last_cleaned_at', 'is', null),
                inner('b.starts_at', '>', inner.ref('r.last_cleaned_at')),
              ]),
            ),
        ),
      )
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  }

  // ---------------------------------------------------------------- expired holds

  async expiredHolds(now: Date, limit: number) {
    const rows = await this.db
      .selectFrom('bookings')
      .select('id')
      .where('status', '=', 'draft')
      .where('hold_expires_at', '<=', now)
      .orderBy('hold_expires_at')
      .limit(limit)
      .execute()
    if (rows.length === 0) return []
    const ids = rows.map((r) => Number(r.id))
    const payments = await this.db
      .selectFrom('payments')
      .select(['booking_id', 'external_checkout_id'])
      .where('booking_id', 'in', ids)
      .where('status', 'in', ['pending', 'processing'])
      .where('external_checkout_id', 'is not', null)
      .execute()
    return ids.map((bookingId) => ({
      bookingId,
      checkoutIds: payments
        .filter((p) => Number(p.booking_id) === bookingId)
        .flatMap((p) => (p.external_checkout_id ? [p.external_checkout_id] : [])),
    }))
  }

  async expireHold(bookingId: number, now: Date) {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('bookings')
        .set({ status: 'expired' })
        .where('id', '=', bookingId)
        .where('status', '=', 'draft')
        .where('hold_expires_at', '<=', now)
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1) return false
      await trx
        .updateTable('payments')
        .set({ status: 'canceled', failure_message: 'hold expired' })
        .where('booking_id', '=', bookingId)
        .where('status', 'in', ['pending', 'processing'])
        .execute()
      await trx
        .updateTable('coupon_redemptions')
        .set({ status: 'released', released_at: now })
        .where('booking_id', '=', bookingId)
        .where('status', '=', 'reserved')
        .execute()
      return true
    })
  }
}

/** Assignment steps; only called inside BookingRepository.withInventoryLock. */
export function lockedAssignments(trx: Database): LockedAssignmentTx {
  return {
    async assignmentContext(roomGroupId, businessDate, now): Promise<AssignmentContext> {
      const group = await trx
        .selectFrom('room_groups as g')
        .innerJoin('stores as s', 's.id', 'g.store_id')
        .select(['s.timezone', 's.cleaning_buffer_minutes'])
        .where('g.id', '=', roomGroupId)
        .executeTakeFirstOrThrow()
      const dayStart = localToUtc(businessDate, 0, group.timezone)
      const from = new Date(dayStart.getTime() - 24 * HOUR)
      const to = new Date(dayStart.getTime() + 48 * HOUR)
      const usageSince = new Date(now.getTime() - USAGE_DAYS * 24 * HOUR)

      const [rooms, usage, blocks, bookings] = await Promise.all([
        trx
          .selectFrom('rooms')
          .select(['id', 'code', 'name', 'sort_order', 'cleaning_status'])
          .where('room_group_id', '=', roomGroupId)
          .where('operating_status', '=', 'active')
          .orderBy('sort_order')
          .execute(),
        trx
          .selectFrom('booking_assignments as a')
          .innerJoin('bookings as b', 'b.id', 'a.booking_id')
          .select([
            'a.room_id',
            sql<number>`SUM(TIMESTAMPDIFF(MINUTE, b.starts_at, b.ends_at))`.as('minutes'),
          ])
          .where('a.room_group_id', '=', roomGroupId)
          .where('a.released_at', 'is', null)
          .where('b.status', 'in', ['confirmed', 'completed'])
          .where('b.starts_at', '>=', usageSince)
          .where('b.starts_at', '<', now)
          .groupBy('a.room_id')
          .execute(),
        trx
          .selectFrom('room_blocks as k')
          .innerJoin('rooms as r', 'r.id', 'k.room_id')
          .select(['k.room_id', 'k.starts_at', 'k.ends_at'])
          .where('r.room_group_id', '=', roomGroupId)
          .where('k.released_at', 'is', null)
          .where('k.starts_at', '<', to)
          .where('k.ends_at', '>', from)
          .execute(),
        trx
          .selectFrom('bookings as b')
          .leftJoin('booking_assignments as a', (join) =>
            join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
          )
          .select([
            'b.id',
            'b.status',
            'b.business_date',
            'b.starts_at',
            'b.ends_at',
            'b.requested_room_id',
            'a.room_id',
          ])
          .where('b.room_group_id', '=', roomGroupId)
          .where('b.starts_at', '<', to)
          .where('b.ends_at', '>', from)
          .where((eb) =>
            eb.or([
              eb('b.status', 'in', ['confirmed', 'completed']),
              eb.and([eb('b.status', '=', 'draft'), eb('b.hold_expires_at', '>', now)]),
            ]),
          )
          .orderBy('b.starts_at')
          .execute(),
      ])
      return {
        bufferMinutes: group.cleaning_buffer_minutes,
        timezone: group.timezone,
        rooms: rooms.map((r) => ({
          roomId: Number(r.id),
          code: r.code,
          name: r.name,
          sortOrder: r.sort_order,
          cleaningStatus: r.cleaning_status === 'clean' ? 'clean' : 'dirty',
          usageMinutes: Number(usage.find((u) => Number(u.room_id) === Number(r.id))?.minutes ?? 0),
          blocks: blocks
            .filter((k) => Number(k.room_id) === Number(r.id))
            .map((k) => ({ start: k.starts_at, end: k.ends_at })),
        })),
        bookings: bookings.map((b) => ({
          bookingId: Number(b.id),
          status: b.status as BookingStatus,
          businessDate: toLocalDate(b.business_date),
          range: { start: b.starts_at, end: b.ends_at },
          requestedRoomId: b.requested_room_id === null ? null : Number(b.requested_room_id),
          assignedRoomId: b.room_id === null ? null : Number(b.room_id),
        })),
      }
    },

    async assignRoom(input) {
      const booking = await trx
        .selectFrom('bookings')
        .select(['store_id', 'room_group_id'])
        .where('id', '=', input.bookingId)
        .executeTakeFirstOrThrow()
      const inserted = await trx
        .insertInto('booking_assignments')
        .values({
          booking_id: input.bookingId,
          store_id: booking.store_id,
          room_group_id: booking.room_group_id,
          room_id: input.roomId,
          assignment_status: input.status,
          assigned_at: input.at,
          finalized_at: input.status === 'final' ? input.at : null,
          source: input.source,
          staff_id: input.staffId,
          reason: input.reason,
        })
        .executeTakeFirstOrThrow()
      return Number(inserted.insertId)
    },

    async releaseAssignment(bookingId, at, reason) {
      await trx
        .updateTable('booking_assignments')
        // Keep the reason the room was assigned with (e.g. a manual change); record ours otherwise.
        .set((eb) => ({
          released_at: at,
          reason: eb.fn.coalesce('reason', eb.val(reason.slice(0, 500))),
        }))
        .where('booking_id', '=', bookingId)
        .where('released_at', 'is', null)
        .execute()
    },
  }
}
