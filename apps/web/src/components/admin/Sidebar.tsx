'use client'

import type { ReactNode } from 'react'
import { useId, useState } from 'react'

/** The desktop sidebar becomes a keyboard-accessible disclosure on smaller screens. */
export function AdminSidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  return (
    <aside className="admin-sidebar" data-open={open}>
      <button
        type="button"
        className="admin-menu-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>🀄 雀CUBE 管理</span>
        <span>{open ? '閉じる' : 'メニュー'}</span>
      </button>
      <div id={contentId} className="admin-sidebar-body">
        {children}
      </div>
    </aside>
  )
}
