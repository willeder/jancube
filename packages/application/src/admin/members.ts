import { assertCan, can, DomainError, type Permission, visibleStoreIds } from '@jancube/domain'
import type { MemberAdminRepository, MemberProfileView } from '../ports/admin-masters'
import type { Clock } from '../ports/clock'
import type { MemberStatus } from '../ports/member-repository'
import type { AuditLog } from '../ports/ops'
import { auditActor, requireText, type StaffActor } from './admin-actor'

export interface MemberAdminDeps {
  readonly members: MemberAdminRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

export const MEMBER_PAGE_SIZE = 50

/** Statuses staff can set (F-AUTH-08). Withdrawal is a separate flow (C-17). */
export const STAFF_SETTABLE_MEMBER_STATUSES = ['active', 'caution', 'suspended'] as const
type SettableStatus = (typeof STAFF_SETTABLE_MEMBER_STATUSES)[number]

const MEMBER_STATUSES: readonly MemberStatus[] = ['active', 'caution', 'suspended', 'withdrawn']

/**
 * Row-level member access (CQ-45, assumption to confirm): staff with an all-store grant see every
 * member; store-scoped staff see members who have booked at one of their stores. Others get
 * "not found" so member codes cannot be probed.
 */
export async function loadVisibleMember(
  deps: Pick<MemberAdminDeps, 'members'>,
  actor: StaffActor,
  memberCode: string,
  permission: Permission,
): Promise<MemberProfileView> {
  assertCan(actor.access, permission)
  const member = await deps.members.findByCode(memberCode.trim())
  if (!member) throw new DomainError('member_not_found', 'member not found')
  const stores = visibleStoreIds(actor.access, permission)
  if (stores !== null && !(await deps.members.hasBookingAt(member.id, stores))) {
    throw new DomainError('member_not_found', 'member not visible to this staff member')
  }
  return member
}

/** Partial phone input ("090-1234", "+81 90…") → national digits without the leading 0. */
export function phoneDigits(text: string): string | null {
  if (!/^[\d\s\-+()（）ー－]+$/.test(text)) return null
  let digits = text.replace(/\D/g, '')
  if (digits.startsWith('81') && text.trim().startsWith('+')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  return digits.length >= 3 ? digits : null
}

/** A-11 会員一覧: search by name / phone / member code / email, filter by status and LINE link. */
export function makeSearchMembers(deps: MemberAdminDeps) {
  return async function searchMembers(
    actor: StaffActor,
    input: { query?: string; status?: string; line?: string; page?: number },
  ) {
    assertCan(actor.access, 'members.view')
    const text = input.query?.trim().slice(0, 100) || null
    const digits = text ? phoneDigits(text) : null
    const page = Math.max(1, Math.floor(input.page ?? 1) || 1)
    const result = await deps.members.search({
      text,
      phoneDigits: digits,
      status: MEMBER_STATUSES.find((s) => s === input.status) ?? null,
      line: input.line === 'linked' || input.line === 'unlinked' ? input.line : null,
      storeIds: visibleStoreIds(actor.access, 'members.view'),
      offset: (page - 1) * MEMBER_PAGE_SIZE,
      limit: MEMBER_PAGE_SIZE,
    })
    return { ...result, page, pageSize: MEMBER_PAGE_SIZE }
  }
}

/** A-12 会員詳細: profile, bookings, payments, coupons, consents and CS notes. */
export function makeGetMemberDetail(deps: MemberAdminDeps) {
  return async function getMemberDetail(actor: StaffActor, memberCode: string) {
    const member = await loadVisibleMember(deps, actor, memberCode, 'members.view')
    const stores = visibleStoreIds(actor.access, 'members.view')
    const [bookings, payments, coupons, consents, notes] = await Promise.all([
      deps.members.bookings(member.id, stores),
      deps.members.payments(member.id, stores),
      deps.members.coupons(member.id),
      deps.members.consents(member.id),
      deps.members.notes(member.id),
    ])
    return {
      member,
      bookings,
      payments,
      coupons,
      consents,
      notes,
      canManage: can(actor.access, 'members.manage'),
    }
  }
}

/** A-12 状態変更 (F-AUTH-08): active / caution / suspended, with a reason kept in the audit log. */
export function makeChangeMemberStatus(deps: MemberAdminDeps) {
  return async function changeMemberStatus(
    actor: StaffActor,
    input: { memberCode: string; status: string; reason: string },
  ): Promise<void> {
    const member = await loadVisibleMember(deps, actor, input.memberCode, 'members.manage')
    const status = STAFF_SETTABLE_MEMBER_STATUSES.find((s) => s === input.status) as
      | SettableStatus
      | undefined
    if (!status) throw new DomainError('invalid_member_status', 'unknown status')
    if (member.status === 'withdrawn') {
      throw new DomainError('member_withdrawn', 'withdrawn members cannot be changed')
    }
    const reason = requireText(input.reason, 'reason_required', 500)
    const previous = member.status
    if (previous === status) return
    await deps.members.setStatus(member.id, status)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'member.status_change',
      targetType: 'member',
      targetId: member.id,
      targetCode: member.memberCode,
      before: { status: previous },
      after: { status },
      reason,
    })
  }
}

/** A-12 対応ログ(CS) の追加. */
export function makeAddMemberNote(deps: MemberAdminDeps) {
  return async function addMemberNote(
    actor: StaffActor,
    input: { memberCode: string; body: string; bookingCode?: string | null },
  ): Promise<number> {
    const member = await loadVisibleMember(deps, actor, input.memberCode, 'members.manage')
    const body = requireText(input.body, 'note_required', 2000)
    const code = input.bookingCode?.trim()
    const bookingId = code ? await deps.members.bookingIdForMember(member.id, code) : null
    if (code && bookingId === null) throw new DomainError('booking_not_found', 'booking not found')
    const noteId = await deps.members.addNote({
      memberId: member.id,
      staffId: actor.staffId,
      bookingId,
      body,
      occurredAt: deps.clock.now(),
    })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'member.note_add',
      targetType: 'member',
      targetId: member.id,
      targetCode: member.memberCode,
      after: { noteId, bookingCode: code || null },
    })
    return noteId
  }
}
