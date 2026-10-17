import type { BookingSummary } from '@jancube/application'
import { redirect } from 'next/navigation'
import { PhoneForm } from '@/components/auth/PhoneForm'
import { BookingFlow } from '@/components/BookingFlow'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel } from '@/components/StoreBar'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { readSessionMemberId } from '@/server/session'

export const dynamic = 'force-dynamic'

/** C-05 電話番号入力 (F-AUTH-01) */
export default async function PhonePage() {
  let hold: BookingSummary
  try {
    const key = await readHoldKey()
    hold = await withContainer((c) => c.getActiveHold(key))
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }
  const memberId = await readSessionMemberId()
  if (memberId && hold.memberId === memberId) redirect('/booking/payment')

  return (
    <BookingFlow step={5} storeName={hold.storeName} backHref="/booking/confirm">
      <div>
        <h1 className="text-base font-bold">電話番号の確認</h1>
        <p className="text-sm text-sub">
          SMSで認証コードをお送りします。ご登録済みの方はそのままログインになります
        </p>
      </div>
      <PhoneForm />
      <HoldCountdown
        expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()}
        storeCode={hold.storeCode}
      />
    </BookingFlow>
  )
}
