import Link from 'next/link'
import { redirect } from 'next/navigation'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { readPendingLineLink } from '@/server/line-session'
import { readChallengeId } from '@/server/session'
import { LinkVerifyForm } from '../LinkForms'
import { LinkSteps } from '../LinkSteps'

export const dynamic = 'force-dynamic'

/** L-03 step 2: SMS code (C-06 rules). */
export default async function LiffLinkVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ resent?: string }>
}) {
  const { resent } = await searchParams
  const [pending, challengeId] = await Promise.all([readPendingLineLink(), readChallengeId()])
  if (!pending) redirect('/liff/link')
  let challenge: Awaited<ReturnType<typeof load>>
  try {
    challenge = await load(challengeId)
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect('/liff/link')
    return <p className="p-4 text-sm text-alert">{toUserMessage(error)}</p>
  }
  if (challenge.canRegister) redirect('/liff/link/profile')

  return (
    <main className="customer-content ">
      <div>
        <h1 className="text-base font-bold">認証コードの入力</h1>
        <p className="mt-1 text-sm text-sub">
          {challenge.maskedPhone} 宛に6桁のコードを送信しました
        </p>
      </div>
      <LinkSteps current={2} />
      {resent && (
        <p className="rounded-lg bg-brand-pale p-3 text-sm text-brand-dark">
          新しい認証コードを送信しました
        </p>
      )}
      <LinkVerifyForm resendAfter={challenge.resendAfter.toISOString()} />
      <p className="text-xs text-sub">
        SMSが届かない場合は、番号をご確認のうえ再送してください。
        <Link href="/liff/link" className="font-bold text-brand-dark underline">
          電話番号を変更する
        </Link>
      </p>
    </main>
  )
}

function load(challengeId: string | null) {
  return withContainer((c) => c.getSignInChallenge(challengeId))
}
