'use client'

import { useState } from 'react'

/** Secrets stay in the authenticated page: no public share URL or analytics payload is created. */
export function BookingShare({ text }: { text: string }) {
  const [status, setStatus] = useState('')
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('入店情報をコピーしました')
    } catch {
      setStatus('コピーできませんでした。下の内容を選択してコピーしてください')
    }
  }
  async function share() {
    if (!navigator.share) return copy()
    try {
      await navigator.share({ title: '雀CUBE ご予約の入店情報', text })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setStatus('共有できませんでした。コピーをご利用ください')
    }
  }
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="font-bold">お仲間へ入店情報を共有する</h2>
      <p className="mt-1 text-xs text-sub">
        入室コードが含まれます。ご利用のお仲間にのみ共有してください。
      </p>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={copy}
          className="flex-1 rounded-lg border border-brand p-3 font-bold text-brand-dark"
        >
          コピー
        </button>
        <button
          type="button"
          onClick={share}
          className="flex-1 rounded-lg bg-brand p-3 font-bold text-white"
        >
          共有する
        </button>
      </div>
      <p role="status" className="mt-2 text-sm">
        {status}
      </p>
      <details className="mt-2 text-sm">
        <summary>共有内容を確認する</summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans">{text}</pre>
      </details>
    </section>
  )
}
