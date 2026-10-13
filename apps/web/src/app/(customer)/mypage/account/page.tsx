import { formatJapaneseMobile } from '@jancube/domain'
import { redirect } from 'next/navigation'
import { Card, Notice, PageHeader } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { localDate } from '@/lib/format'
import { logoutAction } from '@/server/auth-actions'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { requireMemberPage } from '@/server/member-page'
import { EmailForm, WithdrawForm } from './AccountForms'
import { UnlinkLineButton } from './UnlinkLineButton'

export const dynamic = 'force-dynamic'

/** LINE account linking (LIFF). */
const LINE_LINK_URL = '/liff/link'

/** C-17 会員情報・LINE連携・退会 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>
}) {
  const { saved } = await searchParams
  const memberId = await requireMemberPage('/mypage/account')
  let account: Awaited<ReturnType<typeof load>>
  try {
    account = await load(memberId)
  } catch (error) {
    if (isDomainError(error, 'member_not_found')) redirect('/login')
    return <ErrorPanel message={toUserMessage(error)} backHref="/mypage" />
  }

  return (
    <>
      <PageHeader backHref="/mypage" title="会員情報" />
      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        {saved && <Notice tone="success">メールアドレスを保存しました</Notice>}
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <ReadOnly label="姓（変更不可）" value={account.familyName ?? ''} />
            <ReadOnly label="名（変更不可）" value={account.givenName ?? ''} />
          </div>
          <p className="mt-2 text-xs text-sub">
            🔒 お名前の変更をご希望の場合は店舗スタッフへお申し付けください
          </p>
          <EmailForm email={account.email ?? ''} />
        </Card>

        <Card>
          <h2 className="font-bold">電話番号</h2>
          <p className="mt-1 text-base">
            {account.phone ? formatJapaneseMobile(account.phone) : '未登録'}
          </p>
          <p className="mt-1 text-xs text-sub">
            電話番号の変更をご希望の場合は店舗スタッフへお申し付けください
          </p>
        </Card>

        <Card>
          <h2 className="font-bold">LINE連携</h2>
          {account.line ? (
            <>
              <p className="mt-1">
                連携済み（{localDate(account.line.linkedAt, 'Asia/Tokyo')}）
                {account.line.friendStatus === 'blocked' && (
                  <span className="ml-1 text-alert">ブロック中のため通知はメールで届きます</span>
                )}
              </p>
              <p className="mt-1 text-xs text-sub">
                予約完了・部屋確定などのお知らせはLINEでお届けします
              </p>
              <UnlinkLineButton />
            </>
          ) : (
            <>
              <p className="mt-1 text-sub">未連携です。連携すると予約のお知らせがLINEで届きます</p>
              <a
                href={LINE_LINK_URL}
                className="mt-2 block rounded-xl bg-[#06c755] py-2.5 text-center font-bold text-white"
              >
                LINEと連携する
              </a>
            </>
          )}
        </Card>

        <form action={logoutAction}>
          <button
            type="submit"
            className="block w-full rounded-xl border border-line bg-white py-3 text-center font-bold text-sub"
          >
            ログアウト
          </button>
        </form>

        <Card>
          <h2 className="font-bold text-alert">退会する</h2>
          <ul className="mt-1 list-inside list-disc text-xs text-sub">
            <li>ご利用前のご予約がある間は退会できません</li>
            <li>お名前・電話番号・メールアドレスは削除され、元に戻せません</li>
            <li>お持ちのクーポンは使えなくなります</li>
            <li>退会後も法令・会計上必要な取引記録は保持されます</li>
          </ul>
          <WithdrawForm />
        </Card>
      </main>
    </>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-sub">{label}</p>
      <p className="mt-1 rounded-lg bg-line/40 px-3 py-2.5 text-base">{value}</p>
    </div>
  )
}

function load(memberId: number) {
  return withContainer((c) => c.getMyAccount(memberId))
}
