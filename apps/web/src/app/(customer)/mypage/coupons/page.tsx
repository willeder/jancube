import type { MyCoupon } from '@jancube/application'
import Link from 'next/link'
import { PageHeader } from '@/components/MyPageParts'
import { ErrorPanel } from '@/components/StoreBar'
import { hhmm, localDate, WEEKDAYS, yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { requireMemberPage } from '@/server/member-page'

export const dynamic = 'force-dynamic'

const TZ = 'Asia/Tokyo'

/** C-16 クーポン一覧: remaining uses and expiry of the member's coupons. */
export default async function CouponsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const memberId = await requireMemberPage('/mypage/coupons')
  let list: Awaited<ReturnType<typeof load>>
  try {
    list = await load(memberId)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/mypage" />
  }
  const showUsed = tab === 'used'
  const coupons = showUsed ? list.inactive : list.usable

  return (
    <>
      <PageHeader backHref="/mypage" title="クーポン" />
      <main className="customer-content ">
        <div className="flex flex-wrap gap-2">
          <Tab href="/mypage/coupons" active={!showUsed} label={`利用可能 ${list.usable.length}`} />
          <Tab
            href="/mypage/coupons?tab=used"
            active={showUsed}
            label={`利用済・失効 ${list.inactive.length}`}
          />
        </div>
        {coupons.length === 0 ? (
          <p className="rounded-[14px] border border-line bg-white p-3.5 text-sm text-sub">
            {showUsed
              ? '利用済・失効したクーポンはありません'
              : 'ご利用いただけるクーポンはありません'}
          </p>
        ) : (
          <ul className="space-y-3">
            {coupons.map((c) => (
              <CouponCard key={c.grantId} coupon={c} />
            ))}
          </ul>
        )}
        <p className="text-xs text-sub">
          クーポンはお支払い画面で選んで使えます。1回のご予約に使えるクーポンは1枚です
        </p>
      </main>
    </>
  )
}

function CouponCard({ coupon: c }: { coupon: MyCoupon }) {
  const usable = c.state === 'usable' || c.state === 'not_started'
  return (
    <li
      className={`rounded-[14px] border bg-white p-3.5 text-[13px] ${usable ? 'border-2 border-brand' : 'border-line bg-[#f3f2ee] text-sub'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold">{c.couponName}</p>
          <p className={usable ? 'font-bold text-brand' : ''}>{discountLabel(c)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
            usable ? 'bg-brand-pale text-brand-dark' : 'bg-line/60'
          }`}
        >
          {stateLabel(c)}
        </span>
      </div>
      <p className="mt-2 text-xs text-sub">{conditions(c).join(' / ')}</p>
      {c.conditionsNote && <p className="mt-1 text-xs text-sub">{c.conditionsNote}</p>}
    </li>
  )
}

/** Validity ends at an exclusive instant (e.g. 00:00 on 1 Jan) → show the last valid day. */
function lastDay(expiresAt: Date): string {
  return localDate(new Date(expiresAt.getTime() - 1), TZ)
}

function discountLabel(c: MyCoupon): string {
  if (c.discountType === 'amount') return `${yen(c.discountValue)}OFF`
  const cap = c.maximumDiscount ? `（上限${yen(c.maximumDiscount)}）` : ''
  return `${c.discountValue}%OFF${cap}`
}

function stateLabel(c: MyCoupon): string {
  switch (c.state) {
    case 'usable':
      return `残り${c.remaining}回`
    case 'not_started':
      return `${localDate(c.validFrom, TZ)}から`
    case 'used':
      return c.lastUsedAt ? `${localDate(c.lastUsedAt, TZ)} 利用済` : '利用済'
    case 'expired':
      return `${lastDay(c.expiresAt)} 失効`
    case 'revoked':
      return '取消'
    case 'disabled':
      return '配布終了'
  }
}

function conditions(c: MyCoupon): string[] {
  const list = [`有効期限 ${lastDay(c.expiresAt)}`]
  list.push(c.storeCodes.length > 0 ? c.storeCodes.join('・') : '全店舗')
  if (c.weekdayMask !== 127) {
    list.push(`${WEEKDAYS.filter((_, i) => (c.weekdayMask & (1 << i)) !== 0).join('')}曜日`)
  }
  if (c.startMinute !== null && c.endMinute !== null) {
    list.push(`${hhmm(c.startMinute)}-${hhmm(c.endMinute)}開始`)
  }
  if (c.minimumSpend > 0) list.push(`${yen(c.minimumSpend)}以上のご利用`)
  list.push('併用不可')
  return list
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-xl border-[1.5px] px-3 py-[7px] text-center text-[13.5px] font-bold ${active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink'}`}
    >
      {label}
    </Link>
  )
}

function load(memberId: number) {
  return withContainer((c) => c.listMyCoupons(memberId))
}
