import {
  assertRoleGrants,
  DomainError,
  isOwner,
  normalizeStaffEmail,
  type RoleCode,
  type RoleGrant,
} from '@jancube/domain'
import type { StaffAdminRepository, StaffAdminRow } from '../ports/admin-masters'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import { assertAllStores, auditActor, requireText, type StaffActor } from './admin-actor'

export interface StaffAdminDeps {
  readonly staffAdmin: StaffAdminRepository
  /** A-23 invitation email (`makeSendStaffInvite`). */
  readonly sendInvite: (staffId: number, inviteUrl: (token: string) => string) => Promise<void>
  readonly audit: AuditLog
  readonly clock: Clock
}

export const ROLE_LABELS: Readonly<Record<RoleCode, string>> = {
  owner: 'オーナー',
  admin: '本部管理者',
  cleaning: '清掃担当',
}

const grantsForAudit = (grants: readonly RoleGrant[]) =>
  grants.map((g) => ({ role: g.role, storeId: g.storeId }))

/** Administrators can manage cleaning accounts; owner/admin account authority stays with owners. */
function assertAccountAuthority(actor: StaffActor, grants: readonly RoleGrant[]) {
  if (
    !isOwner(actor.access.grants) &&
    grants.some((g) => g.role === 'owner' || g.role === 'admin')
  ) {
    throw new DomainError('forbidden', 'only owners can manage administrator accounts')
  }
}

async function loadStaff(deps: StaffAdminDeps, staffId: number): Promise<StaffAdminRow> {
  const staff = await deps.staffAdmin.find(staffId)
  if (!staff) throw new DomainError('staff_not_found', 'staff not found')
  return staff
}

/** The last active owner cannot lose the owner role or be disabled (someone must manage staff). */
async function assertOtherActiveOwner(deps: StaffAdminDeps, staffId: number) {
  const owners = await deps.staffAdmin.activeOwnerIds()
  if (!owners.some((id) => id !== staffId)) {
    throw new DomainError('last_owner', 'at least one active owner is required')
  }
}

/** A-23 スタッフ一覧 (owners only: staff.manage). */
export function makeListStaff(deps: StaffAdminDeps) {
  return async function listStaff(actor: StaffActor) {
    assertAllStores(actor, 'staff.manage')
    return deps.staffAdmin.list()
  }
}

export function makeGetStaff(deps: StaffAdminDeps) {
  return async function getStaff(actor: StaffActor, staffId: number) {
    assertAllStores(actor, 'staff.manage')
    return loadStaff(deps, staffId)
  }
}

/** A-23 招待: creates the account (status invited) and emails a 7-day password link. */
export function makeInviteStaff(deps: StaffAdminDeps) {
  return async function inviteStaff(
    actor: StaffActor,
    input: { email: string; name: string; grants: readonly RoleGrant[] },
    inviteUrl: (token: string) => string,
  ): Promise<number> {
    assertAllStores(actor, 'staff.manage')
    const email = normalizeStaffEmail(input.email)
    const name = requireText(input.name, 'name_required', 100)
    assertRoleGrants(input.grants)
    assertAccountAuthority(actor, input.grants)
    if (await deps.staffAdmin.emailTaken(email)) {
      throw new DomainError('staff_email_taken', 'this email is already registered')
    }
    const staffId = await deps.staffAdmin.create({
      email,
      name,
      grants: input.grants,
      grantedBy: actor.staffId,
    })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'staff.create',
      targetType: 'staff',
      targetId: staffId,
      after: { email, name, status: 'invited', grants: grantsForAudit(input.grants) },
    })
    await deps.sendInvite(staffId, inviteUrl)
    return staffId
  }
}

/** A-23 編集: name and role grants (per store; owner/admin may cover every store). */
export function makeUpdateStaff(deps: StaffAdminDeps) {
  return async function updateStaff(
    actor: StaffActor,
    staffId: number,
    input: { name: string; grants: readonly RoleGrant[] },
  ): Promise<void> {
    assertAllStores(actor, 'staff.manage')
    const before = await loadStaff(deps, staffId)
    assertAccountAuthority(actor, before.grants)
    const name = requireText(input.name, 'name_required', 100)
    assertRoleGrants(input.grants)
    assertAccountAuthority(actor, input.grants)
    if (before.status === 'active' && isOwner(before.grants) && !isOwner(input.grants)) {
      await assertOtherActiveOwner(deps, staffId)
    }
    await deps.staffAdmin.updateName(staffId, name)
    await deps.staffAdmin.replaceGrants(staffId, input.grants, actor.staffId)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'staff.update',
      targetType: 'staff',
      targetId: staffId,
      before: { name: before.name, grants: grantsForAudit(before.grants) },
      after: { name, grants: grantsForAudit(input.grants) },
    })
  }
}

/**
 * A-23 無効化 / 有効化. Disabled staff are signed out on their next request (the session re-reads
 * the account). Re-enabling an account that never set a password returns it to `invited`.
 */
export function makeSetStaffEnabled(deps: StaffAdminDeps) {
  return async function setStaffEnabled(
    actor: StaffActor,
    staffId: number,
    enabled: boolean,
  ): Promise<void> {
    assertAllStores(actor, 'staff.manage')
    const before = await loadStaff(deps, staffId)
    assertAccountAuthority(actor, before.grants)
    if (!enabled) {
      if (staffId === actor.staffId) {
        throw new DomainError('cannot_disable_self', 'you cannot disable your own account')
      }
      if (before.status === 'disabled') return
      if (before.status === 'active' && isOwner(before.grants)) {
        await assertOtherActiveOwner(deps, staffId)
      }
    } else if (before.status !== 'disabled') {
      return
    }
    const status = !enabled ? 'disabled' : before.hasPassword ? 'active' : 'invited'
    await deps.staffAdmin.setStatus(staffId, status)
    await deps.audit.record({
      actor: auditActor(actor),
      action: enabled ? 'staff.enable' : 'staff.disable',
      targetType: 'staff',
      targetId: staffId,
      before: { status: before.status },
      after: { status },
    })
  }
}

/** A-23 招待メール再送 (invited accounts only; earlier links stay valid until they expire). */
export function makeResendStaffInvite(deps: StaffAdminDeps) {
  return async function resendStaffInvite(
    actor: StaffActor,
    staffId: number,
    inviteUrl: (token: string) => string,
  ): Promise<void> {
    assertAllStores(actor, 'staff.manage')
    const target = await loadStaff(deps, staffId)
    assertAccountAuthority(actor, target.grants)
    await deps.sendInvite(staffId, inviteUrl)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'staff.invite_resend',
      targetType: 'staff',
      targetId: staffId,
    })
  }
}
