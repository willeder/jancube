import type { MyBookingItem } from '@jancube/application'
import { formatJapaneseMobile } from '@jancube/domain'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buttonOutline, StatusBadge } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { bookingWhen } from '@/lib/booking-time'
import { yen } from '@/lib/format'
import { logoutAction } from '@/server/auth-actions'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { bookingPath, requireMemberPage } from '@/server/member-page'

export const dynamic = 'force-dynamic'

/** C-12 マイページ（予約一覧）: upcoming and past bookings across all stores (F-BK-16). */
export default async function MyPage() {
  const memberId = await requireMemberPage('/mypage')
  let page: Awaited<ReturnType<typeof load>>
  try {
    page = await load(memberId)
  } catch (error) {
    if (isDomainError(error, 'member_not_found')) redirect('/login')
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }
  const { account, upcoming, past } = page
  const rebook = past.find((b) => b.badge === 'used') ?? upcoming[0]
  const receiptFor = past.find((b) => b.badge === 'used')

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-5">
      <section className="rounded-xl border border-brand bg-brand-pale p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-lg font-bold">
            {account.familyName} {account.givenName} 様
          </p>
          {account.line && <span className="text-xs font-bold text-brand-dark">LINE連携済</span>}
        </div>
        <p className="mt-1 text-xs text-sub">
          会員ID {account.memberCode}
          {account.phone && ` / ${formatJapaneseMobile(account.phone)}`}
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">今後の予約</h2>
        {upcoming.length === 0 ? (
          <p className="rounded-xl border border-line bg-white p-4 text-sm text-sub">
            今後のご予約はありません。
            <Link href="/" className="font-bold text-brand-dark underline">
              予約する
            </Link>
          </p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((b) => (
              <BookingCard key={b.bookingCode} booking={b} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">過去の予約</h2>
          <ul className="space-y-3">
            {past.map((b) => (
              <BookingCard key={b.bookingCode} booking={b} />
            ))}
          </ul>
        </section>
      )}

      {rebook && (
        <Link href={`/booking/${rebook.storeCode}/date`} className={buttonOutline}>
          同じ店舗で再予約する
        </Link>
      )}

      <nav className="grid grid-cols-3 gap-2 text-sm">
        <NavButton href="/mypage/coupons" label="🎟 クーポン" />
        <NavButton href="/mypage/account" label="👤 会員情報" />
        {receiptFor ? (
          <NavButton href={bookingPath(receiptFor.bookingCode, '/receipt')} label="🧾 領収書" />
        ) : (
          <span className="rounded-xl border border-line py-2 text-center font-bold text-sub/60">
            🧾 領収書
          </span>
        )}
      </nav>

      <form action={logoutAction}>
        <button type="submit" className="w-full py-2 text-sm font-bold text-sub underline">
          ログアウト
        </button>
      </form>
    </main>
  )
}

function BookingCard({ booking: b }: { booking: MyBookingItem }) {
  const upcoming = b.badge === 'confirmed' || b.badge === 'provisional'
  const room = b.displayRoom ? `${b.roomGroupName} ${b.displayRoom}` : b.roomGroupName
  return (
    <li className="rounded-xl border border-line bg-white p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{bookingWhen(b)}</span>
        <StatusBadge kind={b.badge} />
      </div>
      <p className="mt-1 text-sub">
        {b.storeCode} {b.storeName} / {room} / {yen(b.total)}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-xs text-sub">
          {upcoming &&
            (b.badge === 'provisional' ? '部屋は前日に確定' : '入室コードは前日にお知らせ')}
        </p>
        <Link
          href={bookingPath(b.bookingCode)}
          className="shrink-0 rounded-lg border border-brand px-3 py-1.5 font-bold text-brand-dark"
        >
          予約詳細
        </Link>
      </div>
    </li>
  )
}

function NavButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-brand bg-white py-2 text-center font-bold text-brand-dark"
    >
      {label}
    </Link>
  )
}

function load(memberId: number) {
  return withContainer((c) => c.getMyPage(memberId))
}
