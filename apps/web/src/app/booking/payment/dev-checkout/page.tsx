import { notFound } from 'next/navigation'
import { devCheckoutAction } from '@/server/payment-actions'
import { runtimeConfig } from '@/server/runtime-config'

export const dynamic = 'force-dynamic'

/**
 * Development stand-in for C-10 (the provider's hosted payment page), used when no Stripe test keys
 * are configured. Not reachable when Stripe is configured or outside development.
 */
export default async function DevCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; success?: string; cancel?: string }>
}) {
  const config = runtimeConfig()
  if (!config.isDevelopment || config.stripe) notFound()
  const { session, success, cancel } = await searchParams
  if (!session || !success || !cancel) notFound()

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <p className="rounded-lg bg-gold-pale p-3 text-sm">
        開発用の決済画面です。本番では Stripe の決済ページが表示されます
      </p>
      <form action={devCheckoutAction} className="space-y-3">
        <input type="hidden" name="session" value={session} />
        <input type="hidden" name="success" value={success} />
        <input type="hidden" name="cancel" value={cancel} />
        <button
          type="submit"
          name="outcome"
          value="paid"
          className="w-full rounded-xl bg-brand py-3 font-bold text-white"
        >
          お支払いを確定する（成功）
        </button>
        <button
          type="submit"
          name="outcome"
          value="canceled"
          className="w-full rounded-xl border border-brand py-3 font-bold text-brand"
        >
          戻る（キャンセル）
        </button>
      </form>
    </main>
  )
}
