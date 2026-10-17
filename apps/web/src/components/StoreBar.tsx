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
    <main className="customer-content text-center">
      <p
        role="alert"
        className="rounded-[14px] border border-alert/30 bg-alert-pale p-3.5 text-alert"
      >
        {message}
      </p>
      <Link
        href={backHref}
        className="inline-block rounded-xl border-[1.5px] border-brand bg-white px-3 py-[13px] text-[15px] font-bold text-brand-dark"
      >
        ‹ 戻る
      </Link>
    </main>
  )
}
