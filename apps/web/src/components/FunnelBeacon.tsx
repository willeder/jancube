'use client'

import { useEffect } from 'react'

/**
 * F-RPT-01: reports a booking-page view once per mount (server: /api/funnel). Renders nothing and
 * never blocks the page; the page's query string carries UTM tags to the server.
 */
export function FunnelBeacon({
  step,
  store,
}: {
  step: 'store_selected' | 'slots_viewed'
  store: string
}) {
  useEffect(() => {
    const body = JSON.stringify({ step, store, search: window.location.search })
    fetch('/api/funnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  }, [step, store])
  return null
}
