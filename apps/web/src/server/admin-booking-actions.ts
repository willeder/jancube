'use server'

import type { EndOption, OccupyingBookingRef, ProxyBookingResult } from '@jancube/application'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireStaff } from './admin-session'
import type { ActionResult } from './booking-actions'
import { withContainer } from './container'
import { toUserMessage } from './errors'

/** Path on this site to return to after a form post (never an external URL). */
function backTo(form: FormData, fallback: string): string {
  const back = String(form.get('back') ?? '')
  return back.startsWith('/admin') ? back : fallback
}

const withFlag = (path: string, flag: string) => {
  const base = path.replace(/\?$/, '')
  return `${base}${base.includes('?') ? '&' : '?'}${flag}`
}

// ---------------------------------------------------------------- A-06 代理予約

/** A-06: end times and prices for a chosen start (same as C-03). */
export async function adminEndOptionsAction(input: {
  storeCode: string
  date: string
  laneKey: string
  start: string
}): Promise<ActionResult<EndOption[]>> {
  await requireStaff('bookings.manage')
  try {
    return { ok: true, data: await withContainer((c) => c.adminEndOptions(input)) }
  } catch (error) {
    return { ok: false, error: toUserMessage(error) }
  }
}

/** A-06 「電話番号で検索」 */
export async function lookupMemberAction(
  phone: string,
): Promise<ActionResult<{ memberCode: string; name: string; canBook: boolean } | null>> {
  const staff = await requireStaff('bookings.manage')
  try {
    return {
      ok: true,
      data: await withContainer((c) => c.lookupMemberByPhone(staff.access, phone)),
    }
  } catch (error) {
    return { ok: false, error: toUserMessage(error) }
  }
}

export type ProxyBookingState = {
  error: string | null
  result?: Omit<ProxyBookingResult, 'expiresAt'> & { expiresAt: string }
}

/** A-06 「仮押さえして決済リンクを発行」 */
export async function createProxyBookingAction(
  _prev: ProxyBookingState,
  form: FormData,
): Promise<ProxyBookingState> {
  const staff = await requireStaff('bookings.manage')
  try {
    const result = await withContainer((c) =>
      c.createProxyBooking(staff.access, {
        storeCode: String(form.get('storeCode') ?? ''),
        date: String(form.get('date') ?? ''),
        laneKey: String(form.get('laneKey') ?? ''),
        start: String(form.get('start') ?? ''),
        end: String(form.get('end') ?? ''),
        guestCount: Number(form.get('guestCount')),
        phone: String(form.get('phone') ?? ''),
        familyName: String(form.get('familyName') ?? ''),
        givenName: String(form.get('givenName') ?? ''),
      }),
    )
    revalidatePath('/admin/bookings/new')
    return { error: null, result: { ...result, expiresAt: result.expiresAt.toISOString() } }
  } catch (error) {
    return { error: toUserMessage(error) }
  }
}

// ---------------------------------------------------------------- A-05 / A-08

/** A-05 「通知を再送」 */
export async function resendNotificationAction(form: FormData): Promise<void> {
  const staff = await requireStaff('bookings.manage')
  const back = backTo(form, '/admin/bookings')
  let flag = 'resent=1'
  try {
    await withContainer((c) => c.resendNotification(staff.access, Number(form.get('deliveryId'))))
  } catch (error) {
    flag = `error=${encodeURIComponent(toUserMessage(error))}`
  }
  redirect(withFlag(back, flag))
}

export type CancelState = {
  error: string | null
  result?: { fee: number; refund: number; feeRate: number; refundFailed: boolean }
}

/** A-08 「キャンセルと返金を実行」 */
export async function staffCancelAction(_prev: CancelState, form: FormData): Promise<CancelState> {
  const staff = await requireStaff('bookings.cancel')
  const override = form.get('override') === 'on'
  const rate = String(form.get('feeRate') ?? '').trim()
  if (override && (rate === '' || Number.isNaN(Number(rate)))) {
    return { error: 'キャンセル料率は0〜100%で入力してください' }
  }
  try {
    const result = await withContainer((c) =>
      c.staffCancelBooking(staff.access, {
        bookingCode: String(form.get('bookingCode') ?? ''),
        overrideFeeRate: override ? Number(rate) : null,
        reason: String(form.get('reason') ?? '') || null,
      }),
    )
    return {
      error: null,
      result: {
        fee: result.fee,
        refund: result.refund,
        feeRate: result.feeRate,
        refundFailed: result.refundFailed,
      },
    }
  } catch (error) {
    return { error: toUserMessage(error) }
  }
}

