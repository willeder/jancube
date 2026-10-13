import { redirect } from 'next/navigation'
import { PhoneForm } from '@/components/auth/PhoneForm'
import { Notice } from '@/components/MyPageParts'
import { safeNext } from '@/lib/auth-flow'
import { withContainer } from '@/server/container'
import { readSessionMemberId } from '@/server/session'

export const dynamic = 'force-dynamic'

/** C-22 ログイン: SMS sign-in without a booking in progress (F-AUTH-01). */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; withdrawn?: string; loggedOut?: string }>
}) {
  const { next: nextParam, withdrawn, loggedOut } = await searchParams
  const next = safeNext(nextParam)
  const memberId = await readSessionMemberId()
  // Signed in already: continue. A stale session (withdrawn/unknown member) just signs in again.
  if (memberId && (await isActiveMember(memberId))) redirect(next)

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      {withdrawn && (
        <Notice tone="success">退会のお手続きが完了しました。ご利用ありがとうございました</Notice>
      )}
      {loggedOut && <Notice>ログアウトしました</Notice>}
      <div>
        <h1 className="text-lg font-bold">ログイン</h1>
        <p className="mt-1 text-sm text-sub">ご登録の携帯電話番号にSMSで認証コードをお送りします</p>
      </div>
      <PhoneForm flow="login" next={next} />
      <p className="text-center text-xs text-sub">はじめての方も同じ手順でご登録いただけます</p>
    </main>
  )
}

function isActiveMember(memberId: number): Promise<boolean> {
  return withContainer((c) => c.getMyAccount(memberId)).then(
    () => true,
    () => false,
  )
}
