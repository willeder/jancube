import Link from 'next/link'

/** Back link + 📍 store name, shown on every booking screen after C-01 (F-BK-11). */
export function StoreBar({ storeName, backHref }: { storeName: string; backHref: string }) {
  return (
    <div className="mx-auto max-w-md px-4 pt-3">
      <Link href={backHref} className="text-sm font-bold text-brand-dark">
        ‹ 前の画面に戻る
      </Link>
      <div className="mt-2 rounded-xl bg-brand-dark py-3 text-center font-bold text-white">
        📍 {storeName}
      </div>
    </div>
  )
}

export function ErrorPanel({ message, backHref }: { message: string; backHref: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-10 text-center">
      <p className="rounded-xl bg-alert-pale p-4 text-alert">{message}</p>
      <Link href={backHref} className="mt-6 inline-block font-bold text-brand-dark">
        ‹ 戻る
      </Link>
    </main>
  )
}
