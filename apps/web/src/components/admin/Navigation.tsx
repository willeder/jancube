'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavItem } from './nav'

const PRIMARY = [
  '/admin',
  '/admin/timeline',
  '/admin/cleaning',
  '/admin/coupons',
  '/admin/prices',
  '/admin/rooms',
  '/admin/members',
] as const

/** Permission-filtered items come from the server; the client only tracks navigation state. */
export function AdminNavigation({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname()
  const active = [...items]
    .sort((a, b) => b.href.length - a.href.length)
    .find(
      (item) =>
        pathname === item.href || (item.href !== '/admin' && pathname.startsWith(`${item.href}/`)),
    )?.href
  const link = (item: NavItem) => (
    <Link
      href={item.href}
      aria-current={active === item.href ? 'page' : undefined}
      className="admin-nav-link"
    >
      {item.label}
    </Link>
  )
  const secondary = items.filter((item) => !PRIMARY.some((href) => href === item.href))
  const groups = [
    {
      name: '予約・クーポンの操作',
      items: secondary.filter((item) =>
        ['A-04', 'A-06', 'A-09', 'A-15', 'A-22'].includes(item.screen),
      ),
    },
    {
      name: 'マスタ・設定',
      items: secondary.filter((item) =>
        ['A-17', 'A-18', 'A-20', 'A-21', 'A-23'].includes(item.screen),
      ),
    },
    {
      name: '運用・レポート',
      items: secondary.filter((item) => ['A-24', 'A-25', 'A-26', 'A-27'].includes(item.screen)),
    },
  ]
  return (
    <nav aria-label="管理メニュー" className="admin-navigation">
      {PRIMARY.map((href) => {
        const item = items.find((entry) => entry.href === href)
        return item ? <div key={href}>{link(item)}</div> : null
      })}
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <details
            key={`${group.name}:${pathname}`}
            open={group.items.some((item) => item.href === active)}
            className="admin-nav-group"
          >
            <summary>{group.name}</summary>
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>{link(item)}</li>
              ))}
            </ul>
          </details>
        ))}
    </nav>
  )
}
