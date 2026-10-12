import { addDays, type LocalDate, openingWindow, type StaffAccess } from '@jancube/domain'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import type {
  AcquisitionRow,
  AuditLogQuery,
  CleaningRow,
  CouponGrantStat,
  CouponRedemptionRow,
  ReportExportRepository,
  ReportQueries,
  ReportScope,
  ReportStore,
} from '../ports/reports'
import type { StoreRepository } from '../ports/store-repository'
import { percent } from './csv'
import { assertReportPeriod, resolveStoreScope } from './scope'

export interface ReportDeps {
  readonly reports: ReportQueries
  readonly stores: Pick<StoreRepository, 'weeklyHours' | 'calendarOverrides'>
  readonly exports: ReportExportRepository
  readonly auditLogs: AuditLogQuery
  readonly audit: AuditLog
  readonly clock: Clock
}

// ---------------------------------------------------------------- occupancy (F-RPT-02)

export interface OccupancyLine {
  readonly storeId: number
  readonly storeCode: string
  readonly storeName: string
  readonly date: LocalDate
  readonly roomTypeName: string
  readonly rooms: number
  /** Opening hours of the day in minutes (0 when closed). */
  readonly openMinutes: number
  /** Room-minutes on sale: opening minutes × rooms. */
  readonly availableMinutes: number
  readonly bookedMinutes: number
  readonly bookings: number
  readonly rate: number | null
}

function* datesIn(from: LocalDate, to: LocalDate): Generator<LocalDate> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d
}

/**
 * Room-time sold ÷ room-time on sale per store, day and room type. Uses the current room master
 * (rooms in operation) and each day's opening hours; cleaning buffers count as available time.
 */
export async function occupancyLines(
  deps: Pick<ReportDeps, 'reports' | 'stores'>,
  scope: ReportScope,
  stores: readonly ReportStore[],
): Promise<OccupancyLine[]> {
  const [counts, booked] = await Promise.all([
    deps.reports.roomCounts(scope.storeIds),
    deps.reports.bookedMinutes(scope),
  ])
  const lines: OccupancyLine[] = []
  for (const store of stores) {
    const [weekly, overrides] = await Promise.all([
      deps.stores.weeklyHours(store.id),
      deps.stores.calendarOverrides(store.id, scope.from, scope.to),
    ])
    const storeBooked = booked.filter((b) => b.storeId === store.id)
    const rooms = new Map(
      counts.filter((c) => c.storeId === store.id).map((c) => [c.roomTypeName, c.rooms]),
    )
    for (const b of storeBooked) if (!rooms.has(b.roomTypeName)) rooms.set(b.roomTypeName, 0)
    const types = [...rooms.keys()].sort()
    for (const date of datesIn(scope.from, scope.to)) {
      const window = openingWindow(
        date,
        store.timezone,
        weekly,
        overrides.find((o) => o.date === date),
      )
      const openMinutes = window ? window.closesMinute - window.opensMinute : 0
      for (const roomTypeName of types) {
        const roomCount = rooms.get(roomTypeName) ?? 0
        const row = storeBooked.find(
          (b) => b.businessDate === date && b.roomTypeName === roomTypeName,
        )
        const availableMinutes = openMinutes * roomCount
        const bookedMinutes = row?.minutes ?? 0
        lines.push({
          storeId: store.id,
          storeCode: store.code,
          storeName: store.name,
          date,
          roomTypeName,
          rooms: roomCount,
          openMinutes,
          availableMinutes,
          bookedMinutes,
          bookings: row?.bookings ?? 0,
          rate: percent(bookedMinutes, availableMinutes),
        })
      }
    }
  }
  return lines
}

/** Occupancy per store and day (all room types together), for the screen. */
export function occupancyByDay(lines: readonly OccupancyLine[]) {
  const byKey = new Map<
    string,
    { storeId: number; storeCode: string; date: LocalDate; available: number; booked: number }
  >()
  for (const l of lines) {
    const key = `${l.storeId}:${l.date}`
    const row = byKey.get(key) ?? {
      storeId: l.storeId,
      storeCode: l.storeCode,
      date: l.date,
      available: 0,
      booked: 0,
    }
    row.available += l.availableMinutes
    row.booked += l.bookedMinutes
    byKey.set(key, row)
  }
  return [...byKey.values()].map((r) => ({ ...r, rate: percent(r.booked, r.available) }))
}

