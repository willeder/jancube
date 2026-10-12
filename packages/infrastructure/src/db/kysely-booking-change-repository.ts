import type { BookingChangeRepository, ChangeTarget, LockedChangeTx } from '@jancube/application'
import { DomainError, type LocalDate } from '@jancube/domain'
import type { Database } from './create-db'
import { KyselyInventoryRepository } from './kysely-inventory-repository'
import { toLocalDate } from './sql-values'

const PRICING_ALGORITHM_VERSION = 'pricing-v1'

const dateValue = (date: LocalDate) => new Date(`${date}T00:00:00Z`)

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_TXN_WRITE_CONFLICT'])

async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run()
    } catch (error) {
      const code = (error as { code?: string }).code
      if (!code || !RETRYABLE.has(code) || i >= attempts) throw error
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30))
    }
  }
}

/** C-14 予約変更: moving a confirmed booking under the inventory locks (design rule 在庫排他). */
export class KyselyBookingChangeRepository implements BookingChangeRepository {
  constructor(private readonly db: Database) {}

  async changeTarget(bookingCode: string): Promise<ChangeTarget | null> {
    const row = await this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .leftJoin('booking_assignments as a', (join) =>
        join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
      )
      .select([
        'b.id',
        'b.booking_code',
        'b.status',
        'b.member_id',
        'b.store_id',
        's.code as store_code',
        's.timezone',
        'b.room_group_id',
        'g.room_type_id',
        'b.requested_room_id',
        'a.room_id as assigned_room_id',
        'b.business_date',
        'b.starts_at',
        'b.ends_at',
        'b.guest_count',
        'b.subtotal_amount',
        'b.discount_amount',
        'b.total_amount',
        'b.lock_version',
      ])
      .select((eb) =>
        eb
          .selectFrom('coupon_redemptions as r')
          .select('r.coupon_grant_id')
          .whereRef('r.booking_id', '=', 'b.id')
          .where('r.status', 'in', ['reserved', 'applied'])
          .limit(1)
          .as('coupon_grant_id'),
      )
      .where('b.booking_code', '=', bookingCode)
      .executeTakeFirst()
    if (!row) return null
    return {
      id: Number(row.id),
      bookingCode: row.booking_code,
      status: row.status,
      memberId: row.member_id === null ? null : Number(row.member_id),
      storeId: Number(row.store_id),
      storeCode: row.store_code,
      timezone: row.timezone,
      roomGroupId: Number(row.room_group_id),
      roomTypeId: Number(row.room_type_id),
      requestedRoomId: row.requested_room_id === null ? null : Number(row.requested_room_id),
      assignedRoomId: row.assigned_room_id === null ? null : Number(row.assigned_room_id),
      businessDate: toLocalDate(row.business_date),
      start: row.starts_at,
      end: row.ends_at,
      guestCount: row.guest_count,
      subtotal: Number(row.subtotal_amount),
      discount: Number(row.discount_amount),
      total: Number(row.total_amount),
      couponGrantId: row.coupon_grant_id === null ? null : Number(row.coupon_grant_id),
      lockVersion: row.lock_version,
    }
  }

  async withInventoryLocks<T>(
    locks: readonly { roomGroupId: number; businessDate: LocalDate }[],
    fn: (tx: LockedChangeTx) => Promise<T>,
  ): Promise<T> {
    // Same order everywhere (group, then date) so concurrent changes cannot deadlock each other.
    const keys = [
      ...new Map(locks.map((l) => [`${l.roomGroupId}:${l.businessDate}`, l])).values(),
    ].sort((a, b) => a.roomGroupId - b.roomGroupId || a.businessDate.localeCompare(b.businessDate))
    // Lock rows are created outside the transaction (see KyselyBookingRepository.withInventoryLock).
    for (const key of keys) {
      await this.db
        .insertInto('inventory_day_locks')
        .ignore()
        .values({ room_group_id: key.roomGroupId, business_date: dateValue(key.businessDate) })
        .execute()
    }
    return withDeadlockRetry(() =>
      this.db.transaction().execute(async (trx) => {
        for (const key of keys) {
          await trx
            .selectFrom('inventory_day_locks')
            .select('id')
            .where('room_group_id', '=', key.roomGroupId)
            .where('business_date', '=', dateValue(key.businessDate))
            .forUpdate()
            .execute()
        }
        const inventory = new KyselyInventoryRepository(trx)
        return fn({
          loadInventory: (storeId, from, to, now) => inventory.load(storeId, from, to, now),
          applyChange: (input) => applyChange(trx, input),
        })
      }),
    )
  }
}

