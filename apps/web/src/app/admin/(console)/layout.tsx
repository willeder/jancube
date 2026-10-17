import { can, visibleStoreIds } from '@jancube/domain'
import { redirect } from 'next/navigation'
import { AdminNavigation } from '@/components/admin/Navigation'
import { ADMIN_NAV } from '@/components/admin/nav'
import { AdminSidebar } from '@/components/admin/Sidebar'
import { StoreSwitcher } from '@/components/admin/StoreSwitcher'
import { staffLogoutAction } from '@/server/admin-auth-actions'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** Admin console shell: store selector (F-ADM-04) and navigation filtered by role (F-ADM-02). */
export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()
  // Cleaning accounts use the dedicated surface, including when following an old admin URL.
  if (!can(staff.access, 'dashboard.view')) redirect('/cleaning')
  const [stores, storeId] = await Promise.all([
    withContainer((c) => c.listAdminStores()),
    selectedStoreId(staff, 'dashboard.view'),
  ])
  const visible = visibleStoreIds(staff.access, 'dashboard.view')
  const choices = visible === null ? stores : stores.filter((s) => visible.includes(s.id))

  return (
    <div className="admin-console">
      <AdminSidebar>
        <StoreSwitcher choices={choices} selected={storeId} allStores={visible === null} />
        <AdminNavigation
          items={ADMIN_NAV.flatMap((section) => section.items).filter(
            (item) => item.href !== '/admin/embed' && can(staff.access, item.permission),
          )}
        />
        <div className="admin-staff-account">
          <div className="font-bold">{staff.name}</div>
          <div className="text-sub">{staff.email}</div>
          <form action={staffLogoutAction}>
            <button type="submit" className="mt-2 font-bold text-brand-dark">
              ログアウト
            </button>
          </form>
        </div>
      </AdminSidebar>
      <main className="admin-content">{children}</main>
    </div>
  )
}
