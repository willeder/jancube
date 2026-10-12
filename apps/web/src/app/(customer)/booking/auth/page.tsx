import type { BookingSummary } from '@jancube/application'
import { redirect } from 'next/navigation'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel, StoreBar } from '@/components/StoreBar'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { readSessionMemberId } from '@/server/session'
import { PhoneForm } from './PhoneForm'

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
    <>
      <StoreBar storeName={hold.storeName} backHref="/booking/confirm" />
      <main className="mx-auto max-w-md space-y-4 px-4 py-5">
        <div>
          <h1 className="text-lg font-bold">電話番号の確認</h1>
          <p className="mt-1 text-sm text-sub">
            SMSで認証コードをお送りします。ご登録済みの方はそのままログインになります
          </p>
        </div>
        <PhoneForm />
        <HoldCountdown expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()} />
      </main>
    </>
  )
}
