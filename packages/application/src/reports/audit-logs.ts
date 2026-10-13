import type { LocalDate, StaffAccess } from '@jancube/domain'
import type { AuditLogEntry, AuditLogQuery, ReportExportRepository } from '../ports/reports'
import { assertReportPeriod, resolveStoreScope } from './scope'

export const AUDIT_PAGE_SIZE = 50

/** Japanese names for audit actions recorded by the application (unknown codes are shown as is). */
export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'staff.sign_in': 'ログイン',
  'staff.accept_invite': '招待の承諾',
  'staff.reset_password': 'パスワード再設定',
  'booking.cancel': 'キャンセル実行',
  'booking.change': '予約変更',
  'booking.proxy_create': '代理予約作成',
  'refund.retry': '返金の再実行',
  'alert.assign': 'アラート対応開始',
  'alert.resolve': 'アラート解決',
  'room_block.create': '枠ブロック作成',
  'room_block.release': '枠ブロック解除',
  'notification.resend': '通知の再送',
  'member.update_email': 'メールアドレス変更',
  'member.withdraw': '退会',
  'member.line_link': 'LINE連携',
  'member.line_unlink': 'LINE連携解除',
  'report.export': 'CSV出力',
}

export interface AuditSearchInput {
  readonly from: LocalDate
  readonly to: LocalDate
  readonly actor?: string | null
  readonly action?: string | null
  readonly target?: string | null
  /** Store selected in the admin sidebar; null = all stores the staff member may see. */
  readonly storeId: number | null
  readonly beforeId?: number | null
}

/** A-24 監査ログ (F-OPS-01): newest first, 50 per page, filtered by period, actor, action, target. */
export function makeSearchAuditLogs(deps: { readonly auditLogs: AuditLogQuery }) {
  return async function searchAuditLogs(
    access: StaffAccess,
    input: AuditSearchInput,
  ): Promise<{ entries: AuditLogEntry[]; nextBeforeId: number | null; actions: string[] }> {
    assertReportPeriod(input.from, input.to)
    const storeIds = resolveStoreScope(access, 'audit.view', input.storeId)
    const clean = (v: string | null | undefined) => (v?.trim() ? v.trim().slice(0, 100) : null)
    const [rows, actions] = await Promise.all([
      deps.auditLogs.search(
        {
          from: input.from,
          to: input.to,
          actor: clean(input.actor),
          action: clean(input.action),
          target: clean(input.target),
          storeIds,
        },
        { limit: AUDIT_PAGE_SIZE + 1, beforeId: input.beforeId ?? null },
      ),
      deps.auditLogs.actions(),
    ])
    const entries = rows.slice(0, AUDIT_PAGE_SIZE)
    return {
      entries,
      nextBeforeId: rows.length > AUDIT_PAGE_SIZE ? (entries.at(-1)?.id ?? null) : null,
      actions,
    }
  }
}

/** A-27 出力履歴: recent exports for the stores the staff member may see. */
export function makeListReportExports(deps: { readonly exports: ReportExportRepository }) {
  return async function listReportExports(access: StaffAccess, storeId: number | null) {
    return deps.exports.recent(20, resolveStoreScope(access, 'reports.export', storeId))
  }
}
