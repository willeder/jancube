import { DomainError } from '../shared/errors'
import { GLOBAL_ROLES, ROLES, type RoleGrant } from './permissions'

/**
 * Role grants of one staff member (A-23): at least one; owner/admin may cover every store
 * (storeId null), other roles must name a store; no duplicates.
 */
export function assertRoleGrants(grants: readonly RoleGrant[]): void {
  if (grants.length === 0) throw new DomainError('invalid_grants', 'grant at least one role')
  const seen = new Set<string>()
  for (const g of grants) {
    if (!ROLES.includes(g.role)) throw new DomainError('invalid_grants', `unknown role ${g.role}`)
    if (g.storeId === null && !GLOBAL_ROLES.includes(g.role)) {
      throw new DomainError('store_required', `${g.role} must be granted per store`)
    }
    const key = `${g.role}:${g.storeId ?? 'all'}`
    if (seen.has(key)) throw new DomainError('invalid_grants', `duplicate grant ${key}`)
    seen.add(key)
  }
}

export function isOwner(grants: readonly RoleGrant[]): boolean {
  return grants.some((g) => g.role === 'owner')
}

/** Staff login emails: trimmed, lower-case, plain ASCII address. */
export function normalizeStaffEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) {
    throw new DomainError('invalid_email', 'invalid email address')
  }
  return normalized
}
