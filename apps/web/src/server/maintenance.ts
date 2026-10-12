import 'server-only'
import { DomainError } from '@jancube/domain'
import { runtimeConfig } from './runtime-config'

/** C-21 メンテナンス: customer screens and actions are stopped while MAINTENANCE_MODE is on. */
export function maintenanceStatus(): { enabled: boolean; message: string | null } {
  return runtimeConfig().maintenance
}

/** Server actions of customer screens call this first (pages are blocked by the layout). */
export function assertNotMaintenance(): void {
  if (maintenanceStatus().enabled) throw new DomainError('maintenance', 'under maintenance')
}
