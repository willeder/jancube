import { redirect } from 'next/navigation'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { readPendingLineLink } from '@/server/line-session'
import { readChallengeId } from '@/server/session'
import { LinkProfileForm } from '../LinkForms'
import { LinkSteps } from '../LinkSteps'

export const dynamic = 'force-dynamic'

/** L-03 step 3: registration for a new phone number (C-07 rules), then the link is made. */
export default async function LiffLinkProfilePage() {
  const [pending, challengeId] = await Promise.all([readPendingLineLink(), readChallengeId()])
  if (!pending) redirect('/liff/link')
  let canRegister: boolean
  try {
    canRegister = (await withContainer((c) => c.getSignInChallenge(challengeId))).canRegister
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect('/liff/link')
    return <p className="p-4 text-sm text-alert">{toUserMessage(error)}</p>
  }
  if (!canRegister) redirect('/liff/link')

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">お名前のご登録</h1>
        <p className="mt-1 text-sm text-sub">
          はじめてのご利用です。ご登録後、LINEアカウントと連携します
        </p>
      </div>
      <LinkSteps current={3} />
      <LinkProfileForm />
    </main>
  )
}
