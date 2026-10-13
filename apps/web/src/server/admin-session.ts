import 'server-only'
import type { StaffSession } from '@jancube/application'
import { can, type Permission, visibleStoreIds } from '@jancube/domain'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { withContainer } from './container'
import { constantTimeEqual, sign } from './session'

/**
 * Staff session: `staffId.expiresAtSeconds.signature` in an httpOnly cookie. The payload is signed
 * with a `staff:` prefix so a customer session cookie can never be replayed as a staff one.
 * Access (roles, store scope, disabled accounts) is re-read from the database on every request.
 */
const SESSION = 'jc_staff'
const STORE = 'jc_admin_store'
const SHORT_HOURS = 12
const REMEMBER_DAYS = 30

const secure = () => process.env.NODE_ENV === 'production'

export async function startStaffSession(staffId: number, remember: boolean): Promise<void> {
  const seconds = remember ? REMEMBER_DAYS * 86_400 : SHORT_HOURS * 3_600
  const expires = Math.floor(Date.now() / 1000) + seconds
  const payload = `${staffId}.${expires}`
  ;(await cookies()).set(SESSION, `${payload}.${await sign(`staff:${payload}`)}`, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: seconds,
  })
}

export async function endStaffSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION)
  jar.delete(STORE)
}

async function readStaffId(): Promise<number | null> {
  const value = (await cookies()).get(SESSION)?.value
  if (!value) return null
  const [id, expires, signature] = value.split('.')
  if (!id || !expires || !signature) return null
  if (!constantTimeEqual(signature, await sign(`staff:${id}.${expires}`))) return null
  if (Number(expires) * 1000 <= Date.now()) return null
  const staffId = Number(id)
  return Number.isSafeInteger(staffId) && staffId > 0 ? staffId : null
}

/** The signed-in staff member, or null. */
export async function currentStaff(): Promise<StaffSession | null> {
  const staffId = await readStaffId()
  if (!staffId) return null
  return withContainer((c) => c.getStaffSession(staffId))
}

/**
 * Guard for admin pages and actions: redirects to A-01 when signed out, and to the dashboard with
 * a notice when the permission is missing (row-level store checks are done per record).
 */
export async function requireStaff(permission?: Permission): Promise<StaffSession> {
  const staff = await currentStaff()
  if (!staff) redirect('/admin/login')
  if (permission && !can(staff.access, permission)) redirect('/admin?denied=1')
  return staff
}

/** Store chosen in the sidebar selector; null = all stores (only for staff with all-store scope). */
export async function selectedStoreId(
  staff: StaffSession,
  permission: Permission,
): Promise<number | null> {
  const visible = visibleStoreIds(staff.access, permission)
  const raw = (await cookies()).get(STORE)?.value
  const chosen = raw && raw !== 'all' ? Number(raw) : null
  if (visible === null) return chosen
  if (chosen !== null && visible.includes(chosen)) return chosen
  return visible[0] ?? -1
}

export async function writeSelectedStore(value: string): Promise<void> {
  ;(await cookies()).set(STORE, value, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: REMEMBER_DAYS * 86_400,
  })
}
