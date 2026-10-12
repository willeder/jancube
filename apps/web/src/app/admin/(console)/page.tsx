import { Notice, PageHeader } from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'

export const dynamic = 'force-dynamic'

/** A-02 ダッシュボード */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>
}) {
  const staff = await requireStaff()
  const { denied } = await searchParams
  return (
    <>
      <PageHeader title="ダッシュボード" description={`${staff.name} さん`} />
      {denied && <Notice tone="red">この画面を表示する権限がありません</Notice>}
    </>
  )
}