// ---------------------------------------------------------------- acquisition (F-RPT-05)

export interface AcquisitionLine {
  readonly channel: string
  readonly acquisitionSource: string | null
  readonly utmSource: string | null
  readonly utmMedium: string | null
  readonly utmCampaign: string | null
  readonly bookings: number
  readonly sales: number
  readonly firstTime: number
  readonly firstTimeRate: number | null
  /** First-time bookers who booked a second time. */
  readonly secondBookings: number
  readonly secondRate: number | null
}

export function summarizeAcquisition(rows: readonly AcquisitionRow[]): AcquisitionLine[] {
  const groups = new Map<string, { key: AcquisitionRow; rows: AcquisitionRow[] }>()
  for (const r of rows) {
    const id = JSON.stringify([
      r.channel,
      r.acquisitionSource,
      r.utmSource,
      r.utmMedium,
      r.utmCampaign,
    ])
    const group = groups.get(id) ?? { key: r, rows: [] }
    group.rows.push(r)
    groups.set(id, group)
  }
  return [...groups.values()]
    .map(({ key, rows: g }) => {
      const firstTime = g.filter((r) => r.isFirst).length
      const secondBookings = g.filter((r) => r.isFirst && r.hasNext).length
      return {
        channel: key.channel,
        acquisitionSource: key.acquisitionSource,
        utmSource: key.utmSource,
        utmMedium: key.utmMedium,
        utmCampaign: key.utmCampaign,
        bookings: g.length,
        sales: g.reduce((sum, r) => sum + r.total, 0),
        firstTime,
        firstTimeRate: percent(firstTime, g.length),
        secondBookings,
        secondRate: percent(secondBookings, firstTime),
      }
    })
    .sort((a, b) => b.bookings - a.bookings || b.sales - a.sales)
}

// ---------------------------------------------------------------- coupons (F-RPT-03, F-CPN-10)

export interface CouponEffectLine {
  readonly couponId: number
  readonly code: string
  readonly name: string
  readonly issued: number
  readonly issuedUsed: number
  readonly usageRate: number | null
  readonly redemptions: number
  readonly discountTotal: number
  readonly salesTotal: number
  /** Redemptions whose member booked again afterwards. */
  readonly rebooked: number
  readonly rebookRate: number | null
}

export function summarizeCoupons(
  grants: readonly CouponGrantStat[],
  redemptions: readonly CouponRedemptionRow[],
): CouponEffectLine[] {
  const lines = new Map<number, CouponEffectLine>()
  const base = (couponId: number, code: string, name: string): CouponEffectLine => ({
    couponId,
    code,
    name,
    issued: 0,
    issuedUsed: 0,
    usageRate: null,
    redemptions: 0,
    discountTotal: 0,
    salesTotal: 0,
    rebooked: 0,
    rebookRate: null,
  })
  for (const g of grants) {
    lines.set(g.couponId, {
      ...base(g.couponId, g.code, g.name),
      issued: g.issued,
      issuedUsed: g.used,
    })
  }
  for (const r of redemptions) {
    if (r.status !== 'applied') continue
    const line = lines.get(r.couponId) ?? base(r.couponId, r.couponCode, r.couponName)
    lines.set(r.couponId, {
      ...line,
      redemptions: line.redemptions + 1,
      discountTotal: line.discountTotal + r.discount,
      salesTotal: line.salesTotal + r.bookingTotal,
      rebooked: line.rebooked + (r.memberBookedAgain ? 1 : 0),
    })
  }
  return [...lines.values()]
    .map((l) => ({
      ...l,
      usageRate: percent(l.issuedUsed, l.issued),
      rebookRate: percent(l.rebooked, l.redemptions),
    }))
    .sort((a, b) => b.redemptions - a.redemptions || a.code.localeCompare(b.code))
}

// ---------------------------------------------------------------- cleaning (F-RPT-06)

export const cleaningMinutes = (r: CleaningRow): number | null =>
  r.startedAt ? Math.round((r.completedAt.getTime() - r.startedAt.getTime()) / 60_000) : null

