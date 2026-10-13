'use client'

import Link from 'next/link'

/** C-21: unexpected errors on customer screens (details stay in the server log). */
export default function CustomerError({ retry }: { error: Error; retry: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <section className="rounded-xl border border-line bg-white p-6 text-center">
        <div aria-hidden className="text-4xl">
          ⚠️
        </div>
        <h1 className="mt-3 text-lg font-bold">エラーが発生しました</h1>
        <p className="mt-2 text-sm text-sub">
          お手数ですが、時間をおいて再度お試しください。解決しない場合は店舗までお問い合わせください
        </p>
      </section>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-5 block w-full rounded-xl bg-brand py-3 text-center font-bold text-white"
      >
        もう一度試す
      </button>
      <Link href="/" className="mt-3 block text-center text-sm font-bold text-brand-dark">
        トップへ戻る
      </Link>
    </main>
  )
}
