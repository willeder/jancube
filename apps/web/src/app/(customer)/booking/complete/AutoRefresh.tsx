'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Re-renders the server page every few seconds while a payment is being confirmed. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(timer)
  }, [router, seconds])
  return null
}
