import {
  type AcquisitionRow,
  type BookingFunnelCount,
  type BookingLine,
  type CleaningRow,
  type CouponGrantStat,
  type CouponRedemptionRow,
  type FunnelEventRepository,
  type FunnelStep,
  type MoneyLine,
  REPORT_TIME_ZONE,
  type ReportExportRecord,
  type ReportExportRepository,
  type ReportQueries,
  type ReportScope,
} from '@jancube/application'
import { addDays, localToUtc } from '@jancube/domain'
import { type RawBuilder, sql } from 'kysely'
import type { Database } from './create-db'
import { toLocalDate } from './sql-values'

/**
 * Local calendar date of a UTC DATETIME in the report time zone. Asia/Tokyo has no daylight saving,
 * so a fixed offset is exact and needs no time zone tables (MySQL and TiDB alike).
 */
const jstDate = (column: string) => sql`DATE(DATE_ADD(${sql.ref(column)}, INTERVAL 9 HOUR))`

/** [start, end) instants covering the scope's local dates. */
function instants(scope: ReportScope) {
  return {
    start: localToUtc(scope.from, 0, REPORT_TIME_ZONE),
    end: localToUtc(addDays(scope.to, 1), 0, REPORT_TIME_ZONE),
  }
}

const inStores = (column: string, storeIds: readonly number[] | null): RawBuilder<unknown> =>
  storeIds ? sql`AND ${sql.ref(column)} IN (${sql.join([...storeIds])})` : sql``

const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value))
const bool = (value: unknown): boolean => Number(value) === 1
const dateValue = (value: unknown) => toLocalDate(value as Date | string)

const PAGE = 500
const LIVE_BOOKING = sql`('confirmed','completed')`

/** A-27 read model: aggregation queries over bookings, payments, coupons, cleaning and funnel events. */
export class KyselyReportQueries implements ReportQueries {
  constructor(private readonly db: Database) {}

  private async rows<T>(query: RawBuilder<T>): Promise<T[]> {
    return (await query.execute(this.db)).rows
  }

  async stores(storeIds: readonly number[] | null) {
    if (storeIds?.length === 0) return []
    let q = this.db.selectFrom('stores').select(['id', 'code', 'name', 'timezone']).orderBy('code')
    if (storeIds) q = q.where('id', 'in', [...storeIds])
    return (await q.execute()).map((r) => ({ ...r, id: Number(r.id) }))
  }

  async roomCounts(storeIds: readonly number[] | null) {
    const rows = await this.rows<{ store_id: number; room_type: string; rooms: number }>(sql`
      SELECT r.store_id, rt.name AS room_type, COUNT(*) AS rooms
      FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
      WHERE r.operating_status = 'active' ${inStores('r.store_id', storeIds)}
      GROUP BY r.store_id, rt.name`)
    return rows.map((r) => ({
      storeId: num(r.store_id),
      roomTypeName: r.room_type,
      rooms: num(r.rooms),
    }))
  }

  async bookedMinutes(scope: ReportScope) {
    const rows = await this.rows<{
      store_id: number
      business_date: Date
      room_type: string
      minutes: string
      bookings: number
    }>(sql`
      SELECT b.store_id, b.business_date, rt.name AS room_type,
             SUM(TIMESTAMPDIFF(MINUTE, b.starts_at, b.ends_at)) AS minutes, COUNT(*) AS bookings
      FROM bookings b
      JOIN room_groups g ON g.id = b.room_group_id
      JOIN room_types rt ON rt.id = g.room_type_id
      WHERE b.status IN ${LIVE_BOOKING}
        AND b.business_date BETWEEN ${scope.from} AND ${scope.to}
        ${inStores('b.store_id', scope.storeIds)}
      GROUP BY b.store_id, b.business_date, rt.name`)
    return rows.map((r) => ({
      storeId: num(r.store_id),
      businessDate: dateValue(r.business_date),
      roomTypeName: r.room_type,
      minutes: num(r.minutes),
      bookings: num(r.bookings),
    }))
  }

