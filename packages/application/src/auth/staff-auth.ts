import { addMinutes, assertStaffPassword, DomainError, type StaffAccess } from '@jancube/domain'
import type { Clock } from '../ports/clock'
import type { RandomSource, SecretHasher } from '../ports/member-repository'
import type { EmailSender } from '../ports/messaging'
import type { AuditLog } from '../ports/ops'
import type { PasswordHasher, StaffRecord, StaffRepository } from '../ports/staff-repository'

export interface StaffAuthDeps {
  readonly staff: StaffRepository
  readonly passwords: PasswordHasher
  readonly tokens: SecretHasher
  readonly random: RandomSource
  readonly email: EmailSender
  readonly audit: AuditLog
  readonly clock: Clock
}

export interface StaffSession {
  readonly staffId: number
  readonly name: string
  readonly email: string
  readonly access: StaffAccess
}

const RESET_TOKEN_MINUTES = 60
const INVITE_TOKEN_MINUTES = 7 * 24 * 60

const toSession = (s: StaffRecord): StaffSession => ({
  staffId: s.id,
  name: s.name,
  email: s.email,
  access: { staffId: s.id, grants: s.grants },
})

/** A-01: email + password sign-in. The same error for every failure, so accounts cannot be probed. */
export function makeStaffSignIn(deps: StaffAuthDeps) {
  return async function staffSignIn(email: string, password: string): Promise<StaffSession> {
    const staff = await deps.staff.findByEmail(email.trim().toLowerCase())
    const ok =
      staff?.status === 'active' &&
      staff.passwordHash !== null &&
      (await deps.passwords.verify(password, staff.passwordHash))
    if (!staff || !ok) {
      // Spend comparable time when the account does not exist.
      if (!staff) await deps.passwords.hash(password)
      throw new DomainError('invalid_credentials', 'email or password is incorrect')
    }
    const now = deps.clock.now()
    await deps.staff.recordLogin(staff.id, now)
    await deps.audit.record({
      actor: { type: 'staff', staffId: staff.id },
      action: 'staff.sign_in',
      targetType: 'staff',
      targetId: staff.id,
    })
    return toSession(staff)
  }
}

/** Current access of a signed-in staff member; null when disabled or removed (session revoked). */
export function makeGetStaffSession(deps: Pick<StaffAuthDeps, 'staff'>) {
  return async function getStaffSession(staffId: number): Promise<StaffSession | null> {
    const staff = await deps.staff.findById(staffId)
    return staff?.status === 'active' ? toSession(staff) : null
  }
}

async function issueToken(
  deps: StaffAuthDeps,
  staffId: number,
  purpose: 'invite' | 'password_reset',
  minutes: number,
) {
  const token = deps.random.token()
  await deps.staff.createToken({
    staffId,
    purpose,
    tokenHash: await deps.tokens.hash(`${purpose}:${token}`),
    expiresAt: addMinutes(deps.clock.now(), minutes),
  })
  return token
}

/** A-30: email a one-hour reset link. Silent for unknown addresses. */
export function makeRequestPasswordReset(deps: StaffAuthDeps) {
  return async function requestPasswordReset(email: string, resetUrl: (token: string) => string) {
    const staff = await deps.staff.findByEmail(email.trim().toLowerCase())
    if (!staff || staff.status === 'disabled') return
    const token = await issueToken(deps, staff.id, 'password_reset', RESET_TOKEN_MINUTES)
    await deps.email.send({
      to: staff.email,
      subject: '【雀CUBE管理画面】パスワード再設定',
      text: `${staff.name} 様\n\n下記のリンクから60分以内にパスワードを再設定してください。\n${resetUrl(token)}\n\nお心当たりがない場合は、このメールを破棄してください。`,
    })
  }
}

/** A-23: invitation email for a new staff account (valid 7 days). */
export function makeSendStaffInvite(deps: StaffAuthDeps) {
  return async function sendStaffInvite(staffId: number, inviteUrl: (token: string) => string) {
    const staff = await deps.staff.findById(staffId)
    if (staff?.status !== 'invited') throw new DomainError('staff_not_invitable', 'not invitable')
    const token = await issueToken(deps, staff.id, 'invite', INVITE_TOKEN_MINUTES)
    await deps.email.send({
      to: staff.email,
      subject: '【雀CUBE管理画面】アカウントのご案内',
      text: `${staff.name} 様\n\n雀CUBE管理画面のアカウントが作成されました。下記のリンクからパスワードを設定してください（7日間有効）。\n${inviteUrl(token)}`,
    })
  }
}

/** A-30 / invitation: set a new password with a one-time token. */
export function makeSetPasswordWithToken(deps: StaffAuthDeps) {
  return async function setPasswordWithToken(
    token: string,
    purpose: 'invite' | 'password_reset',
    newPassword: string,
  ): Promise<void> {
    assertStaffPassword(newPassword)
    const staffId = await deps.staff.consumeToken(
      await deps.tokens.hash(`${purpose}:${token}`),
      purpose,
      deps.clock.now(),
    )
    if (!staffId) throw new DomainError('token_invalid', 'the link is invalid or has expired')
    await deps.staff.setPassword(staffId, await deps.passwords.hash(newPassword), true)
    await deps.audit.record({
      actor: { type: 'staff', staffId },
      action: purpose === 'invite' ? 'staff.accept_invite' : 'staff.reset_password',
      targetType: 'staff',
      targetId: staffId,
    })
  }
}
