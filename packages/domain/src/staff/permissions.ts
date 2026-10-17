import { DomainError } from '../shared/errors'

/**
 * Operator roles (confirmed tracker 2026-10-15: owner / admin / cleaning).
 * Kept as data in `roles` / `role_permissions`; these constants are the seed and the code contract.
 */
export const ROLES = ['owner', 'admin', 'cleaning'] as const
export type RoleCode = (typeof ROLES)[number]

export const PERMISSIONS = [
  'dashboard.view',
  'bookings.view',
  'bookings.manage', // proxy booking, reassignment, immediate confirmation, blocks
  'bookings.cancel', // cancellation and refunds
  'keys.manage',
  'cleaning.view',
  'cleaning.work', // K-01〜K-03
  'members.view',
  'members.manage', // status changes, notes, individual coupons
  'coupons.manage',
  'prices.manage',
  'stores.manage', // stores, rooms, lock devices, embed codes
  'notifications.manage',
  'staff.manage',
  'audit.view',
  'alerts.manage',
  'payments.view',
  'reports.export',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ALL = PERMISSIONS
export const ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly Permission[]>> = {
  owner: ALL,
  admin: ALL,
  cleaning: ['cleaning.view', 'cleaning.work'],
}

/** Roles that may be granted for all stores at once (`roles.allow_global_scope`). */
export const GLOBAL_ROLES: readonly RoleCode[] = ['owner', 'admin']

export interface RoleGrant {
  readonly role: RoleCode
  /** null = every store */
  readonly storeId: number | null
}

export interface StaffAccess {
  readonly staffId: number
  readonly grants: readonly RoleGrant[]
}

/** Row-level access (F-ADM-02): a permission applies only to the stores it was granted for. */
export function can(access: StaffAccess, permission: Permission, storeId?: number | null): boolean {
  return access.grants.some(
    (g) =>
      ROLE_PERMISSIONS[g.role].includes(permission) &&
      (g.storeId === null || storeId === undefined || g.storeId === storeId),
  )
}

export function assertCan(access: StaffAccess, permission: Permission, storeId?: number | null) {
  if (!can(access, permission, storeId)) {
    throw new DomainError('forbidden', `missing permission ${permission}`)
  }
}

/** Stores the staff member may see for a permission; null = all stores. */
export function visibleStoreIds(access: StaffAccess, permission: Permission): number[] | null {
  const grants = access.grants.filter((g) => ROLE_PERMISSIONS[g.role].includes(permission))
  if (grants.some((g) => g.storeId === null)) return null
  return [...new Set(grants.map((g) => g.storeId as number))]
}

/** Staff passwords: at least 12 characters with letters and digits (FR-9.10). */
export function assertStaffPassword(password: string): void {
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new DomainError(
      'weak_password',
      'use at least 12 characters including letters and numbers',
    )
  }
}
