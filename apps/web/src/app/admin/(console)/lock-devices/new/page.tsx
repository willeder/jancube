import { visibleStoreIds } from '@jancube/domain'
import { PageHeader } from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { DeviceForm } from '../DeviceForm'

export const dynamic = 'force-dynamic'

/** A-20 デバイスを登録 */
export default async function NewLockDevicePage() {
  const staff = await requireStaff('stores.manage')
  const visible = visibleStoreIds(staff.access, 'stores.manage')
  const stores = (await withContainer((c) => c.listAdminStores())).filter(
    (s) => visible === null || visible.includes(s.id),
  )
  return (
    <>
      <PageHeader
        title="鍵デバイスを登録"
        description="店舗入口のスマートロックを登録します（1店舗につき有効なデバイスは1台）"
      />
      <DeviceForm device={null} stores={stores} />
    </>
  )
}
