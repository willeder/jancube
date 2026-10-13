import type { Dashboard } from '@jancube/application'
import { can } from '@jancube/domain'
import Link from 'next/link'
import { BOOKING_SOURCE, bookingTimes, StatusBadge } from '@/components/admin/booking-format'
import { Card, Notice, PageHeader, Stat, Table, TextLink } from '@/components/admin/ui'
import { dateLabel, yen } from '@/lib/format'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

/**
 * A-02 ダッシュボード. Required metrics, their period and scope are open (tracker #25); the figures
 * below are the wireframe's first set and their definitions are listed on the screen.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>
}) {
  const staff = await requireStaff()
  const { denied } = await searchParams
  const header = <PageHeader title="ダッシュボード" description={`${staff.name} さん`} />
  if (!can(staff.access, 'dashboard.view')) {
    return (
      <>
        {header}
        {denied && <Notice tone="red">この画面を表示する権限がありません</Notice>}
      </>
    )
  }

  let data: Dashboard
  try {
    const storeId = await selectedStoreId(staff, 'dashboard.view')
    data = await withContainer((c) => c.getDashboard(staff.access, storeId))
  } catch (error) {
    return (
      <>
        {header}
        <Notice tone="red">{toUserMessage(error)}</Notice>
      </>
    )
  }
  const max = Math.max(1, ...data.daily.map((d) => d.amount))

  return (
    <>
      <PageHeader title="ダッシュボード" description={`${dateLabel(data.today)} 時点`} />
      {denied && (
        <div className="mb-4">
          <Notice tone="red">この画面を表示する権限がありません</Notice>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat value={yen(data.monthSales)} label={`${data.monthLabel}の予約売上`} />
        <Stat
          value={data.utilizationPercent === null ? '—' : `${data.utilizationPercent}%`}
          label={`${data.monthLabel}の予定稼働率`}
        />
        <Stat value={`${data.todayCount}件`} label="本日の予約" />
        <Stat value={`${data.unassignedCount}件`} label="部屋未割当(本日以降)" />
        <Stat value={`${data.roomsNeedingCleaning}室`} label="要清掃" />
      </div>

      <div className="mt-3">
        <Notice>
          【課題#25 未決】必須指標・集計条件・表示範囲は確認中です。現在の定義:
          売上＝確定・利用済の予約金額（利用日基準・当月）/ 稼働率＝予約時間 ÷（稼働中の部屋数 ×
          営業時間）/ 未割当＝本日以降の確定済みグループ予約で部屋が決まっていないもの
        </Notice>
      </div>

      {data.criticalAlerts.length > 0 && (
        <div className="mt-3 rounded-lg border border-alert bg-alert-pale p-3 text-sm text-alert">
          <p className="font-bold">⚠ 重大アラートが {data.criticalAlerts.length} 件あります</p>
          <ul className="mt-1 list-inside list-disc">
            {data.criticalAlerts.map((a) => (
              <li key={a.id}>
                {a.bookingCode ? `${a.bookingCode}: ` : ''}
                {a.failureReason}
              </li>
            ))}
          </ul>
          {can(staff.access, 'alerts.manage') && (
            <Link href="/admin/alerts" className="mt-1 inline-block font-bold underline">
              アラート一覧(A-25)で対応
            </Link>
          )}
        </div>
      )}

      <Card title="日別売上(直近14日)" className="mt-4">
        <div className="flex h-40 items-end gap-2 overflow-x-auto">
          {data.daily.map((d) => (
            <div key={d.date} className="flex min-w-9 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-sub">{d.count}</span>
              <div
                className="w-full rounded-t bg-brand"
                style={{ height: `${Math.max(2, Math.round((d.amount / max) * 100))}px` }}
                title={`${d.date} ${yen(d.amount)} / ${d.count}件`}
              />
              <span className="text-[10px] text-sub">
                {Number(d.date.slice(5, 7))}/{Number(d.date.slice(8))}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-sub">棒の高さ＝売上金額、上の数字＝予約件数</p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-bold">本日の予約</h2>
          <Table
            head={['時間', '部屋', 'お客様', '状態']}
            rows={data.todayBookings.map((b) => [
              bookingTimes(b),
              `${b.roomGroupName} ${b.roomName ?? '(未割当)'}`,
              <TextLink key="c" href={`/admin/bookings/${b.bookingCode}`}>
                {b.customerName ?? b.bookingCode}
              </TextLink>,
              <StatusBadge key="s" status={b.status} />,
            ])}
            empty="本日の予約はありません"
          />
        </section>
        <section>
          <h2 className="mb-2 font-bold">流入元({data.monthLabel})</h2>
          <Table
            head={['流入元', '予約数', '売上']}
            rows={data.sources.map((s) => [
              BOOKING_SOURCE[s.source] ?? s.source,
              `${s.count}件`,
              yen(s.amount),
            ])}
            empty="今月の予約はまだありません"
          />
        </section>
      </div>
    </>
  )
}
