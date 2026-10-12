import { DomainError, type StaffAccess } from '@jancube/domain'
import type { AlertStatus, AlertWorkRepository } from '../ports/admin-bookings'
import type { Clock } from '../ports/clock'
import type { AlertSeverity, AuditLog } from '../ports/ops'
import { assertStoreAccess, staffActor, storeFilter } from './access'

export interface AlertDeps {
  readonly alerts: AlertWorkRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

const STATUSES: readonly AlertStatus[] = ['open', 'in_progress', 'resolved']
const SEVERITIES: readonly AlertSeverity[] = ['info', 'warning', 'critical']

/** A-25 アラート一覧. `status` = open | in_progress | resolved | active (open + in progress). */
export function makeListAlerts(deps: AlertDeps) {
  return async function listAlerts(
    access: StaffAccess,
    selectedStoreId: number | null,
    filter: { status?: string | null; severity?: string | null; alertType?: string | null },
  ) {
    const stores = storeFilter(access, 'alerts.manage', selectedStoreId)
    const status = STATUSES.find((s) => s === filter.status)
    const now = deps.clock.now()
    const [rows, counts] = await Promise.all([
      deps.alerts.list({
        stores,
        statuses: status ? [status] : ['open', 'in_progress'],
        severity: SEVERITIES.find((s) => s === filter.severity) ?? null,
        alertType: filter.alertType?.trim() || null,
        limit: 200,
      }),
      deps.alerts.counts(stores, new Date(now.getTime() - 24 * 3_600_000)),
    ])
    return { rows, counts }
  }
}

async function requireAlert(deps: AlertDeps, access: StaffAccess, alertId: number) {
  const alert = await deps.alerts.find(alertId)
  if (!alert) throw new DomainError('alert_not_found', 'alert not found')
  assertStoreAccess(access, 'alerts.manage', alert.storeId)
  return alert
}

/** A-25 「対応」: take the alert (status in_progress, assigned to the current staff member). */
export function makeAssignAlert(deps: AlertDeps) {
  return async function assignAlert(access: StaffAccess, alertId: number) {
    const alert = await requireAlert(deps, access, alertId)
    if (alert.status === 'resolved') throw new DomainError('alert_resolved', 'already resolved')
    await deps.alerts.assign(alertId, access.staffId)
    await deps.audit.record({
      actor: staffActor(access),
      action: 'alert.assign',
      targetType: 'alert',
      targetId: alertId,
      storeId: alert.storeId,
      before: { status: alert.status },
      after: { status: 'in_progress', assignedStaffId: access.staffId },
    })
  }
}

/** A-25 「解決」 */
export function makeResolveAlert(deps: AlertDeps) {
  return async function resolveAlert(access: StaffAccess, alertId: number, note: string | null) {
    const alert = await requireAlert(deps, access, alertId)
    if (alert.status === 'resolved') return
    await deps.alerts.resolveById(alertId, deps.clock.now())
    await deps.audit.record({
      actor: staffActor(access),
      action: 'alert.resolve',
      targetType: 'alert',
      targetId: alertId,
      storeId: alert.storeId,
      before: { status: alert.status },
      after: { status: 'resolved' },
      reason: note?.trim() || null,
    })
  }
}
