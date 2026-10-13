import Link from 'next/link'
import { localDateTime, localTime, TASK_TYPE_LABEL } from '@/components/operations/time'
import { requireCleaningSelection } from '@/server/cleaning-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

const PERIODS = [
  { key: 'day', label: '本日' },
  { key: 'week', label: '今週' },
  { key: 'month', label: '今月' },
] as const

/** K-03 清掃ログ */
export default async function CleaningLogPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { staff, selection } = await requireCleaningSelection()
  const { period: raw } = await searchParams
  const period = PERIODS.find((p) => p.key === raw)?.key ?? 'day'
  const data = await withContainer((c) => c.getCleaningLog(staff, selection.storeId, period))
  const tz = data.store.timezone
  const label = PERIODS.find((p) => p.key === period)?.label ?? '本日'
  const memos = data.activities.filter((a) => a.action === 'memo')
  const time = (d: Date) => (period === 'day' ? localTime(d, tz) : localDateTime(d, tz))

  return (
    <>
      <Link href="/cleaning" className="text-sm font-bold text-brand-dark">
        ‹ 前の画面に戻る
      </Link>
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/cleaning/log?period=${p.key}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-bold ${
              p.key === period ? 'border-brand bg-brand text-white' : 'border-line bg-white'
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <section className="rounded-xl border border-line bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="font-bold">{label}の完了</span>
          <span className="text-2xl font-bold text-brand-dark">{data.counts.total}件</span>
        </div>
        <p className="mt-1 text-xs text-sub">
          開店前 {data.counts.opening}件 / スポット {data.counts.spot}件 ・ 期限超過{' '}
          {data.counts.overdue}件
        </p>
      </section>
      <h2 className="font-bold">
        {label}の清掃ログ({data.store.code})
      </h2>
      {data.logs.length === 0 ? (
        <p className="text-sm text-sub">まだ完了した清掃はありません</p>
      ) : (
        [...data.logs].reverse().map((l) => (
          <div key={l.taskId} className="rounded-xl border border-line bg-white p-3">
            <div className="flex items-center justify-between">
              <span>
                <span className="font-bold">{l.roomName}</span>{' '}
                <span className="rounded-full bg-brand-pale px-2 py-0.5 text-xs font-bold text-brand-dark">
                  {TASK_TYPE_LABEL[l.taskType]}
                </span>
                {l.wasOverdue && (
                  <span className="ml-1 text-xs font-bold text-alert">期限超過</span>
                )}
              </span>
              <span className="text-sm">{time(l.completedAt)}</span>
            </div>
            <div className="mt-1 text-xs text-sub">
              {l.workerName}
              {l.startedAt &&
                ` ・ 所要 ${Math.max(0, Math.round((l.completedAt.getTime() - l.startedAt.getTime()) / 60_000))}分`}
              {l.notes && ` ・ ${l.notes}`}
            </div>
          </div>
        ))
      )}
      {memos.length > 0 && (
        <>
          <h2 className="font-bold">活動メモ</h2>
          <ul className="space-y-2">
            {[...memos].reverse().map((m) => (
              <li key={m.id} className="rounded-xl border border-line bg-white p-3 text-sm">
                <div className="flex justify-between text-xs text-sub">
                  <span>
                    {m.roomName} ・ 入力: {m.staffName}
                  </span>
                  <span>{time(m.occurredAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-sub">
        ※
        清掃ログは「1日1回清掃で品質が保てるか」「清掃負荷」の検証データとして集計されます(開始・完了の打刻で所要時間も記録)
      </p>
    </>
  )
}
