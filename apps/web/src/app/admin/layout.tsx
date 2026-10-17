import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: '雀CUBE 管理' }

/** Shared type and form styling for the console, sign-in, and password screens. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin-surface">{children}</div>
}
