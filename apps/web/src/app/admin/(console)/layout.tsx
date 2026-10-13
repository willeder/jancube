import { can, visibleStoreIds } from '@jancube/domain'
import Link from 'next/link'
import { ADMIN_NAV } from '@/components/admin/nav'
import { selectStoreAction, staffLogoutAction } from '@/server/admin-auth-actions'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** Admin console shell: store selector (F-ADM-04) and navigation filtered by role (F-ADM-02). */
export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()
  const [stores, storeId] = await Promise.all([
    withContainer((c) => c.listAdminStores()),
    selectedStoreId(staff, 'dashboard.view'),
  ])
  const visible = visibleStoreIds(staff.access, 'dashboard.view')
  const choices = visible === null ? stores : stores.filter((s) => visible.includes(s.id))

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-white px-3 py-4">
        <form action={selectStoreAction} className="mb-4">
          <input type="hidden" name="back" value="/admin" />
          <select
            name="store"
            defaultValue={storeId === null ? 'all' : String(storeId)}
            className="w-full rounded-lg border-2 border-brand-dark px-2 py-2 text-sm font-bold"
            aria-label="店舗"
          >
            {visible === null && <option value="all">全店舗</option>}
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {s.name}
              </option>
            ))}
          </select>
          <button type="submit" className="mt-1 w-full text-xs font-bold text-brand-dark">
            店舗を切り替える
          </button>
        </form>
        <nav className="flex-1 space-y-4 text-sm">
          {ADMIN_NAV.map((section) => {
            const items = section.items.filter((i) => can(staff.access, i.permission))
            if (items.length === 0) return null
            return (
              <div key={section.group}>
                <div className="mb-1 px-2 text-xs font-bold text-sub">{section.group}</div>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block rounded-lg px-2 py-1.5 font-bold hover:bg-brand-pale"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>
        <div className="mt-4 border-t border-line pt-3 text-xs">
          <div className="font-bold">{staff.name}</div>
          <div className="text-sub">{staff.email}</div>
          <form action={staffLogoutAction}>
            <button type="submit" className="mt-2 font-bold text-brand-dark">
              ログアウト
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-5">{children}</main>
    </div>
  )
}
