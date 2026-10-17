import type {
  BookingNotificationQuery,
  BookingNotificationView,
  DueDelivery,
  MemberContact,
  NotificationRepository,
  PublishedTemplate,
} from '@jancube/application'
import type { NotificationChannel, NotificationEvent } from '@jancube/domain'
import { sql } from 'kysely'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

const SENDING_LEASE_MINUTES = 10

export class KyselyNotificationRepository
  implements NotificationRepository, BookingNotificationQuery
{
  constructor(private readonly db: Database) {}

  async templates(event: NotificationEvent, storeId: number | null): Promise<PublishedTemplate[]> {
    const rows = await this.db
      .selectFrom('notification_templates as t')
      .innerJoin('notification_template_versions as v', 'v.template_id', 't.id')
      .select([
        't.id as template_id',
        't.channel',
        't.channel_priority',
        't.store_id',
        'v.id as version_id',
        'v.subject',
        'v.body',
      ])
      .where('t.event_type', '=', event)
      .where('t.is_enabled', '=', 1)
      .where('t.scope_store_key', 'in', storeId ? [0, storeId] : [0])
      .where((eb) =>
        eb(
          'v.version_no',
          '=',
          eb
            .selectFrom('notification_template_versions as latest')
            .select((e) => e.fn.max('latest.version_no').as('v'))
            .whereRef('latest.template_id', '=', 't.id'),
        ),
      )
      .execute()
    // A store-specific template replaces the all-store template of the same channel.
    const byChannel = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      const current = byChannel.get(row.channel)
      if (!current || (current.store_id === null && row.store_id !== null)) {
        byChannel.set(row.channel, row)
      }
    }
    return [...byChannel.values()]
      .sort((a, b) => a.channel_priority - b.channel_priority)
      .map((row) => ({
        templateId: Number(row.template_id),
        versionId: Number(row.version_id),
        channel: row.channel as NotificationChannel,
        priority: row.channel_priority,
        subject: row.subject,
        body: row.body,
      }))
  }

  async memberContact(memberId: number): Promise<MemberContact | null> {
    const row = await this.db
      .selectFrom('members as m')
      .leftJoin('member_line_links as l', 'l.member_id', 'm.id')
      .select([
        'm.id',
        'm.email_normalized',
        'm.notification_channel',
        'm.phone_e164',
        'm.status',
        'l.line_user_id',
        'l.friend_status',
      ])
      .where('m.id', '=', memberId)
      .executeTakeFirst()
    if (!row || row.status === 'withdrawn') return null
    return {
      memberId: Number(row.id),
      email: row.email_normalized,
      notificationChannel: row.notification_channel === 'line' ? 'line' : 'email',
      phone: row.phone_e164,
      lineUserId: row.line_user_id && row.friend_status !== 'blocked' ? row.line_user_id : null,
    }
  }

  async enqueue(d: Parameters<NotificationRepository['enqueue']>[0]) {
    await this.db
      .insertInto('notification_deliveries')
      .ignore()
      .values({
        deduplication_key: d.deduplicationKey,
        member_id: d.memberId,
        booking_id: d.bookingId,
        coupon_grant_id: d.couponGrantId,
        payment_link_id: d.paymentLinkId,
        template_version_id: d.templateVersionId,
        channel: d.channel,
        destination_ciphertext: Buffer.from(d.destinationCiphertext),
        message_ciphertext: Buffer.from(d.messageCiphertext),
        context_redacted: JSON.stringify(d.contextRedacted),
        status: 'queued',
        scheduled_at: d.scheduledAt,
      })
      .execute()
  }

  async claimDue(now: Date, limit: number): Promise<DueDelivery[]> {
    const stale = new Date(now.getTime() - SENDING_LEASE_MINUTES * 60_000)
    const due = sql<boolean>`((d.status = 'queued' AND COALESCE(d.next_retry_at, d.scheduled_at) <= ${now})
      OR (d.status = 'sending' AND d.updated_at < ${stale}))`
    const candidates = await this.db
      .selectFrom('notification_deliveries as d')
      .select('d.id')
      .where(due)
      .orderBy('d.scheduled_at')
      .limit(limit)
      .execute()
    const claimed: DueDelivery[] = []
    for (const { id } of candidates) {
      const result = await this.db
        .updateTable('notification_deliveries as d')
        .set({ status: 'sending' })
        .where('d.id', '=', id)
        .where(due)
        .executeTakeFirst()
      if (Number(result.numUpdatedRows) !== 1) continue
      const row = await this.db
        .selectFrom('notification_deliveries as d')
        .leftJoin('bookings as b', 'b.id', 'd.booking_id')
        .select([
          'd.id',
          'd.channel',
          'd.destination_ciphertext',
          'd.message_ciphertext',
          'd.attempt_count',
          'd.booking_id',
          'b.store_id',
        ])
        .where('d.id', '=', id)
        .executeTakeFirstOrThrow()
      if (!row.message_ciphertext) continue
      claimed.push({
        id: Number(row.id),
        channel: row.channel as NotificationChannel,
        destinationCiphertext: new Uint8Array(row.destination_ciphertext),
        messageCiphertext: new Uint8Array(row.message_ciphertext),
        attemptCount: row.attempt_count,
        bookingId: row.booking_id === null ? null : Number(row.booking_id),
        storeId: row.store_id === null ? null : Number(row.store_id),
      })
    }
    return claimed
  }

  async recordAttempt(
    deliveryId: number,
    attempt: Parameters<NotificationRepository['recordAttempt']>[1],
    next: Parameters<NotificationRepository['recordAttempt']>[2],
  ) {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('notification_attempts')
        .values({
          delivery_id: deliveryId,
          attempt_no: attempt.attemptNo,
          result: attempt.result,
          provider_message_id: attempt.providerMessageId ?? null,
          error_message: attempt.error ?? null,
          attempted_at: attempt.at,
        })
        .execute()
      await trx
        .updateTable('notification_deliveries')
        .set({
          status: next.status,
          attempt_count: attempt.attemptNo,
          sent_at: next.status === 'sent' ? attempt.at : null,
          next_retry_at: next.status === 'queued' ? next.retryAt : null,
        })
        .where('id', '=', deliveryId)
        .execute()
    })
  }

  async bookingView(bookingId: number): Promise<BookingNotificationView | null> {
    const row = await this.db
      .selectFrom('bookings as b')
      .innerJoin('stores as s', 's.id', 'b.store_id')
      .innerJoin('room_groups as g', 'g.id', 'b.room_group_id')
      .innerJoin('room_types as t', 't.id', 'g.room_type_id')
      .leftJoin('booking_assignments as a', (join) =>
        join.onRef('a.booking_id', '=', 'b.id').on('a.released_at', 'is', null),
      )
      .leftJoin('rooms as ar', 'ar.id', 'a.room_id')
      .leftJoin('rooms as rr', 'rr.id', 'b.requested_room_id')
      .select([
        'b.id',
        'b.booking_code',
        'b.member_id',
        'b.store_id',
        's.name as store_name',
        's.address',
        's.timezone',
        'b.business_date',
        'b.starts_at',
        'b.ends_at',
        't.name as type_name',
        'ar.name as assigned_room',
        'rr.name as requested_room',
        'b.guest_count',
        'b.total_amount',
        'b.contact_family_name',
        'b.contact_given_name',
        's.entry_guide_text',
        'ar.location_text as assigned_location',
        'rr.location_text as requested_location',
      ])
      .select((eb) =>
        eb
          .selectFrom('room_photos as p')
          .select('p.asset_url')
          .where('p.room_id', '=', eb.fn.coalesce('ar.id', 'rr.id'))
          .orderBy('p.sort_order')
          .limit(1)
          .as('room_photo'),
      )
      .where('b.id', '=', bookingId)
      .executeTakeFirst()
    if (!row) return null
    return {
      bookingId: Number(row.id),
      bookingCode: row.booking_code,
      memberId: row.member_id === null ? null : Number(row.member_id),
      storeId: Number(row.store_id),
      storeName: row.store_name,
      storeAddress: row.address,
      timezone: row.timezone,
      businessDate: toLocalDate(row.business_date),
      start: row.starts_at,
      end: row.ends_at,
      roomTypeName: row.type_name,
      roomName: row.assigned_room ?? row.requested_room,
      customerName: [row.contact_family_name, row.contact_given_name].filter(Boolean).join(' '),
      entryGuideText: row.entry_guide_text,
      roomLocation: row.assigned_location ?? row.requested_location,
      roomPhotoUrl: row.room_photo,
      guestCount: row.guest_count,
      total: Number(row.total_amount),
    }
  }
}
