import { redirect } from 'next/navigation'
import { VerifyForm } from '@/components/auth/VerifyForm'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel, StoreBar } from '@/components/StoreBar'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { readChallengeId } from '@/server/session'

export const dynamic = 'force-dynamic'

/** C-06 認証コード入力 (F-AUTH-02) */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ resent?: string }>
}) {
  const { resent } = await searchParams
  const [holdKey, challengeId] = await Promise.all([readHoldKey(), readChallengeId()])
  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(holdKey, challengeId)
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect('/booking/auth')
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }
  const { hold, challenge } = view
  if (challenge.canRegister) redirect('/booking/auth/profile')

  return (
    <>
      <StoreBar storeName={hold.storeName} backHref="/booking/auth" />
      <main className="mx-auto max-w-md space-y-4 px-4 py-5">
        <div>
          <h1 className="text-lg font-bold">認証コードの入力</h1>
          <p className="mt-1 text-sm text-sub">
            {challenge.maskedPhone} 宛に6桁のコードを送信しました
          </p>
        </div>
        {resent && (
          <p className="rounded-lg bg-brand-pale p-3 text-sm text-brand-dark">
            新しい認証コードを送信しました
          </p>
        )}
        <VerifyForm resendAfter={challenge.resendAfter.toISOString()} />
        <HoldCountdown
          expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()}
          storeCode={hold.storeCode}
        />
        <p className="text-xs text-sub">
          SMSが届かない場合は、番号をご確認のうえ再送してください。
          <a href="/booking/auth" className="font-bold text-brand-dark underline">
            電話番号を変更する
          </a>
        </p>
      </main>
    </>
  )
}

function load(holdKey: string | null, challengeId: string | null) {
  return withContainer(async (c) => ({
    hold: await c.getActiveHold(holdKey),
    challenge: await c.getSignInChallenge(challengeId),
  }))
}
