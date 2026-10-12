'use server'

import type { EndOption } from '@jancube/application'
import { redirect } from 'next/navigation'
import { loginPath } from '@/lib/auth-flow'
import type { ActionResult, FormState } from './booking-actions'
import { withContainer } from './container'
import { isDomainError, toUserMessage } from './errors'
import { assertNotMaintenance } from './maintenance'
import { bookingPath } from './member-page'
import { clearChallengeId, endSession, readSessionMemberId } from './session'

async function requireMember(back: string): Promise<number> {
  const memberId = await readSessionMemberId()
  if (!memberId) redirect(loginPath(back))
  return memberId
}

const SIGNED_OUT = 'ログインの有効期限が切れました。もう一度ログインしてください'

const text = (form: FormData, name: string) => String(form.get(name) ?? '')

/** C-15 「キャンセルを確定する」 */
export async function cancelBookingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const code = text(form, 'bookingCode')
  const memberId = await requireMember(bookingPath(code, '/cancel'))
  try {
    assertNotMaintenance()
    await withContainer((c) =>
      c.cancelBooking({
        bookingCode: code,
        actor: { type: 'member', memberId },
        memberId,
        reason: text(form, 'reason').trim().slice(0, 1000) || null,
      }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(bookingPath(code, '/cancel/done'))
}

export interface ChangeSelection {
  readonly bookingCode: string
  readonly date: string
  readonly laneKey: string
  readonly start: string
}

/** C-14: end times (with prices) for a new start. */
export async function getChangeEndOptionsAction(
  input: ChangeSelection,
): Promise<ActionResult<EndOption[]>> {
  try {
    const memberId = await readSessionMemberId()
    if (!memberId) return { ok: false, error: SIGNED_OUT }
    const data = await withContainer((c) => c.getChangeEndOptions({ ...input, memberId }))
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: toUserMessage(error) }
  }
}

export interface ChangeQuoteView {
  readonly before: { readonly total: number }
  readonly after: {
    readonly laneLabel: string
    readonly groupName: string
    readonly regularPrice: number
    readonly subtotal: number
    readonly discount: number
    readonly total: number
  }
  readonly settlement:
    | { readonly kind: 'none' }
    | { readonly kind: 'refund'; readonly amount: number }
    | { readonly kind: 'increase_not_allowed'; readonly amount: number }
}

/** C-14: before/after and the price difference for the chosen time. */
export async function quoteChangeAction(
  input: ChangeSelection & { readonly end: string },
): Promise<ActionResult<ChangeQuoteView>> {
  try {
    const memberId = await readSessionMemberId()
    if (!memberId) return { ok: false, error: SIGNED_OUT }
    const quote = await withContainer((c) => c.quoteBookingChange({ ...input, memberId }))
    return {
      ok: true,
      data: { before: quote.before, after: quote.after, settlement: quote.settlement },
    }
  } catch (error) {
    return { ok: false, error: toUserMessage(error) }
  }
}

/** C-14 「この内容に変更する」 */
export async function changeBookingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const code = text(form, 'bookingCode')
  const memberId = await requireMember(bookingPath(code, '/change'))
  let refundFailed = false
  try {
    assertNotMaintenance()
    const result = await withContainer((c) =>
      c.changeBooking({
        bookingCode: code,
        memberId,
        date: text(form, 'date'),
        laneKey: text(form, 'laneKey'),
        start: text(form, 'start'),
        end: text(form, 'end'),
        requestKey: text(form, 'requestKey'),
      }),
    )
    refundFailed = result.refundFailed
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(bookingPath(code, refundFailed ? '?changed=refund_pending' : '?changed=1'))
}

/** C-19 「領収書を発行する」 / 「再発行する」 */
export async function issueReceiptAction(_prev: FormState, form: FormData): Promise<FormState> {
  const code = text(form, 'bookingCode')
  const memberId = await requireMember(bookingPath(code, '/receipt'))
  try {
    assertNotMaintenance()
    await withContainer((c) =>
      c.issueMyReceipt({ bookingCode: code, memberId, recipientName: text(form, 'recipientName') }),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(bookingPath(code, '/receipt?issued=1'))
}

/** C-17 メールアドレス「保存する」 */
export async function updateEmailAction(_prev: FormState, form: FormData): Promise<FormState> {
  const memberId = await requireMember('/mypage/account')
  try {
    assertNotMaintenance()
    await withContainer((c) => c.updateMyEmail(memberId, text(form, 'email')))
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/mypage/account?saved=1')
}

/** C-17 「退会する」 (F-AUTH-07): confirmed with a checkbox; the session ends afterwards. */
export async function withdrawAction(_prev: FormState, form: FormData): Promise<FormState> {
  const memberId = await requireMember('/mypage/account')
  if (form.get('confirm') !== 'on') {
    return { error: '注意事項を確認し、チェックを入れてください' }
  }
  try {
    assertNotMaintenance()
    await withContainer((c) => c.withdrawMember(memberId))
  } catch (error) {
    if (isDomainError(error, 'member_not_found')) {
      await endSession()
      redirect('/login')
    }
    return { error: toUserMessage(error) }
  }
  await endSession()
  await clearChallengeId()
  redirect('/login?withdrawn=1')
}