async function applyChange(
  trx: Database,
  input: Parameters<LockedChangeTx['applyChange']>[0],
): Promise<{ historyId: number; duplicate: boolean }> {
  const existing = await trx
    .selectFrom('booking_change_history')
    .select('id')
    .where('request_key', '=', input.requestKey)
    .executeTakeFirst()
  if (existing) return { historyId: Number(existing.id), duplicate: true }

  const subtotal = input.quote.price
  const total = subtotal - input.discount
  const updated = await trx
    .updateTable('bookings')
    .set((eb) => ({
      room_group_id: input.roomGroupId,
      requested_room_id: input.requestedRoomId,
      business_date: dateValue(input.businessDate),
      starts_at: input.start,
      ends_at: input.end,
      subtotal_amount: subtotal,
      discount_amount: input.discount,
      total_amount: total,
      lock_version: eb('lock_version', '+', 1),
    }))
    .where('id', '=', input.bookingId)
    .where('status', '=', 'confirmed')
    .where('lock_version', '=', input.expectedLockVersion)
    .executeTakeFirst()
  if (Number(updated.numUpdatedRows) !== 1) {
    throw new DomainError('booking_not_changeable', 'the booking was changed by someone else')
  }

  const latest = await trx
    .selectFrom('price_calculations')
    .select(['revision_no', 'calculation_details'])
    .where('booking_id', '=', input.bookingId)
    .orderBy('revision_no', 'desc')
    .limit(1)
    .executeTakeFirst()
  const previous =
    typeof latest?.calculation_details === 'string'
      ? JSON.parse(latest.calculation_details)
      : (latest?.calculation_details ?? {})
  await trx
    .insertInto('price_calculations')
    .values({
      booking_id: input.bookingId,
      price_version_id: input.priceVersionId,
      revision_no: (latest?.revision_no ?? 0) + 1,
      duration_minutes: input.quote.bookedMinutes,
      base_amount: input.quote.regularPrice,
      package_discount_amount: input.quote.regularPrice - input.quote.price,
      time_discount_amount: 0,
      coupon_discount_amount: input.discount,
      total_amount: total,
      tax_rate: input.taxRatePercent,
      calculation_details: JSON.stringify({
        lines: input.quote.lines,
        coupon: (previous as { coupon?: unknown }).coupon ?? null,
        change: { requestKey: input.requestKey },
      }),
      algorithm_version: PRICING_ALGORITHM_VERSION,
    })
    .execute()

  if (input.discount !== input.before.discount) {
    await trx
      .updateTable('coupon_redemptions')
      .set({ discount_amount: input.discount })
      .where('booking_id', '=', input.bookingId)
      .where('status', 'in', ['reserved', 'applied'])
      .execute()
  }
  // The room is assigned again for the new time (batch / A-03); keys follow booking.changed.
  await trx
    .updateTable('booking_assignments')
    .set({ released_at: input.changedAt, reason: 'booking changed' })
    .where('booking_id', '=', input.bookingId)
    .where('released_at', 'is', null)
    .execute()

  const history = await trx
    .insertInto('booking_change_history')
    .values({
      booking_id: input.bookingId,
      actor_type: 'member',
      member_id: input.memberId,
      policy_document_id: input.policyDocumentId,
      policy_checked_at: input.policyCheckedAt,
      changed_at: input.changedAt,
      before_values: JSON.stringify(input.before),
      after_values: JSON.stringify(input.after),
      request_key: input.requestKey,
    })
    .executeTakeFirstOrThrow()
  const historyId = Number(history.insertId)

  await trx
    .insertInto('outbox_events')
    .ignore()
    .values({
      event_key: `booking.changed:${input.bookingId}:${historyId}`,
      aggregate_type: 'booking',
      aggregate_id: input.bookingId,
      event_type: 'booking.changed',
      payload: JSON.stringify({ bookingId: input.bookingId }),
      status: 'pending',
      available_at: input.changedAt,
    })
    .execute()
  return { historyId, duplicate: false }
}
