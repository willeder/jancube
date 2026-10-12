import { redirect } from 'next/navigation'
import { HoldCountdown } from '@/components/HoldCountdown'
import { ErrorPanel, StoreBar } from '@/components/StoreBar'
import { yen } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { readHoldKey } from '@/server/hold-cookie'
import { readSessionMemberId } from '@/server/session'

export const dynamic = 'force-dynamic'

/** C-09 お支払い — placeholder until coupons and Stripe Checkout are added. */
export default async function PaymentPage() {
  const memberId = await readSessionMemberId()
  if (!memberId) redirect('/booking/auth')
  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(await readHoldKey(), memberId)
  } catch (error) {
    return <ErrorPanel message={toUserMessage(error)} backHref="/" />
  }
  const { hold, member } = view
  if (hold.memberId !== memberId) redirect('/booking/auth')

  return (
    <>
      <StoreBar storeName={hold.storeName} backHref="/booking/confirm" />
      <main className="mx-auto max-w-md space-y-4 px-4 py-5">
        <h1 className="text-lg font-bold">お支払い</h1>
        <section className="rounded-xl border border-line bg-white p-4 text-sm">
          <p>
            {member?.familyName} {member?.givenName} 様（{hold.bookingCode}）
          </p>
          <p className="mt-2 flex justify-between font-bold">
            <span>税込合計</span>
            <span className="text-lg text-brand-dark">{yen(hold.total)}</span>
          </p>
        </section>
        <HoldCountdown expiresAt={(hold.holdExpiresAt ?? new Date()).toISOString()} />
      </main>
    </>
  )
}

function load(holdKey: string | null, memberId: number) {
  return withContainer(async (c) => ({
    hold: await c.getActiveHold(holdKey),
    member: await c.findMember(memberId),
  }))
}
