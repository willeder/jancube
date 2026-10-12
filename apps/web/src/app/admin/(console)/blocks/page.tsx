import type { BlockRoom, RoomBlockRow } from '@jancube/application'
import { minuteOfBusinessDay, utcToLocal } from '@jancube/domain'
import { DEFAULT_TIMEZONE } from '@/components/admin/booking-format'
import { buttonClass, Notice, PageHeader, Table } from '@/components/admin/ui'
import { hhmm } from '@/lib/format'
import { releaseBlockAction } from '@/server/admin-booking-actions'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { BlockForm } from './BlockForm'

export const dynamic = 'force-dynamic'

/** A-22 枠ブロック: times that cannot be booked (maintenance, private events, holidays). */
export default async function BlocksPage({
  searchParams,
}: {
  searchParams: Promise<{ released?: string; error?: string }>
}) {
  const staff = await requireStaff('bookings.manage')
  const { released, error } = await searchParams
  let blocks: RoomBlockRow[] = []
  let stores: { id: number; code: string; name: string; rooms: BlockRoom[] }[] = []
  let loadError: string | null = null
  try {
    ;({ blocks, stores } = await withContainer(async (c) => {
      const selected = await selectedStoreId(staff, 'bookings.manage')
      const all = await c.listAdminStores()
      const list = await c.listRoomBlocks(staff.access, selected)
      const targets = all.filter((s) => (selected === null ? true : s.id === selected))
      const withRooms = []
      for (const s of targets) {
        const rooms = await c.listBlockRooms(staff.access, s.id).catch(() => null)
        if (rooms) withRooms.push({ id: s.id, code: s.code, name: s.name, rooms })
      }
      return { blocks: list, stores: withRooms }
    }))
  } catch (e) {
    loadError = toUserMessage(e)
  }
  const today = utcToLocal(new Date(), DEFAULT_TIMEZONE).date

  return (
    <>
      <PageHeader
        title="枠ブロック"
        description="設備メンテナンス・貸切などで予約を受け付けない枠を設定します。確定済みの予約と重なる枠はブロックできません"
      />
      {released && (
        <div className="mb-3">
          <Notice tone="green">ブロックを解除しました</Notice>
        </div>
      )}
      {(error || loadError) && (
        <div className="mb-3">
          <Notice tone="red">{error ?? loadError}</Notice>
        </div>
      )}
      {stores.length > 0 && <BlockForm stores={stores} today={today} />}

      <h2 className="mt-6 mb-2 font-bold">設定中のブロック</h2>
      <Table
        head={['店舗', '部屋', '日付', '時間帯', '理由', '登録者', '操作']}
        rows={blocks.map((k) => {
          const start = utcToLocal(k.start, DEFAULT_TIMEZONE)
          const end = minuteOfBusinessDay(start.date, k.end, DEFAULT_TIMEZONE)
          return [
            k.storeCode,
            k.roomName,
            start.date,
            `${hhmm(start.minuteOfDay)}-${hhmm(end)}`,
            k.reason,
            k.createdByName ?? '—',
            <form key="r" action={releaseBlockAction}>
              <input type="hidden" name="blockId" value={k.id} />
              <button type="submit" className={buttonClass.secondary}>
                解除
              </button>
            </form>,
          ]
        })}
        empty="設定中のブロックはありません"
      />
    </>
  )
}
