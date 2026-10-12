'use server'

import type { PaymentMethod } from '@jancube/application'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { FormState } from './booking-actions'
import { withContainer } from './container'
import { toUserMessage } from './errors'
import { readHoldKey } from './hold-cookie'
import { readSessionMemberId } from './session'

async function requireMember(): Promise<number> {
  const memberId = await readSessionMemberId()
  if (!memberId) redirect('/booking/auth')
  return memberId
}

/** Absolute URL of this deployment, for the payment provider's return URLs. */
async function origin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** C-09 クーポンコード「適用」 */
export async function claimCouponAction(_prev: FormState, form: FormData): Promise<FormState> {
  const memberId = await requireMember()
  let grantId: number
  try {
    grantId = await withContainer((c) =>
      c.claimCouponCode(memberId, String(form.get('code') ?? '')),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(`/booking/payment?coupon=${grantId}`)
}

/** C-09 「〇〇円を支払う」 → C-10 (payment provider) or straight to C-11 when nothing is due. */
export async function startCheckoutAction(_prev: FormState, form: FormData): Promise<FormState> {
  const memberId = await requireMember()
  const grant = String(form.get('grantId') ?? '')
  const method: PaymentMethod = form.get('method') === 'paypay' ? 'paypay' : 'card'
  const base = await origin()
  let next: string
  try {
    const requestKey = await readHoldKey()
    const result = await withContainer((c) =>
      c.startCheckout({
        requestKey,
        memberId,
        grantId: grant ? Number(grant) : null,
        method,
        successUrl: `${base}/booking/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}/booking/payment?canceled=1`,
      }),
    )
    next = result.kind === 'redirect' ? result.url : '/booking/complete'
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(next)
}

/** Development stand-in for the provider's payment page. */
export async function devCheckoutAction(form: FormData): Promise<void> {
  const session = String(form.get('session'))
  const outcome = form.get('outcome') === 'paid' ? 'paid' : 'canceled'
  await withContainer((c) => c.completeDevCheckout(session, outcome))
  // Only ever return to a path on this site.
  const target = new URL(String(form.get(outcome === 'paid' ? 'success' : 'cancel')), 'http://x')
  redirect(`${target.pathname}${target.search}`)
}
