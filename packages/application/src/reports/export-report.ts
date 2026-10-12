import { DomainError, type LocalDate, type StaffAccess } from '@jancube/domain'
import type { AuditLogFilter, ReportScope } from '../ports/reports'
import { CSV_BOM, type CsvValue, csvLine, formatReportTime } from './csv'
import {
  cleaningMinutes,
  funnelLines,
  occupancyLines,
  type ReportDeps,
  summarizeAcquisition,
  summarizeCoupons,
} from './report-summary'
import {
  assertReportPeriod,
  isReportType,
  REPORT_DEFINITION_VERSION,
  REPORT_TYPES,
  type ReportType,
  resolveStoreScope,
} from './scope'

type Rows = AsyncGenerator<readonly CsvValue[]>

const BOOKING_STATUS: Record<string, string> = {
  confirmed: '確定',
  completed: '利用済',
  canceled: 'キャンセル',
  draft: '仮押さえ',
  expired: '期限切れ',
}
const CHANNEL: Record<string, string> = {
  web: 'Web',
  liff: 'LINE(LIFF)',
  line: 'LINEトーク',
  proxy: '代理予約',
}
const METHOD: Record<string, string> = { card: 'カード', paypay: 'PayPay', other: 'その他' }
const label = (map: Record<string, string>, code: string) => map[code] ?? code

/** Consumption tax contained in a tax-inclusive amount (rounded down per line; Q-05 to confirm). */
export function includedTax(amount: number, ratePercent: number | null): number | null {
  if (ratePercent === null) return null
  const tax = Math.floor((Math.abs(amount) * ratePercent) / (100 + ratePercent))
  return amount < 0 ? -tax : tax
}

/** F-RPT-04 予約データ: one line per booking (confirmed, completed or canceled) by usage date. */
async function* bookingRows(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    '予約番号',
    '店舗コード',
    '店舗名',
    '利用日',
    '開始',
    '終了',
    '利用時間(分)',
    '部屋タイプ',
    '部屋',
    '会員番号',
    '状態',
    '予約経路',
    '流入元',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    '人数',
    '小計(税込)',
    'クーポン値引',
    '予約金額(税込)',
    'クーポンコード',
    '決済額',
    '返金額',
    'キャンセル料',
    '予約確定日時',
    'キャンセル日時',
    '作成日時',
  ]
  for await (const b of deps.reports.bookingLines(scope)) {
    yield [
      b.bookingCode,
      b.storeCode,
      b.storeName,
      b.businessDate,
      formatReportTime(b.start),
      formatReportTime(b.end),
      Math.round((b.end.getTime() - b.start.getTime()) / 60_000),
      b.roomTypeName,
      b.roomName,
      b.memberCode,
      label(BOOKING_STATUS, b.status),
      label(CHANNEL, b.channel),
      b.acquisitionSource,
      b.utmSource,
      b.utmMedium,
      b.utmCampaign,
      b.utmContent,
      b.guestCount,
      b.subtotal,
      b.discount,
      b.total,
      b.couponCodes,
      b.paid,
      b.refunded,
      b.cancellationFee,
      formatReportTime(b.confirmedAt),
      formatReportTime(b.canceledAt),
      formatReportTime(b.createdAt),
    ]
  }
}

/** F-PAY-09 売上データ: succeeded payments and refunds; refunds are negative. */
async function* salesRows(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    '計上日時',
    '区分',
    '店舗コード',
    '店舗名',
    '予約番号',
    '利用日',
    '決済方法',
    '決済代行',
    '金額(税込)',
    '税率(%)',
    'うち消費税',
    '外部取引ID',
    '返金理由',
  ]
  for await (const m of deps.reports.moneyLines(scope)) {
    const amount = m.kind === 'refund' ? -m.amount : m.amount
    yield [
      formatReportTime(m.occurredAt),
      m.kind === 'refund' ? '返金' : '決済',
      m.storeCode,
      m.storeName,
      m.bookingCode,
      m.businessDate,
      label(METHOD, m.method),
      m.provider,
      amount,
      m.taxRatePercent,
      includedTax(amount, m.taxRatePercent),
      m.externalId,
      m.reason,
    ]
  }
}

