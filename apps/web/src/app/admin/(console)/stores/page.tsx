import { visibleStoreIds } from '@jancube/domain'
import Link from 'next/link'
import { hhmm, STORE_STATUS_LABELS } from '@/components/admin/format'
import { Badge, buttonClass, PageHeader, Table, TextLink } from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** A-18 店舗マスタ一覧 */
export default async function StoresPage() {
  const staff = await requireStaff('stores.manage')
  const stores = await withContainer((c) => c.listStoreMasters(staff))
  const canCreate = visibleStoreIds(staff.access, 'stores.manage') === null

  return (
    <>
      <PageHeader
        title="店舗マスタ"
        description="店舗の基本情報・営業時間・清掃バッファ・新システム受付開始日を管理します"
        actions={
          canCreate && (
            <Link href="/admin/stores/new" className={buttonClass.primary}>
              + 店舗を追加
            </Link>
          )
        }
      />
      <Table
        head={[
          'コード',
          '店舗名',
          '住所',
          '営業時間(月)',
          '清掃バッファ',
          '受付開始日',
          '予約受付',
          '公開',
          '状態',
        ]}
        rows={stores.map((s) => {
          const monday = s.weekly.find((w) => w.weekday === 1)
          return [
            <TextLink key="c" href={`/admin/stores/${s.id}`}>
              {s.code}
            </TextLink>,
            s.name,
            s.address,
            monday
              ? monday.isClosed
                ? '定休'
                : `${hhmm(monday.opensMinute)}-${hhmm(monday.closesMinute)}`
              : '未設定',
            `${s.cleaningBufferMinutes}分`,
            s.bookingOpenDate,
            `${s.bookingHorizonDays}日先まで`,
            s.isActive ? '公開' : '非公開',
            <Badge
              key="s"
              tone={s.status === 'open' ? 'green' : s.status === 'preparing' ? 'gold' : 'gray'}
            >
              {STORE_STATUS_LABELS[s.status]}
            </Badge>,
          ]
        })}
      />
    </>
  )
}
