'use server'

import { redirect } from 'next/navigation'
import { type AuthPaths, authPaths } from '@/lib/auth-flow'
import type { FormState } from './booking-actions'
import { withContainer } from './container'
import { isDomainError, toUserMessage } from './errors'
import { readHoldKey } from './hold-cookie'
import { assertNotMaintenance } from './maintenance'
import {
  clearChallengeId,
  endSession,
  readChallengeId,
  startSession,
  writeChallengeId,
} from './session'

/**
 * The forms send `flow` (booking: C-05〜C-07 during a hold / login: C-22) and, for login, the
 * same-site page to continue to (`next`, validated by authPaths).
 */
function pathsOf(form: FormData): AuthPaths {
  return authPaths(form.get('flow') === 'login' ? 'login' : 'booking', form.get('next'))
}

/** C-05 / C-22 「認証コードを送信」 */
export async function sendCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const paths = pathsOf(form)
  try {
    assertNotMaintenance()
    const sent = await withContainer((c) => c.sendSignInCode(String(form.get('phone') ?? '')))
    await writeChallengeId(sent.challengeId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(paths.verify)
}

/** C-06 「コードを再送する」 */
export async function resendCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const paths = pathsOf(form)
  try {
    assertNotMaintenance()
    const challengeId = await readChallengeId()
    const sent = await withContainer((c) => c.resendSignInCode(challengeId ?? ''))
    await writeChallengeId(sent.challengeId)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(paths.verifyResent)
}

/** C-06 「認証する」: existing members continue (payment or `next`), new numbers go to C-07. */
export async function verifyCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const paths = pathsOf(form)
  let next: string
  try {
    assertNotMaintenance()
    const challengeId = await readChallengeId()
    const result = await withContainer((c) =>
      c.verifySignInCode(challengeId ?? '', String(form.get('code') ?? '')),
    )
    if (result.kind === 'member') {
      await signedIn(result.memberId, paths)
      next = paths.done
    } else {
      next = paths.profile
    }
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect(paths.start)
    return { error: toUserMessage(error) }
  }
  redirect(next)
}

/** C-07 「登録して支払いへ進む」 / 「登録する」 */
export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const paths = pathsOf(form)
  try {
    assertNotMaintenance()
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
    await signedIn(memberId, paths)
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(paths.done)
}

/** ログアウト (C-12 / C-17) */
export async function logoutAction(): Promise<void> {
  await endSession()
  await clearChallengeId()
  redirect('/login?loggedOut=1')
}

/** Session cookie; in the booking flow the hold now belongs to this member. */
async function signedIn(memberId: number, paths: AuthPaths): Promise<void> {
  await startSession(memberId)
  await clearChallengeId()
  if (paths.flow !== 'booking') return
  const holdKey = await readHoldKey()
  if (holdKey) await withContainer((c) => c.attachMemberToHold(holdKey, memberId))
}
