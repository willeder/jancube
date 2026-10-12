import Link from 'next/link'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** C-01 店舗選択 */
export default async function StoreSelectPage() {
  const stores = await withContainer((c) => c.listStores())

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="mb-1 text-lg font-bold">店舗を選ぶ</h1>
      <p className="mb-4 text-sm text-sub">
        タップするとそのまま日時選択へ進みます。同じ会員IDで全店舗ご利用いただけます
      </p>
      <ul className="space-y-3">
        {stores.map((s) => (
          <li key={s.code}>
            <Link
              href={`/booking/${s.code}/date`}
              className="block rounded-xl border border-line bg-white p-4 transition hover:border-brand"
            >
              <div className="font-bold">
                {s.code} {s.name}
              </div>
              {s.accessText && <p className="mt-1 text-sm text-sub">{s.accessText}</p>}
              <p className="mt-1 text-xs text-sub">{s.address}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