export function summarizeCleaning(rows: readonly CleaningRow[]) {
  const byStore = new Map<number, CleaningRow[]>()
  for (const r of rows) byStore.set(r.storeId, [...(byStore.get(r.storeId) ?? []), r])
  return [...byStore.values()].map((g) => {
    const first = g[0] as CleaningRow
    const timed = g.map(cleaningMinutes).filter((m): m is number => m !== null)
    return {
      storeId: first.storeId,
      storeCode: first.storeCode,
      storeName: first.storeName,
      total: g.length,
      opening: g.filter((r) => r.taskType === 'opening').length,
      spot: g.filter((r) => r.taskType === 'spot').length,
      overdue: g.filter((r) => r.wasOverdue).length,
      averageMinutes:
        timed.length > 0 ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : null,
    }
  })
}

// ---------------------------------------------------------------- funnel (F-RPT-01)

export interface FunnelLine {
  readonly storeId: number
  readonly storeCode: string
  readonly storeName: string
  readonly storeSelected: number
  readonly slotsViewed: number
  readonly holds: number
  readonly signedIn: number
  readonly checkoutStarted: number
  readonly confirmed: number
  /** Confirmed bookings ÷ visitors who selected the store. */
  readonly conversion: number | null
}

export async function funnelLines(
  deps: Pick<ReportDeps, 'reports'>,
  scope: ReportScope,
  stores: readonly ReportStore[],
): Promise<{ liffOpened: number; lines: FunnelLine[] }> {
  const [steps, bookings] = await Promise.all([
    deps.reports.funnelSteps(scope),
    deps.reports.bookingFunnel(scope),
  ])
  const visitors = (storeId: number | null, step: string) =>
    steps
      .filter((s) => s.storeId === storeId && s.step === step)
      .reduce((n, s) => n + s.visitors, 0)
  return {
    liffOpened: steps.filter((s) => s.step === 'liff_opened').reduce((n, s) => n + s.visitors, 0),
    lines: stores.map((store) => {
      const b = bookings.find((x) => x.storeId === store.id)
      const storeSelected = visitors(store.id, 'store_selected')
      const confirmed = b?.confirmed ?? 0
      return {
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        storeSelected,
        slotsViewed: visitors(store.id, 'slots_viewed'),
        holds: b?.holds ?? 0,
        signedIn: b?.signedIn ?? 0,
        checkoutStarted: b?.checkoutStarted ?? 0,
        confirmed,
        conversion: percent(confirmed, storeSelected),
      }
    }),
  }
}

// ---------------------------------------------------------------- A-27 screen

/** A-27: on-screen summaries for the period (F-RPT-02/03/05/06, F-RPT-01). */
export function makeGetReportSummary(deps: Pick<ReportDeps, 'reports' | 'stores' | 'clock'>) {
  return async function getReportSummary(
    access: StaffAccess,
    input: { from: LocalDate; to: LocalDate; storeId: number | null },
  ) {
    assertReportPeriod(input.from, input.to)
    const scope: ReportScope = {
      from: input.from,
      to: input.to,
      storeIds: resolveStoreScope(access, 'reports.export', input.storeId),
    }
    const stores = await deps.reports.stores(scope.storeIds)
    const [occupancy, sales, acquisition, grants, redemptions, cleaning, funnel] =
      await Promise.all([
        occupancyLines(deps, scope, stores),
        deps.reports.dailySales(scope),
        deps.reports.acquisitionRows(scope),
        deps.reports.couponGrantStats(scope),
        deps.reports.couponRedemptions(scope),
        deps.reports.cleaningRows(scope),
        funnelLines(deps, scope, stores),
      ])
    const code = (storeId: number) => stores.find((s) => s.id === storeId)?.code ?? '-'
    return {
      asOf: deps.clock.now(),
      stores,
      occupancy: occupancyByDay(occupancy),
      sales: sales.map((s) => ({ ...s, storeCode: code(s.storeId), net: s.paid - s.refunded })),
      acquisition: summarizeAcquisition(acquisition),
      coupons: summarizeCoupons(grants, redemptions),
      cleaning: summarizeCleaning(cleaning),
      funnel,
    }
  }
}

export type ReportSummary = Awaited<ReturnType<ReturnType<typeof makeGetReportSummary>>>
