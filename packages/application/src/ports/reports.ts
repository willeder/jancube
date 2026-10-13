import type { LocalDate } from '@jancube/domain'

/**
 * Period and store scope of a report (A-27). Dates are inclusive calendar dates in the report time
 * zone (Asia/Tokyo): booking reports use the business date, money/cleaning reports the local date
 * of the timestamp.
 */
export interface ReportScope {
  readonly from: LocalDate
  readonly to: LocalDate
  /** null = every store. */
  readonly storeIds: readonly number[] | null
}

export interface ReportStore {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly timezone: string
}

export interface BookedMinutesRow {
  readonly storeId: number
  readonly businessDate: LocalDate
  readonly roomTypeName: string
  readonly minutes: number
  readonly bookings: number
}

export interface DailySalesRow {
  readonly storeId: number
  readonly date: LocalDate
  readonly payments: number
  readonly paid: number
  readonly refunded: number
}

/** One confirmed/completed booking with what the acquisition report needs. */
export interface AcquisitionRow {
  readonly storeId: number
  readonly channel: string
  readonly acquisitionSource: string | null
  readonly utmSource: string | null
  readonly utmMedium: string | null
  readonly utmCampaign: string | null
  readonly total: number
  /** The member's first confirmed booking. */
  readonly isFirst: boolean
  /** The member booked again (confirmed) after this booking. */
  readonly hasNext: boolean
}

export interface CouponGrantStat {
  readonly couponId: number
  readonly code: string
  readonly name: string
  /** Grants issued in the period. */
  readonly issued: number
  /** Of those, grants with at least one applied use. */
  readonly used: number
}

export interface CouponRedemptionRow {
  readonly couponId: number
  readonly couponCode: string
  readonly couponName: string
  readonly appliedAt: Date
  readonly status: 'applied' | 'reversed'
  readonly bookingCode: string
  readonly storeId: number
  readonly storeCode: string
  readonly businessDate: LocalDate
  readonly memberCode: string | null
  readonly useSequence: number
  readonly discount: number
  readonly bookingTotal: number
  /** The member booked again (confirmed) after the booking the coupon was used on. */
  readonly memberBookedAgain: boolean
}

export interface CleaningRow {
  readonly storeId: number
  readonly storeCode: string
  readonly storeName: string
  readonly roomName: string
  readonly taskType: 'opening' | 'spot'
  readonly staffName: string
  readonly startedAt: Date | null
  readonly completedAt: Date
  readonly dueAt: Date
  readonly wasOverdue: boolean
  readonly notes: string | null
}

export interface FunnelStepCount {
  readonly storeId: number | null
  readonly step: FunnelStep
  /** Distinct anonymous visitors. */
  readonly visitors: number
}

export interface BookingFunnelCount {
  readonly storeId: number
  readonly holds: number
  readonly signedIn: number
  readonly checkoutStarted: number
  readonly confirmed: number
}

export interface BookingLine {
  readonly bookingCode: string
  readonly storeCode: string
  readonly storeName: string
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly roomTypeName: string
  /** Assigned room, or the named room; null before assignment. */
  readonly roomName: string | null
  readonly memberCode: string | null
  readonly status: string
  readonly channel: string
  readonly acquisitionSource: string | null
  readonly utmSource: string | null
  readonly utmMedium: string | null
  readonly utmCampaign: string | null
  readonly utmContent: string | null
  readonly guestCount: number
  readonly subtotal: number
  readonly discount: number
  readonly total: number
  readonly couponCodes: string | null
  readonly paid: number
  readonly refunded: number
  readonly cancellationFee: number | null
  readonly confirmedAt: Date | null
  readonly canceledAt: Date | null
  readonly createdAt: Date
}

/** A succeeded payment or refund (F-PAY-09). */
export interface MoneyLine {
  readonly kind: 'payment' | 'refund'
  readonly occurredAt: Date
  readonly storeCode: string
  readonly storeName: string
  readonly bookingCode: string
  readonly businessDate: LocalDate
  readonly method: string
  readonly provider: string
  /** Positive for payments and refunds alike; the CSV signs refunds. */
  readonly amount: number
  readonly taxRatePercent: number | null
  readonly externalId: string | null
  readonly reason: string | null
}

