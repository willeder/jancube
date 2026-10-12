import {
  assertCan,
  DomainError,
  type Permission,
  type StaffAccess,
  visibleStoreIds,
} from '@jancube/domain'
import type { StoreFilter } from '../ports/admin-bookings'

/**
 * Stores a staff list/aggregate may read (F-ADM-02 row-level access).
 * `selectedStoreId` is the sidebar store selector (F-ADM-04); null = all stores the staff may see.
 */
export function storeFilter(
  access: StaffAccess,
  permission: Permission,
  selectedStoreId: number | null,
): StoreFilter {
  if (selectedStoreId !== null) {
    assertCan(access, permission, selectedStoreId)
    return [selectedStoreId]
  }
  const visible = visibleStoreIds(access, permission)
  if (visible !== null && visible.length === 0) {
    throw new DomainError('forbidden', `missing permission ${permission}`)
  }
  return visible
}

/**
 * Record-level check for a record of `storeId`. Records without a store (e.g. system-wide alerts)
 * are only for staff whose grant covers every store.
 */
export function assertStoreAccess(
  access: StaffAccess,
  permission: Permission,
  storeId: number | null,
): void {
  assertCan(access, permission, storeId)
}

export function staffActor(access: StaffAccess) {
  return { type: 'staff' as const, staffId: access.staffId }
}
