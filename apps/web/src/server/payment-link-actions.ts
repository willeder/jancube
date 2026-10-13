'use server'

import { redirect } from 'next/navigation'
import type { FormState } from './booking-actions'
import { withContainer } from './container'
import { toUserMessage } from './errors'
import { writeHoldKey } from './hold-cookie'
import { readSessionMemberId } from './session'

/**
 * C-18 「お支払いに進む」: the phone booking becomes the booking in progress (hold cookie), then the
 * normal flow continues — C-09 for the signed-in member, otherwise SMS sign-in C-05〜C-07 first.
 */
export async function openPaymentLinkAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get('token') ?? '')
  let next: string
  try {
    const memberId = await readSessionMemberId()
    const opened = await withContainer((c) => c.openPaymentLink(token, memberId))
    if (opened.next === 'paid') {
      next = `/pay/${token}`
    } else {
      await writeHoldKey(opened.requestKey)
      next = opened.next === 'payment' ? '/booking/payment' : '/booking/auth'
    }
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(next)
}