/** Read model for A-27. Aggregation that needs business rules is done by the use cases. */
export interface ReportQueries {
  /** Stores in scope, including inactive ones (past data). */
  stores(storeIds: readonly number[] | null): Promise<ReportStore[]>
  /** Rooms in operation per store and room type (current master data). */
  roomCounts(
    storeIds: readonly number[] | null,
  ): Promise<{ storeId: number; roomTypeName: string; rooms: number }[]>
  /** Confirmed/completed bookings by business date and room type. */
  bookedMinutes(scope: ReportScope): Promise<BookedMinutesRow[]>
  dailySales(scope: ReportScope): Promise<DailySalesRow[]>
  acquisitionRows(scope: ReportScope): Promise<AcquisitionRow[]>
  /** Grants are not store-specific: the store scope does not apply. */
  couponGrantStats(scope: ReportScope): Promise<CouponGrantStat[]>
  couponRedemptions(scope: ReportScope): Promise<CouponRedemptionRow[]>
  cleaningRows(scope: ReportScope): Promise<CleaningRow[]>
  funnelSteps(scope: ReportScope): Promise<FunnelStepCount[]>
  /** Web/LIFF bookings created in the period (holds) and how far they got. */
  bookingFunnel(scope: ReportScope): Promise<BookingFunnelCount[]>
  /** Booking detail lines, read in pages (large exports stream). */
  bookingLines(scope: ReportScope): AsyncIterable<BookingLine>
  moneyLines(scope: ReportScope): AsyncIterable<MoneyLine>
}

export type ReportExportStatus = 'running' | 'completed' | 'failed'

export interface ReportExportRecord {
  readonly id: number
  readonly reportType: string
  readonly storeCode: string | null
  readonly periodFrom: LocalDate
  readonly periodTo: LocalDate
  readonly staffName: string
  readonly status: string
  readonly rowCount: number | null
  readonly createdAt: Date
}

/** report_exports: every CSV download is recorded (who, what, which period). */
export interface ReportExportRepository {
  start(entry: {
    readonly staffId: number
    readonly storeId: number | null
    readonly reportType: string
    readonly periodFrom: LocalDate
    readonly periodTo: LocalDate
    readonly filters: Readonly<Record<string, unknown>>
    readonly dataAsOf: Date
    readonly definitionVersion: string
  }): Promise<number>
  finish(
    id: number,
    result:
      | { readonly status: 'completed'; readonly rowCount: number; readonly at: Date }
      | { readonly status: 'failed'; readonly error: string; readonly at: Date },
  ): Promise<void>
  recent(limit: number, storeIds: readonly number[] | null): Promise<ReportExportRecord[]>
}

// ---------------------------------------------------------------- audit log (A-24)

export interface AuditLogFilter {
  readonly from: LocalDate
  readonly to: LocalDate
  /** Staff name/email, member code, or "system". */
  readonly actor?: string | null
  readonly action?: string | null
  /** Target code (e.g. booking number) or target type. */
  readonly target?: string | null
  /** null = all logs; otherwise only logs of these stores. */
  readonly storeIds: readonly number[] | null
}

export interface AuditLogEntry {
  readonly id: number
  readonly occurredAt: Date
  readonly actorType: 'system' | 'staff' | 'member'
  /** Staff name or member code. */
  readonly actorLabel: string | null
  readonly actorRoles: readonly string[]
  readonly storeCode: string | null
  readonly action: string
  readonly targetType: string
  readonly targetId: number | null
  readonly targetCode: string | null
  readonly before: unknown
  readonly after: unknown
  readonly reason: string | null
  readonly ip: string | null
  readonly requestId: string
}

export interface AuditLogQuery {
  /** Newest first; `beforeId` continues a previous page. */
  search(
    filter: AuditLogFilter,
    page: { limit: number; beforeId?: number | null },
  ): Promise<AuditLogEntry[]>
  /** Every log matching the filter, newest first, read in pages (CSV). */
  stream(filter: AuditLogFilter): AsyncIterable<AuditLogEntry>
  /** Action codes present in the log (filter choices). */
  actions(): Promise<string[]>
}

// ---------------------------------------------------------------- funnel (F-RPT-01)

export const FUNNEL_STEPS = [
  'liff_opened',
  'store_selected',
  'slots_viewed',
  'hold_created',
  'signed_in',
  'checkout_started',
  'confirmed',
] as const
export type FunnelStep = (typeof FUNNEL_STEPS)[number]

export interface FunnelEventRepository {
  record(event: {
    readonly visitorKey: string
    readonly step: FunnelStep
    readonly channel: 'web' | 'liff'
    readonly storeId: number | null
    readonly memberId: number | null
    readonly utmSource: string | null
    readonly occurredAt: Date
  }): Promise<void>
}
