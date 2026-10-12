'use server'

import { redirect } from 'next/navigation'
import type { FormState } from './booking-actions'
import { withContainer } from './container'
import { isDomainError, toUserMessage } from './errors'
import { readHoldKey } from './hold-cookie'
import { clearChallengeId, readChallengeId, startSession, writeChallengeId } from './session'

/** Where sign-in continues once the member is known (C-09 お支払い). */
const AFTER_SIGN_IN = '/booking/payment'

/** C-05 「認証コードを送信」 */
export async function sendCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const sent = await withContainer((c) => c.sendSignInCode(String(form.get('phone') ?? '')))
    await writeChallengeId(sent.challengeId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/booking/auth/verify')
}

/** C-06 「コードを再送する」 */
export async function resendCodeAction(_prev: FormState, _form: FormData): Promise<FormState> {
  try {
    const challengeId = await readChallengeId()
    const sent = await withContainer((c) => c.resendSignInCode(challengeId ?? ''))
    await writeChallengeId(sent.challengeId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/booking/auth/verify?resent=1')
}

/** C-06 「認証する」: existing members go straight to payment, new numbers to C-07. */
export async function verifyCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  let next: string
  try {
    const challengeId = await readChallengeId()
    const result = await withContainer((c) =>
      c.verifySignInCode(challengeId ?? '', String(form.get('code') ?? '')),
    )
    if (result.kind === 'member') {
      await signedIn(result.memberId)
      next = AFTER_SIGN_IN
    } else {
      next = '/booking/auth/profile'
    }
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect('/booking/auth')
    return { error: toUserMessage(error) }
  }
  redirect(next)
}

/** C-07 「登録して支払いへ進む」 */
export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const challengeId = await readChallengeId()
    const { memberId } = await withContainer((c) =>
      c.registerMember(challengeId ?? '', {
        familyName: String(form.get('familyName') ?? ''),
        givenName: String(form.get('givenName') ?? ''),
        email: String(form.get('email') ?? ''),
        agreesToTerms: form.get('agreesToTerms') === 'on',
        confirmsAdult: form.get('confirmsAdult') === 'on',
        channel: 'web',
      }),
    )
    await signedIn(memberId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(AFTER_SIGN_IN)
}

/** Session cookie + the hold now belongs to this member. */
async function signedIn(memberId: number): Promise<void> {
  await startSession(memberId)
  await clearChallengeId()
  const holdKey = await readHoldKey()
  if (holdKey) await withContainer((c) => c.attachMemberToHold(holdKey, memberId))
}
