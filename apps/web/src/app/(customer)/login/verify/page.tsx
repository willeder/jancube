import { redirect } from 'next/navigation'
import { VerifyForm } from '@/components/auth/VerifyForm'
import { Notice } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { authPaths } from '@/lib/auth-flow'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { readChallengeId } from '@/server/session'

export const dynamic = 'force-dynamic'

/** C-22 → C-06 認証コード入力 (no booking in progress). */
export default async function LoginVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; resent?: string }>
}) {
  const { next: nextParam, resent } = await searchParams
  const paths = authPaths('login', nextParam)
  let challenge: Awaited<ReturnType<typeof load>>
  try {
    challenge = await load(await readChallengeId())
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect(paths.start)
    return <ErrorPanel message={toUserMessage(error)} backHref={paths.start} />
  }
  if (challenge.canRegister) redirect(paths.profile)

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">認証コードの入力</h1>
        <p className="mt-1 text-sm text-sub">
          {challenge.maskedPhone} 宛に6桁のコードを送信しました
        </p>
      </div>
      {resent && <Notice>新しい認証コードを送信しました</Notice>}
      <VerifyForm
        resendAfter={challenge.resendAfter.toISOString()}
        flow="login"
        next={paths.next}
      />
      <p className="text-xs text-sub">
        SMSが届かない場合は、番号をご確認のうえ再送してください。
        <a href={paths.start} className="font-bold text-brand-dark underline">
          電話番号を変更する
        </a>
      </p>
    </main>
  )
}

function load(challengeId: string | null) {
  return withContainer((c) => c.getSignInChallenge(challengeId))
}
