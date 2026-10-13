import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import { buttonClass, Card, Notice, PageHeader } from '@/components/admin/ui'
import { updateRoomAction } from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'
import { RoomFields } from '../RoomFields'

export const dynamic = 'force-dynamic'

/** A-19 部屋の編集 */
export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const staff = await requireStaff('stores.manage')
  const id = Number((await params).id)
  const { created } = await searchParams
  if (!Number.isInteger(id)) notFound()
  const room = await withContainer((c) => c.getRoom(staff, id)).catch((e) => {
    if (isDomainError(e, 'room_not_found', 'forbidden')) notFound()
    throw e
  })

  return (
    <>
      <PageHeader
        title={`部屋の編集 — ${room.code}`}
        description={`${room.roomTypeName} / ${room.groupName} / 料金: ${room.priceProfileName ?? '未設定'}`}
        actions={
          <Link href={`/admin/rooms?store=${room.storeId}`} className={buttonClass.secondary}>
            部屋マスタへ戻る
          </Link>
        }
      />
      {created && (
        <div className="mb-4">
          <Notice tone="green">
            部屋を追加しました。A-16 料金プロファイルで料金を割り当ててください。
          </Notice>
        </div>
      )}
      <Card className="max-w-3xl">
        <ActionForm action={updateRoomAction} submitLabel="保存する">
          <input type="hidden" name="roomId" value={room.id} />
          <RoomFields d={room} />
        </ActionForm>
        {room.photos.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {room.photos.map((p) => (
              // biome-ignore lint/performance/noImgElement: staff-entered external URLs, preview only
              <img
                key={p.url}
                src={p.url}
                alt={p.alt ?? room.code}
                className="h-20 w-32 rounded object-cover"
              />
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