  async dailySales(scope: ReportScope) {
    const { start, end } = instants(scope)
    const [paid, refunded] = await Promise.all([
      this.rows<{ store_id: number; day: Date; n: number; amount: string }>(sql`
        SELECT b.store_id, ${jstDate('p.paid_at')} AS day, COUNT(*) AS n, SUM(p.amount) AS amount
        FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE p.status = 'succeeded' AND p.paid_at >= ${start} AND p.paid_at < ${end}
          ${inStores('b.store_id', scope.storeIds)}
        GROUP BY b.store_id, day`),
      this.rows<{ store_id: number; day: Date; amount: string }>(sql`
        SELECT b.store_id, ${jstDate('r.refunded_at')} AS day, SUM(r.amount) AS amount
        FROM refunds r JOIN bookings b ON b.id = r.booking_id
        WHERE r.status = 'succeeded' AND r.refunded_at >= ${start} AND r.refunded_at < ${end}
          ${inStores('b.store_id', scope.storeIds)}
        GROUP BY b.store_id, day`),
    ])
    const byKey = new Map<
      string,
      { storeId: number; date: string; payments: number; paid: number; refunded: number }
    >()
    const entry = (storeId: number, date: string) => {
      const key = `${storeId}:${date}`
      const row = byKey.get(key) ?? { storeId, date, payments: 0, paid: 0, refunded: 0 }
      byKey.set(key, row)
      return row
    }
    for (const r of paid) {
      const row = entry(num(r.store_id), dateValue(r.day))
      row.payments += num(r.n)
      row.paid += num(r.amount)
    }
    for (const r of refunded) entry(num(r.store_id), dateValue(r.day)).refunded += num(r.amount)
    return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.storeId - b.storeId)
  }

  async acquisitionRows(scope: ReportScope): Promise<AcquisitionRow[]> {
    const rows = await this.rows<{
      store_id: number
      source: string
      acquisition_source: string | null
      utm_source: string | null
      utm_medium: string | null
      utm_campaign: string | null
      total_amount: number
      is_first: number
      has_next: number
    }>(sql`
      SELECT b.store_id, b.source, b.acquisition_source, b.utm_source, b.utm_medium,
             b.utm_campaign, b.total_amount,
             NOT EXISTS (SELECT 1 FROM bookings p WHERE p.member_id = b.member_id
               AND p.status IN ${LIVE_BOOKING}
               AND (p.confirmed_at < b.confirmed_at OR (p.confirmed_at = b.confirmed_at AND p.id < b.id))
             ) AS is_first,
             EXISTS (SELECT 1 FROM bookings n WHERE n.member_id = b.member_id
               AND n.status IN ${LIVE_BOOKING}
               AND (n.confirmed_at > b.confirmed_at OR (n.confirmed_at = b.confirmed_at AND n.id > b.id))
             ) AS has_next
      FROM bookings b
      WHERE b.status IN ${LIVE_BOOKING}
        AND b.business_date BETWEEN ${scope.from} AND ${scope.to}
        ${inStores('b.store_id', scope.storeIds)}`)
    return rows.map((r) => ({
      storeId: num(r.store_id),
      channel: r.source,
      acquisitionSource: r.acquisition_source,
      utmSource: r.utm_source,
      utmMedium: r.utm_medium,
      utmCampaign: r.utm_campaign,
      total: num(r.total_amount),
      isFirst: bool(r.is_first),
      hasNext: bool(r.has_next),
    }))
  }

  async couponGrantStats(scope: ReportScope): Promise<CouponGrantStat[]> {
    const { start, end } = instants(scope)
    const rows = await this.rows<{
      coupon_id: number
      code: string
      name: string
      issued: number
      used: string
    }>(sql`
      SELECT c.id AS coupon_id, c.code, c.name, COUNT(*) AS issued,
             SUM(EXISTS (SELECT 1 FROM coupon_redemptions r
                         WHERE r.coupon_grant_id = gr.id AND r.status = 'applied')) AS used
      FROM coupon_grants gr
      JOIN coupon_versions v ON v.id = gr.coupon_version_id
      JOIN coupons c ON c.id = v.coupon_id
      WHERE gr.granted_at >= ${start} AND gr.granted_at < ${end}
      GROUP BY c.id, c.code, c.name`)
    return rows.map((r) => ({
      couponId: num(r.coupon_id),
      code: r.code,
      name: r.name,
      issued: num(r.issued),
      used: num(r.used),
    }))
  }

  async couponRedemptions(scope: ReportScope): Promise<CouponRedemptionRow[]> {
    const { start, end } = instants(scope)
    const rows = await this.rows<{
      coupon_id: number
      code: string
      name: string
      applied_at: Date
      status: string
      booking_code: string
      store_id: number
      store_code: string
      business_date: Date
      member_code: string | null
      use_sequence: number
      discount_amount: number
      total_amount: number
      booked_again: number
    }>(sql`
      SELECT c.id AS coupon_id, c.code, c.name, r.applied_at, r.status, b.booking_code,
             b.store_id, s.code AS store_code, b.business_date, m.member_code, r.use_sequence,
             r.discount_amount, b.total_amount,
             EXISTS (SELECT 1 FROM bookings n WHERE n.member_id = b.member_id AND n.id <> b.id
                       AND n.status IN ${LIVE_BOOKING} AND n.confirmed_at > b.confirmed_at
             ) AS booked_again
      FROM coupon_redemptions r
      JOIN coupon_grants gr ON gr.id = r.coupon_grant_id
      JOIN coupon_versions v ON v.id = gr.coupon_version_id
      JOIN coupons c ON c.id = v.coupon_id
      JOIN bookings b ON b.id = r.booking_id
      JOIN stores s ON s.id = b.store_id
      LEFT JOIN members m ON m.id = b.member_id
      WHERE r.status IN ('applied','reversed') AND r.applied_at >= ${start} AND r.applied_at < ${end}
        ${inStores('b.store_id', scope.storeIds)}
      ORDER BY r.applied_at, r.id`)
    return rows.map((r) => ({
      couponId: num(r.coupon_id),
      couponCode: r.code,
      couponName: r.name,
      appliedAt: r.applied_at,
      status: r.status === 'reversed' ? 'reversed' : 'applied',
      bookingCode: r.booking_code,
      storeId: num(r.store_id),
      storeCode: r.store_code,
      businessDate: dateValue(r.business_date),
      memberCode: r.member_code,
      useSequence: num(r.use_sequence),
      discount: num(r.discount_amount),
      bookingTotal: num(r.total_amount),
      memberBookedAgain: bool(r.booked_again),
    }))
  }

  async cleaningRows(scope: ReportScope): Promise<CleaningRow[]> {
    const { start, end } = instants(scope)
    const rows = await this.rows<{
      store_id: number
      store_code: string
      store_name: string
      room_name: string
      task_type: string
      staff_name: string
      started_at: Date | null
      completed_at: Date
      due_at: Date
      was_overdue: number
      notes: string | null
    }>(sql`
      SELECT s.id AS store_id, s.code AS store_code, s.name AS store_name, rm.name AS room_name,
             t.task_type, st.name AS staff_name, l.started_at, l.completed_at, t.due_at,
             l.was_overdue, l.notes
      FROM cleaning_logs l
      JOIN cleaning_tasks t ON t.id = l.task_id
      JOIN rooms rm ON rm.id = t.room_id
      JOIN stores s ON s.id = rm.store_id
      JOIN staff st ON st.id = l.staff_id
      WHERE l.completed_at >= ${start} AND l.completed_at < ${end}
        ${inStores('rm.store_id', scope.storeIds)}
      ORDER BY l.completed_at, l.id`)
    return rows.map((r) => ({
      storeId: num(r.store_id),
      storeCode: r.store_code,
      storeName: r.store_name,
      roomName: r.room_name,
      taskType: r.task_type === 'spot' ? 'spot' : 'opening',
      staffName: r.staff_name,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      dueAt: r.due_at,
      wasOverdue: bool(r.was_overdue),
      notes: r.notes,
    }))
  }

  async funnelSteps(scope: ReportScope) {
    const { start, end } = instants(scope)
    // LIFF openings are not tied to a store, so they are counted for every scope.
    const stores = scope.storeIds
      ? sql`AND (f.store_id IN (${sql.join([...scope.storeIds])}) OR f.step = 'liff_opened')`
      : sql``
    const rows = await this.rows<{ store_id: number | null; step: string; visitors: number }>(sql`
      SELECT f.store_id, f.step, COUNT(DISTINCT f.visitor_key) AS visitors
      FROM funnel_events f
      WHERE f.occurred_at >= ${start} AND f.occurred_at < ${end} ${stores}
      GROUP BY f.store_id, f.step`)
    return rows.map((r) => ({
      storeId: r.store_id === null ? null : num(r.store_id),
      step: r.step as FunnelStep,
      visitors: num(r.visitors),
    }))
  }

  async bookingFunnel(scope: ReportScope): Promise<BookingFunnelCount[]> {
    const { start, end } = instants(scope)
    const rows = await this.rows<{
      store_id: number
      holds: number
      signed_in: string
      checkout: string
      confirmed: string
    }>(sql`
      SELECT b.store_id, COUNT(*) AS holds,
             SUM(b.member_id IS NOT NULL) AS signed_in,
             SUM(EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)) AS checkout,
             SUM(b.confirmed_at IS NOT NULL) AS confirmed
      FROM bookings b
      WHERE b.source IN ('web','liff') AND b.created_at >= ${start} AND b.created_at < ${end}
        ${inStores('b.store_id', scope.storeIds)}
      GROUP BY b.store_id`)
    return rows.map((r) => ({
      storeId: num(r.store_id),
      holds: num(r.holds),
      signedIn: num(r.signed_in),
      checkoutStarted: num(r.checkout),
      confirmed: num(r.confirmed),
    }))
  }

  async *bookingLines(scope: ReportScope): AsyncIterable<BookingLine> {
    let afterId = 0
    for (;;) {
      const rows = await this.rows<{
        id: number
        booking_code: string
        store_code: string
        store_name: string
        business_date: Date
        starts_at: Date
        ends_at: Date
        room_type: string
        room_name: string | null
        member_code: string | null
        status: string
        source: string
        acquisition_source: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        utm_content: string | null
        guest_count: number
        subtotal_amount: number
        discount_amount: number
        total_amount: number
        coupon_codes: string | null
        paid: string | null
        refunded: string | null
        fee_amount: number | null
        confirmed_at: Date | null
        canceled_at: Date | null
        created_at: Date
      }>(sql`
        SELECT b.id, b.booking_code, s.code AS store_code, s.name AS store_name, b.business_date,
               b.starts_at, b.ends_at, rt.name AS room_type,
               COALESCE(
                 (SELECT r.name FROM booking_assignments a JOIN rooms r ON r.id = a.room_id
                   WHERE a.booking_id = b.id AND a.released_at IS NULL LIMIT 1),
                 (SELECT r.name FROM rooms r WHERE r.id = b.requested_room_id)
               ) AS room_name,
               m.member_code, b.status, b.source, b.acquisition_source, b.utm_source,
               b.utm_medium, b.utm_campaign, b.utm_content, b.guest_count, b.subtotal_amount,
               b.discount_amount, b.total_amount,
               (SELECT GROUP_CONCAT(c.code ORDER BY c.code SEPARATOR ' ')
                  FROM coupon_redemptions cr
                  JOIN coupon_grants gr ON gr.id = cr.coupon_grant_id
                  JOIN coupon_versions v ON v.id = gr.coupon_version_id
                  JOIN coupons c ON c.id = v.coupon_id
                 WHERE cr.booking_id = b.id AND cr.status IN ('applied','reversed')) AS coupon_codes,
               (SELECT SUM(p.amount) FROM payments p
                 WHERE p.booking_id = b.id AND p.status = 'succeeded') AS paid,
               (SELECT SUM(rf.amount) FROM refunds rf
                 WHERE rf.booking_id = b.id AND rf.status = 'succeeded') AS refunded,
               bc.fee_amount, b.confirmed_at, bc.requested_at AS canceled_at, b.created_at
        FROM bookings b
        JOIN stores s ON s.id = b.store_id
        JOIN room_groups g ON g.id = b.room_group_id
        JOIN room_types rt ON rt.id = g.room_type_id
        LEFT JOIN members m ON m.id = b.member_id
        LEFT JOIN booking_cancellations bc ON bc.booking_id = b.id
        WHERE b.business_date BETWEEN ${scope.from} AND ${scope.to}
          AND (b.status IN ${LIVE_BOOKING} OR (b.status = 'canceled' AND b.confirmed_at IS NOT NULL))
          AND b.id > ${afterId}
          ${inStores('b.store_id', scope.storeIds)}
        ORDER BY b.id
        LIMIT ${PAGE}`)
      for (const r of rows) {
        yield {
          bookingCode: r.booking_code,
          storeCode: r.store_code,
          storeName: r.store_name,
          businessDate: dateValue(r.business_date),
          start: r.starts_at,
          end: r.ends_at,
          roomTypeName: r.room_type,
          roomName: r.room_name,
          memberCode: r.member_code,
          status: r.status,
          channel: r.source,
          acquisitionSource: r.acquisition_source,
          utmSource: r.utm_source,
          utmMedium: r.utm_medium,
          utmCampaign: r.utm_campaign,
          utmContent: r.utm_content,
          guestCount: num(r.guest_count),
          subtotal: num(r.subtotal_amount),
          discount: num(r.discount_amount),
          total: num(r.total_amount),
          couponCodes: r.coupon_codes,
          paid: num(r.paid),
          refunded: num(r.refunded),
          cancellationFee: r.fee_amount === null ? null : num(r.fee_amount),
          confirmedAt: r.confirmed_at,
          canceledAt: r.canceled_at,
          createdAt: r.created_at,
        }
      }
      if (rows.length < PAGE) return
      afterId = num(rows.at(-1)?.id)
    }
  }

  /** Succeeded payments (by payment time), then succeeded refunds (by refund time). */
  async *moneyLines(scope: ReportScope): AsyncIterable<MoneyLine> {
    const { start, end } = instants(scope)
    for (const kind of ['payment', 'refund'] as const) {
      let afterId = 0
      for (;;) {
        const query =
          kind === 'payment'
            ? sql`
              SELECT p.id, p.paid_at AS occurred_at, p.amount, p.method, p.provider,
                     p.external_payment_id AS external_id, NULL AS reason, pc.tax_rate,
                     s.code AS store_code, s.name AS store_name, b.booking_code, b.business_date
              FROM payments p
              JOIN bookings b ON b.id = p.booking_id
              JOIN stores s ON s.id = b.store_id
              LEFT JOIN price_calculations pc ON pc.id = p.price_calculation_id
              WHERE p.status = 'succeeded' AND p.paid_at >= ${start} AND p.paid_at < ${end}
                AND p.id > ${afterId} ${inStores('b.store_id', scope.storeIds)}
              ORDER BY p.id LIMIT ${PAGE}`
            : sql`
              SELECT rf.id, rf.refunded_at AS occurred_at, rf.amount, p.method, p.provider,
                     rf.external_refund_id AS external_id, rf.reason, pc.tax_rate,
                     s.code AS store_code, s.name AS store_name, b.booking_code, b.business_date
              FROM refunds rf
              JOIN payments p ON p.id = rf.payment_id
              JOIN bookings b ON b.id = rf.booking_id
              JOIN stores s ON s.id = b.store_id
              LEFT JOIN price_calculations pc ON pc.id = p.price_calculation_id
              WHERE rf.status = 'succeeded' AND rf.refunded_at >= ${start} AND rf.refunded_at < ${end}
                AND rf.id > ${afterId} ${inStores('b.store_id', scope.storeIds)}
              ORDER BY rf.id LIMIT ${PAGE}`
        const rows = await this.rows(
          query as RawBuilder<{
            id: number
            occurred_at: Date
            amount: number
            method: string
            provider: string
            external_id: string | null
            reason: string | null
            tax_rate: string | null
            store_code: string
            store_name: string
            booking_code: string
            business_date: Date
          }>,
        )
        for (const r of rows) {
          yield {
            kind,
            occurredAt: r.occurred_at,
            storeCode: r.store_code,
            storeName: r.store_name,
            bookingCode: r.booking_code,
            businessDate: dateValue(r.business_date),
            method: r.method,
            provider: r.provider,
            amount: num(r.amount),
            taxRatePercent: r.tax_rate === null ? null : Number(r.tax_rate),
            externalId: r.external_id,
            reason: r.reason,
          }
        }
        if (rows.length < PAGE) break
        afterId = num(rows.at(-1)?.id)
      }
    }
  }
}

