import {
  assertCan,
  DomainError,
  type LocalDate,
  type Permission,
  parseLocalDate,
  type StaffAccess,
  visibleStoreIds,
} from '@jancube/domain'

/** Longest period one report or export may cover. */
export const MAX_REPORT_DAYS = 366

/** Version of the column/aggregation definitions, stored with each export (report_exports). */
export const REPORT_DEFINITION_VERSION = 'v1'

/** A-27 report catalogue (Figma A-27 rows) plus the A-24 audit log export. */
export const REPORT_TYPES = {
  bookings: { label: '予約データ', unit: '予約1件=1行', permission: 'reports.export' },
  sales: { label: '売上データ', unit: '決済・返金1件=1行', permission: 'reports.export' },
  occupancy: { label: '稼働率', unit: '店舗×日×部屋タイプ=1行', permission: 'reports.export' },
  acquisition: { label: '流入元', unit: '流入元×期間=1行', permission: 'reports.export' },
  coupon_effect: { label: 'クーポン効果', unit: 'クーポン×期間=1行', permission: 'reports.export' },
  coupon_redemptions: {
    label: 'クーポン利用明細',
    unit: 'クーポン利用1件=1行',
    permission: 'reports.export',
  },
  cleaning: { label: '清掃実績', unit: '清掃1件=1行', permission: 'reports.export' },
  funnel: { label: '予約ファネル', unit: '店舗×期間=1行', permission: 'reports.export' },
  audit_logs: { label: '監査ログ', unit: '操作1件=1行', permission: 'audit.view' },
} as const satisfies Record<string, { label: string; unit: string; permission: Permission }>

export type ReportType = keyof typeof REPORT_TYPES

export function isReportType(value: string): value is ReportType {
  return Object.hasOwn(REPORT_TYPES, value)
}

/**
 * Stores a report may cover (F-ADM-02 row-level access): a requested store must be granted;
 * "all stores" means every store for all-store grants, otherwise the granted stores.
 */
export function resolveStoreScope(
  access: StaffAccess,
  permission: Permission,
  requestedStoreId: number | null,
): readonly number[] | null {
  if (requestedStoreId !== null) {
    assertCan(access, permission, requestedStoreId)
    return [requestedStoreId]
  }
  const visible = visibleStoreIds(access, permission)
  if (visible === null) return null
  if (visible.length === 0) throw new DomainError('forbidden', `missing permission ${permission}`)
  return visible
}

/** Valid inclusive period of at most MAX_REPORT_DAYS days. */
export function assertReportPeriod(from: LocalDate, to: LocalDate): void {
  const a = parseLocalDate(from)
  const b = parseLocalDate(to)
  const days =
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000 + 1
  if (days < 1) throw new DomainError('invalid_period', 'the end date is before the start date')
  if (days > MAX_REPORT_DAYS) throw new DomainError('period_too_long', 'the period is too long')
}
