import type {
  CheckoutRecord,
  CheckoutRepository,
  LockedConfirmationTx,
  PaymentMethod,
  PaymentStatus,
  WebhookRepository,
} from '@jancube/application'
import { sql } from 'kysely'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

const PRICING_ALGORITHM_VERSION = 'pricing-v1'

export class KyselyCheckoutRepository implements CheckoutRepository {
  constructor(private readonly db: Database) {}

  async pendingCheckoutIds(bookingId: number) {
    const rows = await this.db
      .selectFrom('payments')
      .select('external_checkout_id')
      .where('booking_id', '=', bookingId)
      .where('status', 'in', ['pending', 'processing'])
      .where('external_checkout_id', 'is not', null)
      .execute()
    return rows.flatMap((r) => (r.external_checkout_id ? [r.external_checkout_id] : []))
  }

  async prepare(input: Parameters<CheckoutRepository['prepare']>[0]) {
    return this.db.transaction().execute(async (trx) => {
      const now = input.agreedAt
      await trx
        .updateTable('coupon_redemptions')
        .set({ status: 'released', released_at: now })
        .where('booking_id', '=', input.bookingId)
        .where('status', '=', 'reserved')
        .execute()
      await trx
        .updateTable('payments')
        .set({ status: 'canceled', failure_message: 'superseded by a new checkout' })
        .where('booking_id', '=', input.bookingId)
        .where('status', 'in', ['pending', 'processing'])
        .execute()

      const latest = await trx
        .selectFrom('price_calculations')
        .selectAll()
        .where('booking_id', '=', input.bookingId)
        .orderBy('revision_no', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirstOrThrow()
      const subtotal =
        Number(latest.base_amount) -
        Number(latest.package_discount_amount) -
        Number(latest.time_discount_amount)
      const discount = input.coupon?.discount ?? 0
      const total = subtotal - discount

      if (input.coupon) {
        const used = await trx
          .selectFrom('coupon_redemptions')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('coupon_grant_id', '=', input.coupon.grantId)
          .where('status', 'in', ['reserved', 'applied'])
          .executeTakeFirstOrThrow()
        await trx
          .insertInto('coupon_redemptions')
          .values({
            coupon_grant_id: input.coupon.grantId,
            booking_id: input.bookingId,
            use_sequence: Number(used.n) + 1,
            discount_amount: discount,
            status: 'reserved',
          })
          .execute()
      }

      const details =
        typeof latest.calculation_details === 'string'
          ? JSON.parse(latest.calculation_details)
          : latest.calculation_details
      const calc = await trx
        .insertInto('price_calculations')
        .values({
          booking_id: input.bookingId,
          price_version_id: latest.price_version_id,
          revision_no: latest.revision_no + 1,
          duration_minutes: latest.duration_minutes,
          base_amount: latest.base_amount,
          package_discount_amount: latest.package_discount_amount,
          time_discount_amount: latest.time_discount_amount,
          coupon_discount_amount: discount,
          total_amount: total,
          tax_rate: latest.tax_rate,
          calculation_details: JSON.stringify({
            ...details,
            coupon: input.coupon ? { grantId: input.coupon.grantId, discount } : null,
          }),
          algorithm_version: PRICING_ALGORITHM_VERSION,
        })
        .executeTakeFirstOrThrow()

      await trx
        .updateTable('bookings')
        .set({
          subtotal_amount: subtotal,
          discount_amount: discount,
          total_amount: total,
          policy_document_id: input.policyDocumentId,
          policy_agreed_at: now,
        })
        .where('id', '=', input.bookingId)
        .execute()

      if (!input.payment || total <= 0) return { paymentId: null, total }
      const payment = await trx
        .insertInto('payments')
        .values({
          booking_id: input.bookingId,
          price_calculation_id: Number(calc.insertId),
          purpose: 'initial',
          provider: input.payment.provider,
          environment: input.payment.environment,
          provider_account_id: input.payment.accountId,
          idempotency_key: input.payment.idempotencyKey,
          method: input.payment.method,
          status: 'pending',
          amount: total,
          currency: 'JPY',
        })
        .executeTakeFirstOrThrow()
      return { paymentId: Number(payment.insertId), total }
    })
  }

  async attachCheckout(paymentId: number, checkoutId: string) {
    await this.db
      .updateTable('payments')
      .set({ external_checkout_id: checkoutId })
      .where('id', '=', paymentId)
      .execute()
  }

  async findByCheckout(checkoutId: string): Promise<CheckoutRecord | null> {
    const row = await this.db
      .selectFrom('payments as p')
      .innerJoin('bookings as b', 'b.id', 'p.booking_id')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .select([
        'p.id',
        'p.status',
        'p.amount',
        'p.method',
        'b.id as booking_id',
        'b.status as booking_status',
        's.code as store_code',
        'b.room_group_id',
        'b.requested_room_id',
        'b.business_date',
        'b.starts_at',
        'b.ends_at',
        'b.hold_expires_at',
      ])
      .where('p.external_checkout_id', '=', checkoutId)
      .executeTakeFirst()
    if (!row) return null
    return {
      paymentId: Number(row.id),
      status: row.status as PaymentStatus,
      amount: Number(row.amount),
      method: row.method as PaymentMethod,
      bookingId: Number(row.booking_id),
      bookingStatus: row.booking_status,
      storeCode: row.store_code,
      roomGroupId: Number(row.room_group_id),
      requestedRoomId: row.requested_room_id === null ? null : Number(row.requested_room_id),
      businessDate: toLocalDate(row.business_date),
      start: row.starts_at,
      end: row.ends_at,
      holdExpiresAt: row.hold_expires_at,
    }
  }

  async cancelPayment(paymentId: number, status: 'failed' | 'canceled', reason: string) {
    await this.db.transaction().execute(async (trx) => {
      const payment = await trx
        .updateTable('payments')
        .set({ status, failure_message: reason })
        .where('id', '=', paymentId)
        .where('status', 'in', ['pending', 'processing'])
        .executeTakeFirst()
      if (Number(payment.numUpdatedRows) === 0) return
      const row = await trx
        .selectFrom('payments')
        .select('booking_id')
        .where('id', '=', paymentId)
        .executeTakeFirstOrThrow()
      await trx
        .updateTable('coupon_redemptions')
        .set({ status: 'released', released_at: new Date() })
        .where('booking_id', '=', row.booking_id)
        .where('status', '=', 'reserved')
        .execute()
    })
  }

  async succeededPayment(bookingId: number) {
    const row = await this.db
      .selectFrom('payments')
      .select(['method', 'amount', 'paid_at'])
      .where('booking_id', '=', bookingId)
      .where('status', '=', 'succeeded')
      .orderBy('paid_at', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!row?.paid_at) return null
    return { method: row.method as PaymentMethod, amount: Number(row.amount), paidAt: row.paid_at }
  }

  async finishRefund(
    refundId: number,
    result: { externalRefundId: string; at: Date } | { error: string },
  ) {
    await this.db
      .updateTable('refunds')
      .set(
        'error' in result
          ? { status: 'failed', failure_message: result.error }
          : {
              status: 'succeeded',
              external_refund_id: result.externalRefundId,
              refunded_at: result.at,
            },
      )
      .where('id', '=', refundId)
      .execute()
  }
}

/** Confirmation steps; only called inside BookingRepository.withInventoryLock. */
export function lockedConfirmation(trx: Database): LockedConfirmationTx {
  return {
    async bookingState(bookingId) {
      const row = await trx
        .selectFrom('bookings')
        .select(['status', 'hold_expires_at'])
        .where('id', '=', bookingId)
        .forUpdate()
        .executeTakeFirstOrThrow()
      return { status: row.status, holdExpiresAt: row.hold_expires_at }
    },

    async confirm({ bookingId, paymentId, externalPaymentId, at }) {
      if (paymentId !== null) {
        await trx
          .updateTable('payments')
          .set({ status: 'succeeded', paid_at: at, external_payment_id: externalPaymentId })
          .where('id', '=', paymentId)
          .execute()
      }
      await trx
        .updateTable('bookings')
        .set({ status: 'confirmed', confirmed_at: at })
        .where('id', '=', bookingId)
        .execute()
      await trx
        .updateTable('coupon_redemptions')
        .set({ status: 'applied', applied_at: at })
        .where('booking_id', '=', bookingId)
        .where('status', '=', 'reserved')
        .execute()
      // Picked up by the jobs worker (confirmation SMS/email, key issuance).
      await trx
        .insertInto('outbox_events')
        .ignore()
        .values({
          event_key: `booking.confirmed:${bookingId}`,
          aggregate_type: 'booking',
          aggregate_id: bookingId,
          event_type: 'booking.confirmed',
          payload: JSON.stringify({ bookingId, paymentId }),
          status: 'pending',
          available_at: at,
        })
        .execute()
    },

    async recordUnconfirmablePayment({ bookingId, paymentId, externalPaymentId, at, reason }) {
      const payment = await trx
        .selectFrom('payments')
        .select('amount')
        .where('id', '=', paymentId)
        .executeTakeFirstOrThrow()
      await trx
        .updateTable('payments')
        .set({ status: 'succeeded', paid_at: at, external_payment_id: externalPaymentId })
        .where('id', '=', paymentId)
        .execute()
      await trx
        .updateTable('coupon_redemptions')
        .set({ status: 'released', released_at: at })
        .where('booking_id', '=', bookingId)
        .where('status', '=', 'reserved')
        .execute()
      const idempotencyKey = `refund:${paymentId}`
      const refund = await trx
        .insertInto('refunds')
        .values({
          payment_id: paymentId,
          booking_id: bookingId,
          idempotency_key: idempotencyKey,
          status: 'requested',
          amount: payment.amount,
          reason,
        })
        .executeTakeFirstOrThrow()
      return { refundId: Number(refund.insertId), idempotencyKey }
    },
  }
}

export class KyselyWebhookRepository implements WebhookRepository {
  constructor(private readonly db: Database) {}