/** report_exports (A-27 出力履歴). The CSV is streamed, so no file is stored (file_object_key null). */
export class KyselyReportExportRepository implements ReportExportRepository {
  constructor(private readonly db: Database) {}

  async start(entry: Parameters<ReportExportRepository['start']>[0]) {
    const inserted = await this.db
      .insertInto('report_exports')
      .values({
        staff_id: entry.staffId,
        store_id: entry.storeId,
        report_type: entry.reportType,
        period_from: new Date(`${entry.periodFrom}T00:00:00Z`),
        period_to: new Date(`${entry.periodTo}T00:00:00Z`),
        filters: JSON.stringify(entry.filters),
        data_as_of: entry.dataAsOf,
        definition_version: entry.definitionVersion,
        status: 'running',
      })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async finish(id: number, result: Parameters<ReportExportRepository['finish']>[1]) {
    await this.db
      .updateTable('report_exports')
      .set(
        result.status === 'completed'
          ? { status: 'completed', row_count: result.rowCount, completed_at: result.at }
          : { status: 'failed', error_message: result.error, completed_at: result.at },
      )
      .where('id', '=', id)
      .where('status', '=', 'running')
      .execute()
  }

  async recent(limit: number, storeIds: readonly number[] | null): Promise<ReportExportRecord[]> {
    if (storeIds?.length === 0) return []
    let q = this.db
      .selectFrom('report_exports as e')
      .innerJoin('staff as st', 'st.id', 'e.staff_id')
      .leftJoin('stores as s', 's.id', 'e.store_id')
      .select([
        'e.id',
        'e.report_type',
        's.code as store_code',
        'e.period_from',
        'e.period_to',
        'st.name as staff_name',
        'e.status',
        'e.row_count',
        'e.created_at',
      ])
      .orderBy('e.id', 'desc')
      .limit(limit)
    if (storeIds) q = q.where('e.store_id', 'in', [...storeIds])
    return (await q.execute()).map((r) => ({
      id: Number(r.id),
      reportType: r.report_type,
      storeCode: r.store_code,
      periodFrom: toLocalDate(r.period_from),
      periodTo: toLocalDate(r.period_to),
      staffName: r.staff_name,
      status: r.status,
      rowCount: r.row_count === null ? null : Number(r.row_count),
      createdAt: r.created_at,
    }))
  }
}

/** funnel_events (F-RPT-01, migration 0007). */
export class KyselyFunnelEventRepository implements FunnelEventRepository {
  constructor(private readonly db: Database) {}

  async record(event: Parameters<FunnelEventRepository['record']>[0]) {
    await this.db
      .insertInto('funnel_events')
      .values({
        visitor_key: event.visitorKey,
        step: event.step,
        channel: event.channel,
        store_id: event.storeId,
        member_id: event.memberId,
        utm_source: event.utmSource,
        occurred_at: event.occurredAt,
      })
      .execute()
  }
}