async function* occupancyRows(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    '日付',
    '店舗コード',
    '店舗名',
    '部屋タイプ',
    '部屋数',
    '営業時間(分)',
    '提供室時間(分)',
    '予約室時間(分)',
    '空き室時間(分)',
    '稼働率(%)',
    '予約件数',
  ]
  const stores = await deps.reports.stores(scope.storeIds)
  for (const l of await occupancyLines(deps, scope, stores)) {
    yield [
      l.date,
      l.storeCode,
      l.storeName,
      l.roomTypeName,
      l.rooms,
      l.openMinutes,
      l.availableMinutes,
      l.bookedMinutes,
      Math.max(0, l.availableMinutes - l.bookedMinutes),
      l.rate,
      l.bookings,
    ]
  }
}

async function* acquisitionCsv(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    '予約経路',
    '流入元',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    '予約数',
    '売上(税込)',
    '初回予約数',
    '初回率(%)',
    '2回目予約数',
    '2回目転換率(%)',
  ]
  for (const l of summarizeAcquisition(await deps.reports.acquisitionRows(scope))) {
    yield [
      label(CHANNEL, l.channel),
      l.acquisitionSource,
      l.utmSource,
      l.utmMedium,
      l.utmCampaign,
      l.bookings,
      l.sales,
      l.firstTime,
      l.firstTimeRate,
      l.secondBookings,
      l.secondRate,
    ]
  }
}

async function* couponEffectRows(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    'クーポンコード',
    'クーポン名',
    '配布数(期間内)',
    'うち利用済',
    '利用率(%)',
    '利用件数(期間内)',
    '割引総額',
    '利用予約の売上(税込)',
    '再予約数',
    '再予約率(%)',
  ]
  const [grants, redemptions] = await Promise.all([
    deps.reports.couponGrantStats(scope),
    deps.reports.couponRedemptions(scope),
  ])
  for (const l of summarizeCoupons(grants, redemptions)) {
    yield [
      l.code,
      l.name,
      l.issued,
      l.issuedUsed,
      l.usageRate,
      l.redemptions,
      l.discountTotal,
      l.salesTotal,
      l.rebooked,
      l.rebookRate,
    ]
  }
}

async function* couponRedemptionRows(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    '適用日時',
    'クーポンコード',
    'クーポン名',
    '予約番号',
    '店舗コード',
    '利用日',
    '会員番号',
    '利用回',
    '割引額',
    '予約金額(税込)',
    '状態',
  ]
  for (const r of await deps.reports.couponRedemptions(scope)) {
    yield [
      formatReportTime(r.appliedAt),
      r.couponCode,
      r.couponName,
      r.bookingCode,
      r.storeCode,
      r.businessDate,
      r.memberCode,
      r.useSequence,
      r.discount,
      r.bookingTotal,
      r.status === 'applied' ? '利用' : '取消(戻し)',
    ]
  }
}

async function* cleaningCsv(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    '完了日時',
    '店舗コード',
    '店舗名',
    '部屋',
    '種別',
    '担当者',
    '開始日時',
    '所要時間(分)',
    '期限',
    '期限超過',
    'メモ',
  ]
  for (const r of await deps.reports.cleaningRows(scope)) {
    yield [
      formatReportTime(r.completedAt),
      r.storeCode,
      r.storeName,
      r.roomName,
      r.taskType === 'opening' ? '開店前清掃' : 'スポット清掃',
      r.staffName,
      formatReportTime(r.startedAt),
      cleaningMinutes(r),
      formatReportTime(r.dueAt),
      r.wasOverdue ? '超過' : '',
      r.notes,
    ]
  }
}

async function* funnelCsv(deps: ReportDeps, scope: ReportScope): Rows {
  yield [
    '店舗コード',
    '店舗名',
    '店舗選択(訪問者)',
    '空き状況表示(訪問者)',
    '仮押さえ',
    'ログイン済み',
    '決済開始',
    '予約確定',
    '確定率(%)',
  ]
  const stores = await deps.reports.stores(scope.storeIds)
  for (const l of (await funnelLines(deps, scope, stores)).lines) {
    yield [
      l.storeCode,
      l.storeName,
      l.storeSelected,
      l.slotsViewed,
      l.holds,
      l.signedIn,
      l.checkoutStarted,
      l.confirmed,
      l.conversion,
    ]
  }
}

const ACTOR: Record<string, string> = { system: 'システム', staff: 'スタッフ', member: '顧客' }
const json = (value: unknown) =>
  value === null || value === undefined ? null : JSON.stringify(value)

