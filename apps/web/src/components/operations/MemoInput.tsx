'use client'

import { useId, useState } from 'react'

/** A single real textarea keeps the memo counter, browser validation, and posted value aligned. */
export function MemoInput() {
  const [body, setBody] = useState('')
  const countId = useId()
  return (
    <label className="block text-[12.5px] font-bold text-sub">
      メモ（複数行・自由入力）
      <textarea
        name="body"
        required
        maxLength={500}
        rows={5}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        aria-describedby={countId}
        className="mt-1.5 block w-full rounded-lg border-[1.5px] border-line bg-white px-3 py-[9px] text-base font-normal text-ink"
        placeholder="清掃や備品対応などの作業内容を入力してください"
      />
      <span id={countId} className="mt-1 block text-right text-[11px] font-normal tabular-nums">
        {body.length} / 500
      </span>
    </label>
  )
}
