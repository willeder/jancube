import Link from 'next/link'
import { safeNext } from '@/server/line-session'

export const dynamic = 'force-dynamic'

/** L-03 step 4: linked; continue to where the customer was going (booking flow by default). */
export default async function LiffLinkDonePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safeNext((await searchParams).next)
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">LINE連携が完了しました</h1>
        <p className="mt-1 text-sm text-sub">
          次回からはLINEでログインしてご利用いただけます。
          お知らせの受取方法はマイページのアカウント設定で確認・変更できます
        </p>
      </div>
      <p className="rounded-xl bg-white p-4 text-sm">LINEアカウントとの連携が完了しました。</p>
      <Link href={next} className="block rounded-xl bg-brand py-3 text-center font-bold text-white">
        {next === '/' ? '予約を始める' : '続ける'}
      </Link>
    </main>
  )
}
