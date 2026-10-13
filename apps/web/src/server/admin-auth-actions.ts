'use server'

import { can } from '@jancube/domain'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { endStaffSession, startStaffSession, writeSelectedStore } from './admin-session'
import type { FormState } from './booking-actions'
import { withContainer } from './container'
import { toUserMessage } from './errors'

async function origin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** A-01 ログイン */
export async function staffLoginAction(_prev: FormState, form: FormData): Promise<FormState> {
  let next = '/admin'
  try {
    const session = await withContainer((c) =>
      c.staffSignIn(String(form.get('email') ?? ''), String(form.get('password') ?? '')),
    )
    await startStaffSession(session.staffId, form.get('remember') === 'on')
    // Cleaning-only staff work in the cleaning screens (K-02), not the admin console.
    if (!can(session.access, 'dashboard.view') && can(session.access, 'cleaning.work')) {
      next = '/cleaning'
    }
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect(next)
}

export async function staffLogoutAction(): Promise<void> {
  await endStaffSession()
  redirect('/admin/login')
}

/** A-30 パスワード再設定メール */
export async function requestPasswordResetAction(
  _prev: FormState & { sent?: boolean },
  form: FormData,
): Promise<FormState & { sent?: boolean }> {
  const base = await origin()
  try {
    await withContainer((c) =>
      c.requestPasswordReset(
        String(form.get('email') ?? ''),
        (token) => `${base}/admin/password/set?purpose=password_reset&token=${token}`,
      ),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  // Same response whether or not the address exists.
  return { error: null, sent: true }
}

/** A-30 / invitation: set a password with the emailed token. */
export async function setPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '')
  if (password !== String(form.get('confirm') ?? '')) {
    return { error: '確認用パスワードが一致しません' }
  }
  try {
    await withContainer((c) =>
      c.setPasswordWithToken(
        String(form.get('token') ?? ''),
        form.get('purpose') === 'invite' ? 'invite' : 'password_reset',
        password,
      ),
    )
  } catch (error) {
    return { error: toUserMessage(error) }
  }
  redirect('/admin/login?password=updated')
}

/** Sidebar store selector (F-ADM-04). */
export async function selectStoreAction(form: FormData): Promise<void> {
  await writeSelectedStore(String(form.get('store') ?? 'all'))
  const back = String(form.get('back') ?? '')
  redirect(back.startsWith('/admin') ? back : '/admin')
}
