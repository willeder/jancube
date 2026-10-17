import { notFound } from 'next/navigation'
import { SetPasswordForm } from '../PasswordForms'

/** A-30 / A-23 invitation: set a password from the emailed one-time link. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; purpose?: string }>
}) {
  const { token, purpose } = await searchParams
  if (!token) notFound()
  const invite = purpose === 'invite'
  return (
    <main className="admin-auth-page flex min-h-screen items-center justify-center px-4 py-6">
      <div className="w-full max-w-[420px] space-y-3 rounded-[14px] border border-line bg-white p-3.5">
        <h1 className="font-bold">{invite ? 'アカウントのパスワード設定' : 'パスワード再設定'}</h1>
        <SetPasswordForm token={token} purpose={invite ? 'invite' : 'password_reset'} />
      </div>
    </main>
  )
}
