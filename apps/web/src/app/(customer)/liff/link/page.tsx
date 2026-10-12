import { maskPhone } from '@jancube/domain'
import Link from 'next/link'
import { withContainer } from '@/server/container'
import { readPendingLineLink } from '@/server/line-session'
import { readSessionMemberId } from '@/server/session'
import { LinkPhoneForm, LinkSignedInForm } from './LinkForms'
import { LinkSteps } from './LinkSteps'

export const dynamic = 'force-dynamic'

/**
 * L-03 LINE連携案内（初回） (F-LINE-03, F-AUTH-06). Reached from L-02 for a LINE account that is not
 * linked yet, and from C-17 「LINEと連携する」 (which first signs in with LINE via /liff).
 */
export default async function LiffLinkPage() {
  const [pending, memberId] = await Promise.all([readPendingLineLink(), readSessionMemberId()])
  const signedIn = memberId
    ? await withContainer(async (c) => ({
        member: await c.findMember(memberId),
        link: await c.getLineLinkStatus(memberId),
      }))
    : null
  const member = signedIn?.member && signedIn.member.status !== 'withdrawn' ? signedIn.member : null

  if (!pending) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-6">
        <h1 className="text-lg font-bold">LINE連携</h1>
        {member && signedIn?.link.linked ? (
          <>
            <p className="rounded-lg bg-brand-pale p-3 text-sm text-brand-dark">
              LINEアカウントは連携済みです。次回からはLINEのメニューを開くだけでご予約いただけます
            </p>
            <Link
              href="/"
              className="block rounded-xl bg-brand py-3 text-center font-bold text-white"
            >
              予約を始める
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-sub">
              LINEアカウントを確認するため、LINEでログインしてから連携します
            </p>
            <Link
              href="/liff?next=/liff/link"
              className="block rounded-xl bg-brand py-3 text-center font-bold text-white"
            >
              LINEでログインして連携する
            </Link>
          </>
        )}
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">LINEアカウントと会員情報の連携</h1>
        <p className="mt-1 text-sm text-sub">
          初回のみ、携帯電話番号の確認（SMS認証）でLINEアカウントと会員情報を紐づけます。
          次回からはLINEを開くだけで、認証なしでご予約いただけます
        </p>
      </div>
      <LinkSteps current={1} />

      {member && (
        <section className="space-y-3 rounded-xl border border-brand bg-white p-4 text-sm">
          <p>
            ログイン中の会員：
            <span className="font-bold">
              {member.familyName} {member.givenName} 様
            </span>
            {member.phone && <span className="text-sub">（{maskPhone(member.phone)}）</span>}
          </p>
          <LinkSignedInForm />
          <p className="text-center text-xs text-sub">または別の電話番号で連携する</p>
        </section>
      )}

      <LinkPhoneForm />
      <p className="text-xs text-sub">
        連携はいつでもマイページから解除できます。解除しても会員情報・ご予約はそのまま残ります
      </p>
    </main>
  )
}
