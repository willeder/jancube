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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-white p-6">
        <h1 className="font-bold">{invite ? 'アカウントのパスワード設定' : 'パスワード再設定'}</h1>
        <SetPasswordForm token={token} purpose={invite ? 'invite' : 'password_reset'} />
      </div>
    </main>
  )
}
