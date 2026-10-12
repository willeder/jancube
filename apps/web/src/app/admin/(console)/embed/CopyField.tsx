'use client'

import { useState } from 'react'
import { buttonClass } from '@/components/admin/ui'

/** Read-only code box with a copy button (A-29). */
export function CopyField({
  label,
  value,
  rows = 3,
}: {
  label: string
  value: string
  rows?: number
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="text-sm font-bold">{label}</div>
      <textarea
        readOnly
        value={value}
        rows={rows}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
      />
      <button type="button" onClick={copy} className={`${buttonClass.secondary} w-full`}>
        {copied ? 'コピーしました' : 'コードをコピー'}
      </button>
    </div>
  )
}
