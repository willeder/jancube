'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Shared customer typography, with progress styling restricted to the booking journey. */
export function CustomerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const booking = pathname === '/' || pathname.startsWith('/booking/')
  return <div className={`customer-shell${booking ? ' booking-flow' : ''}`}>{children}</div>
}
