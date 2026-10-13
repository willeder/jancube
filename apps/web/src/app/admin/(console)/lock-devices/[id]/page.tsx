import { visibleStoreIds } from '@jancube/domain'
import { Notice, PageHeader } from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { DeviceForm } from '../DeviceForm'

export const dynamic = 'force-dynamic'

/** A-20 デバイスの編集 */
export default async function EditLockDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff('stores.manage')
  const { id } = await params
  const visible = visibleStoreIds(staff.access, 'stores.manage')
  try {
    const [device, stores] = await withContainer(
      async (c) =>
        [
          await c.getLockDevice(staff, Number(id) || 0),
          (await c.listAdminStores()).filter((s) => visible === null || visible.includes(s.id)),
        ] as const,
    )
    return (
      <>
        <PageHeader
          title={`鍵デバイス — ${device.name}`}
          description="無効にすると入室コードの発行に使われなくなります"
        />
        <DeviceForm device={device} stores={stores} />
      </>
    )
  } catch (error) {
    if (!isDomainError(error)) throw error
    return (
      <>
        <PageHeader title="鍵デバイス" />
        <Notice tone="red">{toUserMessage(error)}</Notice>
      </>
    )
  }
}
