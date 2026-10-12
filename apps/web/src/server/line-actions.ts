'use server'

import { DomainError } from '@jancube/domain'
import { redirect } from 'next/navigation'
import type { FormState } from './booking-actions'
import { markLiffChannel } from './booking-attribution'
import { withContainer } from './container'
import { isDomainError, toUserMessage } from './errors'
import { trackFunnel } from './funnel'
import { readHoldKey } from './hold-cookie'
import {
  clearPendingLineLink,
  type PendingLineLink,
  readPendingLineLink,
  safeNext,
  writePendingLineLink,
} from './line-session'
import {
  clearChallengeId,
  readChallengeId,
  readSessionMemberId,
  startSession,
  writeChallengeId,
} from './session'

/**
 * L-02 LIFF entry (F-LINE-02): the page posts the LIFF ID token (and access token, for the friend
 * status). Linked members are signed in and continue; others go to L-03 linking.
 */
export async function liffSignInAction(input: {
  idToken: string
  accessToken: string | null
  next: string | null
}): Promise<{ ok: true; redirect: string } | { ok: false; error: string }> {
  const next = safeNext(input.next)
  try {
    const result = await withContainer((c) =>
      c.lineSignIn(
        String(input.idToken ?? ''),
        input.accessToken ? String(input.accessToken) : null,
      ),
    )
    await markLiffChannel()
    await trackFunnel('liff_opened', {
      memberId: result.kind === 'member' ? result.memberId : null,
    })
    if (result.kind === 'member') {
      await signedIn(result.memberId)
      return { ok: true, redirect: next }
    }
    await writePendingLineLink({ ...result.line, next })
    return { ok: true, redirect: '/liff/link' }
  } catch (error) {
    return { ok: false, error: toUserMessage(error) }
  }
}

async function pendingOrFail(): Promise<PendingLineLink> {
  const pending = await readPendingLineLink()
  if (!pending) throw new DomainError('line_link_expired', 'start from the LINE app again')
  return pending
}

/** L-03 step 1: send the SMS code (same rules as C-05). */
export async function liffSendCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await pendingOrFail()
    const sent = await withContainer((c) => c.sendSignInCode(String(form.get('phone') ?? '')))
    await writeChallengeId(sent.challengeId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/liff/link/verify')
}

export async function liffResendCodeAction(_prev: FormState, _form: FormData): Promise<FormState> {
  try {
    const challengeId = await readChallengeId()
    const sent = await withContainer((c) => c.resendSignInCode(challengeId ?? ''))
    await writeChallengeId(sent.challengeId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/liff/link/verify?resent=1')
}

/** L-03 step 2: check the code; existing members are linked now, new numbers register first. */
export async function liffVerifyCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  let next: string
  try {
    const pending = await pendingOrFail()
    const challengeId = await readChallengeId()
    const result = await withContainer((c) =>
      c.verifySignInCode(challengeId ?? '', String(form.get('code') ?? '')),
    )
    if (result.kind === 'member') {
      next = await link(result.memberId, pending)
    } else {
      next = '/liff/link/profile'
    }
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect('/liff/link')
    return { error: toUserMessage(error) }
  }
  redirect(next)
}

/** L-03 step 3 (new customers): register as in C-07, then link. */
export async function liffRegisterAction(_prev: FormState, form: FormData): Promise<FormState> {
  let next: string
  try {
    const pending = await pendingOrFail()
    const challengeId = await readChallengeId()
    const { memberId } = await withContainer((c) =>
      c.registerMember(challengeId ?? '', {
        familyName: String(form.get('familyName') ?? ''),
        givenName: String(form.get('givenName') ?? ''),
        email: String(form.get('email') ?? ''),
        agreesToTerms: form.get('agreesToTerms') === 'on',
        confirmsAdult: form.get('confirmsAdult') === 'on',
        registrationSource: 'line',
        channel: 'liff',
      }),
    )
    next = await link(memberId, pending)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(next)
}

/** L-03 / C-17: a member who is already signed in links without another SMS. */
export async function linkSignedInMemberAction(
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  let next: string
  try {
    const pending = await pendingOrFail()
    const memberId = await readSessionMemberId()
    if (!memberId) throw new DomainError('member_not_found', 'sign in again')
    next = await link(memberId, pending)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(next)
}

/**
 * C-17 「LINE連携を解除」 (F-AUTH-06) for the signed-in member. Usable as a form action
 * (`useActionState(unlinkLineAction, { error: null, unlinked: false })`) or called directly.
 */
export async function unlinkLineAction(
  _prev?: unknown,
  _form?: FormData,
): Promise<{ error: string | null; unlinked: boolean }> {
  try {
    const memberId = await readSessionMemberId()
    if (!memberId) throw new DomainError('member_not_found', 'sign in again')
    const { unlinked } = await withContainer((c) => c.unlinkLineAccount(memberId))
    return { error: null, unlinked }
  } catch (error) {
    return { error: toUserMessage(error), unlinked: false }
  }
}

/** Links the pending LINE user, signs the member in and returns the completion page. */
async function link(memberId: number, pending: PendingLineLink): Promise<string> {
  await withContainer((c) => c.linkLineAccount(memberId, pending))
  await signedIn(memberId)
  await clearPendingLineLink()
  return `/liff/link/done?next=${encodeURIComponent(pending.next)}`
}

/** Session cookie; a hold in progress now belongs to this member (as after C-06/C-07). */
async function signedIn(memberId: number): Promise<void> {
  await startSession(memberId)
  await clearChallengeId()
  const holdKey = await readHoldKey()
  if (!holdKey) return
  try {
    await withContainer((c) => c.attachMemberToHold(holdKey, memberId))
  } catch (error) {
    // An expired or finished hold does not stop the sign-in.
    if (!isDomainError(error, 'hold_not_found', 'hold_expired', 'hold_not_active')) throw error
  }
}