// ---------------------------------------------------------------- A-22 枠ブロック

export type BlockState = {
  error: string | null
  created?: number
  conflicts?: (Omit<OccupyingBookingRef, 'start' | 'end'> & {
    roomName: string
    start: string
    end: string
  })[]
}

/** A-22 「ブロックを追加」 */
export async function createBlockAction(_prev: BlockState, form: FormData): Promise<BlockState> {
  const staff = await requireStaff('bookings.manage')
  const allDay = form.get('allDay') === 'on'
  const room = String(form.get('roomId') ?? '')
  const toMinute = (name: string) => {
    const [h, m] = String(form.get(name) ?? '')
      .split(':')
      .map(Number)
    return h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)
      ? null
      : h * 60 + m
  }
  const start = toMinute('start')
  let end = toMinute('end')
  // An end at or before the start means the block runs past midnight (business day closes late).
  if (start !== null && end !== null && end <= start) end += 1440
  try {
    const result = await withContainer((c) =>
      c.createRoomBlock(staff.access, {
        storeId: Number(form.get('storeId')),
        roomId: room === 'all' ? 'all' : Number(room),
        dateFrom: String(form.get('dateFrom') ?? ''),
        dateTo: String(form.get('dateTo') || form.get('dateFrom') || ''),
        allDay,
        startMinute: allDay ? null : start,
        endMinute: allDay ? null : end,
        reason: String(form.get('reason') ?? ''),
      }),
    )
    if (!result.ok) {
      return {
        error: '予約と重なるためブロックできません。以下の予約を移動またはキャンセルしてください',
        conflicts: result.conflicts.map((c) => ({
          ...c,
          start: c.start.toISOString(),
          end: c.end.toISOString(),
        })),
      }
    }
    revalidatePath('/admin/blocks')
    return { error: null, created: result.created }
  } catch (error) {
    return { error: toUserMessage(error) }
  }
}

/** A-22 「解除」 */
export async function releaseBlockAction(form: FormData): Promise<void> {
  const staff = await requireStaff('bookings.manage')
  const back = backTo(form, '/admin/blocks')
  let flag = 'released=1'
  try {
    await withContainer((c) => c.releaseRoomBlock(staff.access, Number(form.get('blockId'))))
  } catch (error) {
    flag = `error=${encodeURIComponent(toUserMessage(error))}`
  }
  redirect(withFlag(back, flag))
}

// ---------------------------------------------------------------- A-25 / A-26

/** A-25 「対応する」 / 「解決」 */
export async function alertAction(form: FormData): Promise<void> {
  const staff = await requireStaff('alerts.manage')
  const back = backTo(form, '/admin/alerts')
  const id = Number(form.get('alertId'))
  let flag = 'updated=1'
  try {
    await withContainer((c) =>
      form.get('op') === 'resolve'
        ? c.resolveAlert(staff.access, id, String(form.get('note') ?? '') || null)
        : c.assignAlert(staff.access, id),
    )
  } catch (error) {
    flag = `error=${encodeURIComponent(toUserMessage(error))}`
  }
  redirect(withFlag(back, flag))
}

/** A-26 「返金を再実行」 */
export async function retryRefundAction(form: FormData): Promise<void> {
  const staff = await requireStaff('bookings.cancel')
  const back = backTo(form, '/admin/payments')
  let flag: string
  try {
    const result = await withContainer((c) =>
      c.retryRefund(staff.access, Number(form.get('refundId'))),
    )
    flag = result.ok ? 'refund=ok' : 'refund=failed'
  } catch (error) {
    flag = `error=${encodeURIComponent(toUserMessage(error))}`
  }
  redirect(withFlag(back, flag))
}
