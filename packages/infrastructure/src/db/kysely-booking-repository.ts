import type {
  BookingContact,
  BookingRepository,
  BookingStatus,
  BookingSummary,
  LockedBookingTx,
  NewDraftBooking,
} from '@jancube/application'
import type { LocalDate } from '@jancube/domain'
import type { Database } from './create-db'
import { KyselyInventoryRepository } from './kysely-inventory-repository'
import { toLocalDate } from './sql-values'

/** Bumped when the pricing algorithm changes, so stored calculations stay explainable. */
const PRICING_ALGORITHM_VERSION = 'pricing-v1'

const dateValue = (date: LocalDate) => new Date(`${date}T00:00:00Z`)

/** MySQL deadlock / lock-wait timeout, and TiDB write conflict: safe to retry the whole transaction. */
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

export class KyselyBookingRepository implements BookingRepository {
  constructor(private readonly db: Database) {}

  async withInventoryLock<T>(
    roomGroupId: number,
    businessDate: LocalDate,
    fn: (tx: LockedBookingTx) => Promise<T>,
  ): Promise<T> {
    // Create the lock row outside the transaction (idempotent). Doing it inside makes concurrent
    // INSERT IGNOREs take shared locks that then deadlock when upgraded by FOR UPDATE.
    await this.db
      .insertInto('inventory_day_locks')
      .ignore()
      .values({ room_group_id: roomGroupId, business_date: dateValue(businessDate) })
      .execute()

    return withDeadlockRetry(() =>
      this.db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('inventory_day_locks')
          .select('id')
          .where('room_group_id', '=', roomGroupId)
          .where('business_date', '=', dateValue(businessDate))
          .forUpdate()
          .execute()

        const inventory = new KyselyInventoryRepository(trx)
        return fn({
          loadInventory: (storeId, from, to, now) => inventory.load(storeId, from, to, now),
          createDraft: (draft) => createDraft(trx, draft),
        })
      }),
    )
  }

  async findByRequestKey(requestKey: string): Promise<BookingSummary | null> {
    const row = await this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .innerJoin('room_types as t', 't.id', 'g.room_type_id')
      .leftJoin('rooms as r', 'r.id', 'b.requested_room_id')
      .select([
        'b.id',
        'b.booking_code',
        'b.status',
        'b.store_id',
        's.code as store_code',
        's.name as store_name',
        's.timezone',
        'b.business_date',
        'g.name as group_name',
        'r.name as room_name',
        't.capacity',
        'b.starts_at',
        'b.ends_at',
        'b.guest_count',
        'b.hold_expires_at',
        'b.member_id',
        'b.subtotal_amount',
        'b.discount_amount',
        'b.total_amount',
      ])
      .select((eb) =>
        eb
          .selectFrom('price_calculations as pc')
          .select('pc.base_amount')
          .whereRef('pc.booking_id', '=', 'b.id')
          .orderBy('pc.revision_no', 'desc')
          .limit(1)
          .as('regular_price'),
      )
      .where('b.client_request_key', '=', requestKey)
      .executeTakeFirst()
    if (!row) return null
    return {
      id: Number(row.id),
      bookingCode: row.booking_code,
      status: row.status as BookingStatus,
      storeId: Number(row.store_id),
      storeCode: row.store_code,
      storeName: row.store_name,
      timezone: row.timezone,
      businessDate: toLocalDate(row.business_date),
      roomGroupName: row.group_name,
      requestedRoomName: row.room_name,
      capacity: row.capacity,
      start: row.starts_at,
      end: row.ends_at,
      guestCount: row.guest_count,
      holdExpiresAt: row.hold_expires_at,
      memberId: row.member_id === null ? null : Number(row.member_id),
      regularPrice: Number(row.regular_price ?? row.subtotal_amount),
      subtotal: Number(row.subtotal_amount),
      discount: Number(row.discount_amount),
      total: Number(row.total_amount),
    }
  }

  async expireDraft(requestKey: string, _now: Date): Promise<void> {
    await this.db
      .updateTable('bookings')
      .set({ status: 'expired' })
      .where('client_request_key', '=', requestKey)
      .where('status', '=', 'draft')
      .execute()
  }

  async setGuestCount(requestKey: string, guestCount: number): Promise<void> {
    await this.db
      .updateTable('bookings')
      .set({ guest_count: guestCount })
      .where('client_request_key', '=', requestKey)
      .where('status', '=', 'draft')
      .execute()
  }

  async assignMember(requestKey: string, contact: BookingContact): Promise<void> {
    await this.db
      .updateTable('bookings')
      .set({
        member_id: contact.memberId,
        contact_family_name: contact.familyName,
        contact_given_name: contact.givenName,
        contact_phone_e164: contact.phone,
        contact_email: contact.email,
      })
      .where('client_request_key', '=', requestKey)
      .where('status', '=', 'draft')
      .execute()
  }
}

async function createDraft(
  trx: Database,
  d: NewDraftBooking,
): Promise<{ id: number; bookingCode: string }> {
  const inserted = await trx
    .insertInto('bookings')
    .values({
      // Temporary unique code; replaced below once the id is known.
      booking_code: `tmp-${d.requestKey}`,
      store_id: d.storeId,
      room_group_id: d.roomGroupId,
      requested_room_id: d.requestedRoomId,
      business_date: dateValue(d.businessDate),
      starts_at: d.start,
      ends_at: d.end,
      guest_count: d.guestCount,
      status: 'draft',
      source: d.source,
      client_request_key: d.requestKey,
      hold_expires_at: d.holdExpiresAt,
      acquisition_source: d.acquisition.source,
      utm_source: d.acquisition.utmSource,
      utm_medium: d.acquisition.utmMedium,
      utm_campaign: d.acquisition.utmCampaign,
      utm_content: d.acquisition.utmContent,
      subtotal_amount: d.quote.price,
      discount_amount: 0,
      total_amount: d.quote.price,
    })
    .executeTakeFirstOrThrow()
  const id = Number(inserted.insertId)

  // Proposed format (tracker #36, pending review): JC-{YYYY}-{6-digit sequence}.
  const bookingCode = `JC-${d.businessDate.slice(0, 4)}-${String(id).padStart(6, '0')}`
  await trx
    .updateTable('bookings')
    .set({ booking_code: bookingCode })
    .where('id', '=', id)
    .execute()

  await trx
    .insertInto('price_calculations')
    .values({
      booking_id: id,
      price_version_id: d.priceVersionId,
      revision_no: 1,
      duration_minutes: d.quote.bookedMinutes,
      base_amount: d.quote.regularPrice,
      package_discount_amount: d.quote.regularPrice - d.quote.price,
      time_discount_amount: 0,
      coupon_discount_amount: 0,
      total_amount: d.quote.price,
      tax_rate: d.taxRatePercent,
      calculation_details: JSON.stringify({ lines: d.quote.lines }),
      algorithm_version: PRICING_ALGORITHM_VERSION,
    })
    .execute()

  return { id, bookingCode }
}