  async record(event: Parameters<WebhookRepository['record']>[0]) {
    const where = (q: ReturnType<typeof this.base>) =>
      q
        .where('provider', '=', event.provider)
        .where('environment', '=', event.environment)
        .where('provider_account_id', '=', event.accountId)
        .where('external_event_id', '=', event.eventId)
    const inserted = await this.db
      .insertInto('webhook_events')
      .ignore()
      .values({
        provider: event.provider,
        environment: event.environment,
        provider_account_id: event.accountId,
        external_event_id: event.eventId,
        event_type: event.eventType,
        payload_sha256: Buffer.from(event.payloadSha256, 'hex'),
        redacted_payload: JSON.stringify(event.redacted),
        signature_valid: 1,
        status: 'received',
        attempt_count: 1,
        received_at: event.receivedAt,
      })
      .executeTakeFirst()
    const duplicate = Number(inserted.numInsertedOrUpdatedRows ?? 0n) === 0
    if (duplicate) {
      await this.db
        .updateTable('webhook_events')
        .set((eb) => ({ attempt_count: eb('attempt_count', '+', 1) }))
        .where((eb) =>
          eb.and([
            eb('provider', '=', event.provider),
            eb('environment', '=', event.environment),
            eb('provider_account_id', '=', event.accountId),
            eb('external_event_id', '=', event.eventId),
          ]),
        )
        .execute()
    }
    const row = await where(this.base()).executeTakeFirstOrThrow()
    return {
      id: Number(row.id),
      duplicate,
      processed: row.status === 'processed' || row.status === 'ignored',
    }
  }

  async finish(id: number, status: 'processed' | 'failed' | 'ignored', error?: string) {
    await this.db
      .updateTable('webhook_events')
      .set({
        status,
        processed_at: status === 'failed' ? null : sql<Date>`UTC_TIMESTAMP(6)`,
        last_error: error ?? null,
      })
      .where('id', '=', id)
      .execute()
  }

  private base() {
    return this.db.selectFrom('webhook_events').select(['id', 'status'])
  }
}