async function* auditRows(deps: ReportDeps, filter: AuditLogFilter): Rows {
  yield [
    '日時',
    '操作者種別',
    '操作者',
    'ロール',
    '店舗',
    '操作',
    '対象種別',
    '対象ID',
    '対象コード',
    '変更前',
    '変更後',
    '理由',
    'IP',
    '追跡ID',
  ]
  for await (const e of deps.auditLogs.stream(filter)) {
    yield [
      formatReportTime(e.occurredAt),
      label(ACTOR, e.actorType),
      e.actorLabel,
      e.actorRoles.join(' / '),
      e.storeCode,
      e.action,
      e.targetType,
      e.targetId,
      e.targetCode,
      json(e.before),
      json(e.after),
      e.reason,
      e.ip,
      e.requestId,
    ]
  }
}

export interface ExportRequest {
  readonly type: string
  readonly from: LocalDate
  readonly to: LocalDate
  readonly storeId: number | null
  /** Audit log export only: the A-24 search conditions. */
  readonly audit?: Pick<AuditLogFilter, 'actor' | 'action' | 'target'>
}

export interface ReportFile {
  readonly filename: string
  /** BOM, header and rows as CSV text (CRLF). Iterate once; the export record is completed at the end. */
  readonly chunks: AsyncIterable<string>
}

/**
 * A-27 CSV export (F-RPT-04, F-PAY-09, F-CPN-10) and the A-24 audit log export. Checks the
 * permission and store scope, records the export (report_exports + audit log) and returns the CSV
 * as a stream so large periods are not held in memory.
 */
export function makeExportReport(deps: ReportDeps) {
  return async function exportReport(
    staff: { staffId: number; access: StaffAccess },
    request: ExportRequest,
  ): Promise<ReportFile> {
    if (!isReportType(request.type)) {
      throw new DomainError('report_type_unknown', `unknown report: ${request.type}`)
    }
    const type: ReportType = request.type
    assertReportPeriod(request.from, request.to)
    const storeIds = resolveStoreScope(staff.access, REPORT_TYPES[type].permission, request.storeId)
    const scope: ReportScope = { from: request.from, to: request.to, storeIds }
    const filters = {
      storeId: request.storeId,
      ...(type === 'audit_logs' ? (request.audit ?? {}) : {}),
    }
    const exportId = await deps.exports.start({
      staffId: staff.staffId,
      storeId: request.storeId,
      reportType: type,
      periodFrom: request.from,
      periodTo: request.to,
      filters,
      dataAsOf: deps.clock.now(),
      definitionVersion: REPORT_DEFINITION_VERSION,
    })
    await deps.audit.record({
      actor: { type: 'staff', staffId: staff.staffId },
      action: 'report.export',
      targetType: 'report_export',
      targetId: exportId,
      targetCode: type,
      storeId: request.storeId,
      after: { type, from: request.from, to: request.to, ...filters },
    })

    const rows = (): Rows => {
      switch (type) {
        case 'bookings':
          return bookingRows(deps, scope)
        case 'sales':
          return salesRows(deps, scope)
        case 'occupancy':
          return occupancyRows(deps, scope)
        case 'acquisition':
          return acquisitionCsv(deps, scope)
        case 'coupon_effect':
          return couponEffectRows(deps, scope)
        case 'coupon_redemptions':
          return couponRedemptionRows(deps, scope)
        case 'cleaning':
          return cleaningCsv(deps, scope)
        case 'funnel':
          return funnelCsv(deps, scope)
        case 'audit_logs':
          return auditRows(deps, { ...scope, ...request.audit })
      }
    }

    async function* chunks(): AsyncGenerator<string> {
      let lines = 0
      let finished = false
      try {
        yield CSV_BOM
        let batch = ''
        for await (const row of rows()) {
          batch += csvLine(row)
          lines++
          if (batch.length >= 16_384) {
            yield batch
            batch = ''
          }
        }
        if (batch) yield batch
        finished = true
        await deps.exports.finish(exportId, {
          status: 'completed',
          rowCount: Math.max(0, lines - 1),
          at: deps.clock.now(),
        })
      } catch (error) {
        finished = true
        await deps.exports.finish(exportId, {
          status: 'failed',
          error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
          at: deps.clock.now(),
        })
        throw error
      } finally {
        // The download was interrupted (the consumer stopped reading).
        if (!finished) {
          await deps.exports.finish(exportId, {
            status: 'failed',
            error: 'download aborted',
            at: deps.clock.now(),
          })
        }
      }
    }

    const storePart =
      request.storeId === null
        ? 'all'
        : ((await deps.reports.stores([request.storeId]))[0]?.code ?? 'store')
    return {
      filename: `jancube_${type}_${storePart}_${request.from}_${request.to}.csv`,
      chunks: chunks(),
    }
  }
}
