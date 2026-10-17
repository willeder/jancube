import { redirect } from 'next/navigation'
import { ProfileForm } from '@/components/auth/ProfileForm'
import { BookingFlow } from '@/components/BookingFlow'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel } from '@/components/StoreBar'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { readChallengeId } from '@/server/session'

export const dynamic = 'force-dynamic'

/** C-07 会員登録（プロフィール） (F-AUTH-03) — only after a new number has been verified. */
export default async function ProfilePage() {
  const [holdKey, challengeId] = await Promise.all([readHoldKey(), readChallengeId()])
  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(holdKey, challengeId)
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect('/booking/auth')
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }
  const { hold, challenge } = view
  if (!challenge.canRegister) redirect('/booking/auth')

  return (
    <BookingFlow step={5} storeName={hold.storeName} backHref="/booking/auth">
      <div>
        <h1 className="text-base font-bold">お客様情報の入力</h1>
        <p className="text-sm text-sub">お名前（本名でのご登録をお願いしています）</p>
      </div>
      <ProfileForm />
      <HoldCountdown
        expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()}
        storeCode={hold.storeCode}
      />
    </BookingFlow>
  )
}

function load(holdKey: string | null, challengeId: string | null) {
  return withContainer(async (c) => ({
    hold: await c.getActiveHold(holdKey),
    challenge: await c.getSignInChallenge(challengeId),
  }))
}
