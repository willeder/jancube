import { createFileRoute } from '@tanstack/react-router'
import { listStores } from '../server/stores'

/** C-01 店舗選択 */
export const Route = createFileRoute('/')({
  loader: () => listStores(),
  component: StoreSelect,
})

function StoreSelect() {
  const stores = Route.useLoaderData()
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="mb-1 text-lg font-bold">店舗を選ぶ</h1>
      <p className="mb-4 text-sm text-sub">
        タップするとそのまま日時選択へ進みます。同じ会員IDで全店舗ご利用いただけます
      </p>
      <ul className="space-y-3">
        {stores.map((s) => (
          <li key={s.code} className="rounded-xl border border-line bg-white p-4">
            <div className="font-bold">
              {s.code} {s.name}
            </div>
            {s.accessText && <p className="mt-1 text-sm text-sub">{s.accessText}</p>}
            <p className="mt-1 text-xs text-sub">{s.address}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
