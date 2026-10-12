'use server'

import type { EndOption } from '@jancube/application'
import { redirect } from 'next/navigation'
import { withContainer } from './container'
import { isDomainError, toUserMessage } from './errors'
import { clearHoldKey, readHoldKey, writeHoldKey } from './hold-cookie'
import { endSession, readSessionMemberId } from './session'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }
export type FormState = { error: string | null }

/** C-03: end times (with prices) for a chosen start. */
export async function getEndOptionsAction(input: {
  storeCode: string
  date: string
  laneKey: string
  start: string
}): Promise<ActionResult<EndOption[]>> {
  try {
    return { ok: true, data: await withContainer((c) => c.getEndOptions(input)) }
  } catch (error) {
    return { ok: false, error: toUserMessage(error) }
  }
}

/** C-03 「この内容で進む」: hold the selected time, then show C-04. */
export async function createHoldAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const previousRequestKey = await readHoldKey()
    const hold = await withContainer((c) =>
      c.createHold({
        storeCode: String(form.get('storeCode')),
        date: String(form.get('date')),
        laneKey: String(form.get('laneKey')),
        start: String(form.get('start')),
        end: String(form.get('end')),
        source: 'web',
        previousRequestKey,
      }),
    )
    await writeHoldKey(hold.requestKey)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/booking/confirm')
}

/**
 * C-04 「お客様情報の入力へ」: save the number of guests and continue to sign-in (C-05).
 * Customers who are already signed in skip C-05〜C-07 and go straight to payment.
 */
export async function confirmHoldAction(_prev: FormState, form: FormData): Promise<FormState> {
  let next = '/booking/auth'
  try {
    const key = await readHoldKey()
    await withContainer(async (c) => {
      await c.setGuestCount(key ?? '', Number(form.get('guestCount')))
      const memberId = await readSessionMemberId()
      if (memberId && key) {
        await c.attachMemberToHold(key, memberId)
        next = '/booking/payment'
      }
    })
  } catch (error) {
    // A stale session (member suspended or removed) falls back to signing in again.
    if (!isDomainError(error, 'member_not_found', 'member_cannot_book')) {
      return { error: toUserMessage(error) }
    }
    await endSession()
  }
  redirect(next)
}

/** C-04 「日時を変更する」: free the hold and go back to the grid. */
export async function changeSelectionAction(form: FormData): Promise<void> {
  const key = await readHoldKey()
  if (key) await withContainer((c) => c.releaseHold(key))
  await clearHoldKey()
  redirect(`/booking/${String(form.get('storeCode'))}/slots?date=${String(form.get('date'))}`)
}
