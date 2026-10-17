import { redirect } from 'next/navigation'
import { ProfileForm } from '@/components/auth/ProfileForm'
import { ErrorPanel } from '@/components/StoreBar'
import { authPaths } from '@/lib/auth-flow'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { readChallengeId } from '@/server/session'

export const dynamic = 'force-dynamic'

/** C-22 → C-07 会員登録: a verified number that has no member yet. */
export default async function LoginProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next: nextParam } = await searchParams
  const paths = authPaths('login', nextParam)
  let canRegister: boolean
  try {
    canRegister = (await withContainer(async (c) => c.getSignInChallenge(await readChallengeId())))
      .canRegister
  } catch (error) {
    if (isDomainError(error, 'challenge_not_found')) redirect(paths.start)
    return <ErrorPanel message={toUserMessage(error)} backHref={paths.start} />
  }
  if (!canRegister) redirect(paths.start)

  return (
    <main className="customer-content ">
      <div>
        <h1 className="text-base font-bold">お客様情報の入力</h1>
        <p className="mt-1 text-sm text-sub">お名前（本名でのご登録をお願いしています）</p>
      </div>
      <ProfileForm flow="login" next={paths.next} />
    </main>
  )
}
