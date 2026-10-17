'use client'

import { useEffect, useState } from 'react'

/** ⏳ 仮押さえ残り mm:ss — shows the C-21 hold-expired screen when the hold runs out. */
export function HoldCountdown({ expiresAt, storeCode }: { expiresAt: string; storeCode?: string }) {
  const [left, setLeft] = useState(() => remaining(expiresAt))

  useEffect(() => {
    const timer = setInterval(() => {
      const ms = remaining(expiresAt)
      setLeft(ms)
      if (ms <= 0) {
        clearInterval(timer)
        const query = storeCode ? `?store=${encodeURIComponent(storeCode)}` : ''
        window.location.assign(`/booking/expired${query}`)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [expiresAt, storeCode])

  const total = Math.max(0, Math.floor(left / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return (
    <p className="hold-countdown rounded-lg bg-gold-pale p-3 text-sm">
      ⏳ 仮押さえ残り{' '}
      <span className="font-bold tabular-nums">
        {mm}:{ss}
      </span>
      ・時間内に決済が完了しない場合は自動解放されます
    </p>
  )
}

function remaining(expiresAt: string): number {
  return new Date(expiresAt).getTime() - Date.now()
}
