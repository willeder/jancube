import { utcToLocal } from '@jancube/domain'
import { redirect } from 'next/navigation'
import { BookingFlow } from '@/components/BookingFlow'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel } from '@/components/StoreBar'
import { dateLabel } from '@/lib/format'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { readSessionMemberId } from '@/server/session'
import { CouponCodeForm, PaymentForm } from './PaymentForm'

export const dynamic = 'force-dynamic'

/** C-09 クーポン・決済方法選択 */
export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ coupon?: string; canceled?: string }>
}) {
  const { coupon, canceled } = await searchParams
  const memberId = await readSessionMemberId()
  if (!memberId) redirect('/booking/auth')
  let options: Awaited<ReturnType<typeof load>>
  try {
    options = await load(await readHoldKey(), memberId)
  } catch (error) {
    if (isDomainError(error, 'verification_required')) redirect('/booking/auth')
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }
  const { hold, coupons, bestGrantId } = options
  const claimed = coupons.find((c) => String(c.grantId) === coupon && c.discount !== null)

  return (
    <BookingFlow step={6} storeName={hold.storeName} backHref="/booking/confirm">
      <div>
        <h1 className="text-base font-bold">クーポンとお支払い方法</h1>
        <p className="text-sm text-sub">
          {dateLabel(hold.businessDate)} / {hold.roomGroupName}
          {hold.requestedRoomName ? ` ${hold.requestedRoomName}` : ''}（{hold.bookingCode}）
        </p>
      </div>
      {canceled && (
        <p className="rounded-lg bg-gold-pale p-3 text-sm">
          お支払いは完了していません。内容をご確認のうえ、もう一度お進みください
        </p>
      )}
      <PaymentForm
        subtotal={hold.subtotal}
        coupons={coupons.map((c) => ({
          grantId: c.grantId,
          name: c.couponName,
          note: c.conditionsNote,
          // Validity ends are exclusive instants; show the last day they can be used.
          expiresAt: dateLabel(utcToLocal(new Date(c.expiresAt.getTime() - 1), hold.timezone).date),
          discount: c.discount,
        }))}
        initialGrantId={claimed?.grantId ?? bestGrantId}
        codeForm={<CouponCodeForm />}
      />
      <HoldCountdown
        expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()}
        storeCode={hold.storeCode}
      />
      <p className="text-xs text-sub">
        お支払いにより、キャンセルポリシー（24時間前まで無料 / 24時間以内50% /
        開始以降100%）に同意したものとみなします
      </p>
    </BookingFlow>
  )
}

function load(holdKey: string | null, memberId: number) {
  return withContainer((c) => c.getPaymentOptions(holdKey, memberId))
}
