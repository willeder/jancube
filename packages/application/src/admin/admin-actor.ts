import {
  addDays,
  assertCan,
  DomainError,
  type LocalDate,
  localToUtc,
  type Permission,
  type StaffAccess,
  utcToLocal,
  visibleStoreIds,
} from '@jancube/domain'
import type { Actor } from '../ports/ops'

/** The signed-in staff member performing an admin operation (from the staff session). */
export interface StaffActor {
  readonly staffId: number
  readonly access: StaffAccess
}

export const auditActor = (actor: StaffActor): Actor => ({ type: 'staff', staffId: actor.staffId })

/** Masters shared by every store (room types, new stores, …) need an all-store grant. */
export function assertAllStores(actor: StaffActor, permission: Permission): void {
  assertCan(actor.access, permission)
  if (visibleStoreIds(actor.access, permission) !== null) {
    throw new DomainError('forbidden', `${permission} for all stores is required`)
  }
}

/** Store-scoped check: the permission must cover this store. */
export function assertStore(actor: StaffActor, permission: Permission, storeId: number): void {
  assertCan(actor.access, permission, storeId)
}

/** Operator time zone for admin date inputs and customer-facing dates (all stores are in Japan). */
export const ADMIN_TIME_ZONE = 'Asia/Tokyo'

/** Start of a local date (00:00 Asia/Tokyo) as an instant. */
export const startOfLocalDate = (date: LocalDate): Date => localToUtc(date, 0, ADMIN_TIME_ZONE)

/** An inclusive "until" date → the exclusive end instant (next day 00:00). */
export const endOfLocalDate = (date: LocalDate): Date =>
  localToUtc(addDays(date, 1), 0, ADMIN_TIME_ZONE)

/** Today's local date. */
export const localToday = (now: Date): LocalDate => utcToLocal(now, ADMIN_TIME_ZONE).date

/** "2026年9月30日" for an exclusive end instant (shows the last valid day). */
export function formatExpiryDate(exclusiveEnd: Date): string {
  const { date } = utcToLocal(new Date(exclusiveEnd.getTime() - 1), ADMIN_TIME_ZONE)
  const [y, m, d] = date.split('-').map(Number)
  return `${y}年${m}月${d}日`
}

export function requireText(value: string, code: string, max: number): string {
  const text = value.trim()
  if (!text || text.length > max) throw new DomainError(code, `required, at most ${max} characters`)
  return text
}

export function optionalText(value: string | null | undefined, max: number): string | null {
  const text = value?.trim() ?? ''
  if (!text) return null
  if (text.length > max) throw new DomainError('text_too_long', `at most ${max} characters`)
  return text
}

/** Client-generated request keys (form tokens) that make retries idempotent. */
export function assertRequestKey(key: string): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
    throw new DomainError('invalid_request', 'missing or malformed request key')
  }
}
