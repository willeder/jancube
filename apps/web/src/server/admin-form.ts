import 'server-only'
import { endOfLocalDate, type StaffSession, startOfLocalDate } from '@jancube/application'
import {
  type CouponVersionDraft,
  DomainError,
  type Permission,
  type PriceTimeRuleDraft,
  type PriceVersionDraft,
  parseClock,
  parseLocalDate,
  type RoleCode,
  type RoleGrant,
  type StoreDraft,
} from '@jancube/domain'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireStaff } from './admin-session'
import { type Container, withContainer } from './container'
import { toAdminMessage } from './errors'

/** State of admin forms (useActionState). */
export type AdminFormState = { error: string | null; message?: string | null }

/**
 * Runs an admin mutation: permission guard (redirects when signed out or not allowed), the use case
 * (which repeats the permission and store-scope check), then revalidation / redirect on success.
 */
export async function adminMutation<T>(
  permission: Permission,
  run: (c: Container, staff: StaffSession) => Promise<T>,
  options: {
    message?: string
    revalidate?: string | readonly string[]
    redirectTo?: (result: T) => string
  } = {},
): Promise<AdminFormState> {
  const staff = await requireStaff(permission)
  let result: T
  try {
    result = await withContainer((c) => run(c, staff))
  } catch (error) {
    return { error: toAdminMessage(error) }
  }
  const paths = typeof options.revalidate === 'string' ? [options.revalidate] : options.revalidate
  for (const path of paths ?? []) revalidatePath(path)
  if (options.redirectTo) redirect(options.redirectTo(result))
  return { error: null, message: options.message ?? '保存しました' }
}

// ---------------------------------------------------------------- field parsing

export const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim()

export const optional = (form: FormData, name: string) => text(form, name) || null

export const checked = (form: FormData, name: string) => form.get(name) === 'on'

const invalidNumber = (name: string) =>
  new DomainError('invalid_request', `${name} must be a number`)

export function int(form: FormData, name: string): number {
  const raw = text(form, name).replace(/[,，]/g, '')
  const value = Number(raw)
  if (raw === '' || !Number.isInteger(value)) throw invalidNumber(name)
  return value
}

export function optionalInt(form: FormData, name: string): number | null {
  return text(form, name) === '' ? null : int(form, name)
}

export function num(form: FormData, name: string): number {
  const raw = text(form, name)
  const value = Number(raw)
  if (raw === '' || !Number.isFinite(value)) throw invalidNumber(name)
  return value
}

export function ids(form: FormData, name: string): number[] {
  return form
    .getAll(name)
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0)
}

export function localDate(form: FormData, name: string): string {
  const value = text(form, name)
  parseLocalDate(value)
  return value
}

/** Weekday checkboxes (`weekday` = 0..6) → bit mask (bit 0 = Sunday). */
export function weekdayMask(form: FormData, name = 'weekday'): number {
  return form.getAll(name).reduce<number>((mask, v) => mask | (1 << Number(v)), 0)
}

/** "HH:MM" or empty → minutes / null. */
export function clock(form: FormData, name: string): number | null {
  const value = text(form, name)
  return value ? parseClock(value) : null
}

/** A-14 coupon version fields (see CouponVersionFields). */
export function couponVersionFromForm(form: FormData): CouponVersionDraft {
  const discountType = text(form, 'discountType') === 'amount' ? 'amount' : 'percent'
  return {
    discountType,
    discountValue: num(form, 'discountValue'),
    maximumDiscount: discountType === 'percent' ? optionalInt(form, 'maximumDiscount') : null,
    minimumSpend: optionalInt(form, 'minimumSpend') ?? 0,
    maxUses: int(form, 'maxUses'),
    validFrom: startOfLocalDate(localDate(form, 'validFrom')),
    validTo: endOfLocalDate(localDate(form, 'validTo')),
    weekdayMask: weekdayMask(form),
    startMinute: clock(form, 'startTime'),
    endMinute: clock(form, 'endTime'),
    grantTrigger: text(form, 'grantTrigger') as CouponVersionDraft['grantTrigger'],
    stackable: checked(form, 'stackable'),
    conditionsNote: optional(form, 'conditionsNote'),
    storeIds: ids(form, 'storeIds'),
    roomTypeIds: ids(form, 'roomTypeIds'),
  }
}

/**
 * A-16 price version fields: packages as lines "minutes,price" in hours ("4h,5800" or "240,5800"),
 * time rules as rows of inputs (rule_* arrays).
 */
export function priceVersionFromForm(form: FormData): PriceVersionDraft {
  const packages = text(form, 'packages')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [length = '', price = ''] = line.split(/[,，\s]+/)
      const hours = length.match(/^(\d+(?:\.5)?)h$/i)
      const minutes = hours ? Number(hours[1]) * 60 : Number(length)
      return { minutes, price: Number(price.replace(/[¥円]/g, '')) }
    })
  const ruleWeekdays = form.getAll('ruleWeekdays').map(String)
  const ruleStarts = form.getAll('ruleStart').map(String)
  const ruleEnds = form.getAll('ruleEnd').map(String)
  const ruleDiscounts = form.getAll('ruleDiscount').map(String)
  const ruleHolidays = form.getAll('ruleHoliday').map(String)
  const timeRules: PriceTimeRuleDraft[] = []
  ruleDiscounts.forEach((discount, i) => {
    if (!discount.trim()) return
    const days = (ruleWeekdays[i] ?? '').split('').filter((d) => /[0-6]/.test(d))
    timeRules.push({
      weekdayMask: days.reduce((mask, d) => mask | (1 << Number(d)), 0),
      holidayMode: (['any', 'only', 'exclude'].find((m) => m === ruleHolidays[i]) ??
        'any') as PriceTimeRuleDraft['holidayMode'],
      startMinute: ruleStarts[i]?.trim() ? parseClock(ruleStarts[i] as string) : null,
      endMinute: ruleEnds[i]?.trim() ? parseClock(ruleEnds[i] as string) : null,
      hourlyDiscount: Number(discount),
      priority: i + 1,
    })
  })
  return {
    hourlyRate: int(form, 'hourlyRate'),
    minimumMinutes: int(form, 'minimumMinutes'),
    taxRatePercent: num(form, 'taxRate'),
    validFrom: startOfLocalDate(localDate(form, 'validFrom')),
    packages,
    timeRules,
  }
}

/** A-18 store fields (see StoreFields). */
export function storeDraftFromForm(form: FormData): StoreDraft {
  return {
    name: text(form, 'name'),
    address: text(form, 'address'),
    phone: optional(form, 'phone'),
    accessText: optional(form, 'accessText'),
    noticeText: optional(form, 'noticeText'),
    mapUrl: optional(form, 'mapUrl'),
    entryGuideUrl: optional(form, 'entryGuideUrl'),
    entryGuideText: optional(form, 'entryGuideText'),
    bookingOpenDate: localDate(form, 'bookingOpenDate'),
    bookingHorizonDays: int(form, 'bookingHorizonDays'),
    holdMinutes: int(form, 'holdMinutes'),
    proxyHoldMinutes: int(form, 'proxyHoldMinutes'),
    cleaningBufferMinutes: int(form, 'cleaningBufferMinutes'),
    roomFinalizeMinutes: optionalInt(form, 'roomFinalizeMinutes'),
    keyBeforeMinutes: int(form, 'keyBeforeMinutes'),
    keyAfterMinutes: int(form, 'keyAfterMinutes'),
    status: text(form, 'status') as StoreDraft['status'],
    isActive: checked(form, 'isActive'),
  }
}

/** A-23 role rows: `grantRole[i]` with `grantStore[i]` ('all' = every store). */
export function grantsFromForm(form: FormData): RoleGrant[] {
  const roles = form.getAll('grantRole').map(String)
  const stores = form.getAll('grantStore').map(String)
  return roles.flatMap((role, i) => {
    if (!role) return []
    const store = stores[i] ?? 'all'
    return [{ role: role as RoleCode, storeId: store === 'all' || !store ? null : Number(store) }]
  })
}

/** Photo lines "URL" or "URL | alt text". */
export function photosFromForm(form: FormData): { url: string; alt: string | null }[] {
  return text(form, 'photos')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [url = '', ...alt] = line.split('|')
      return { url: url.trim(), alt: alt.join('|').trim() || null }
    })
}

/** Origin of the current request, for links in emails (invitation). */
export async function requestOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
