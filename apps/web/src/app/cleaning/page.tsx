import type { CleaningTask } from '@jancube/application'
import Link from 'next/link'
import { Notice } from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import { localTime, remaining } from '@/components/operations/time'
import { requireCleaningSelection } from '@/server/cleaning-session'
import { withContainer } from '@/server/container'
import { cleaningTaskAction, roomMemoAction } from '@/server/operations-actions'

export const dynamic = 'force-dynamic'

const small = 'rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-60'

function TaskCard({
  task,
  typeName,
  storeId,
  detail,
}: {
  task: CleaningTask
  typeName: string
  storeId: number
  detail?: string
}) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-bold">{task.roomName}</span>{' '}
          <span className="text-xs text-sub">{typeName}</span>
          {task.status === 'in_progress' && (
            <span className="ml-1 text-xs font-bold text-brand-dark">清掃中</span>
          )}
          {detail && <div className="text-xs text-sub">{detail}</div>}
        </div>
        <div className="flex shrink-0 gap-1">
          {task.status === 'pending' && (
            <ActionForm action={cleaningTaskAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="step" value="start" />
              <button type="submit" className={`${small} border border-brand text-brand`}>
                開始
              </button>
            </ActionForm>
          )}
          <ActionForm action={cleaningTaskAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="step" value="complete" />
            <button type="submit" className={`${small} bg-brand text-white`}>
              清掃完了
            </button>
          </ActionForm>
        </div>
      </div>
      <details>
        <summary className="cursor-pointer rounded-lg border border-line py-2 text-center text-sm font-bold text-brand-dark">
          ✎ 活動メモを残す
        </summary>
        <ActionForm action={roomMemoAction} className="mt-2 space-y-2">
          <input type="hidden" name="source" value="cleaning" />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="roomId" value={task.roomId} />
          <input type="hidden" name="taskId" value={task.id} />
          <textarea
            name="body"
            required
            maxLength={500}
            rows={3}
            className="w-full rounded-lg border border-line p-2 text-sm"
            placeholder="例）卓のクロスに汚れがあり交換しました"
          />
          <button type="submit" className={`${small} w-full bg-brand text-white`}>
            記録する
          </button>
        </ActionForm>
      </details>
    </div>
  )
}

/** K-02 本日の清掃タスク */
export default async function CleaningTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; memo?: string }>
}) {
  const { staff, selection } = await requireCleaningSelection()
  const { done, memo } = await searchParams
  const data = await withContainer((c) => c.getTodayCleaningTasks(staff, selection.storeId))
  const tz = data.store.timezone
  const typeOf = (roomId: number) => data.rooms.find((r) => r.roomId === roomId)?.roomTypeName ?? ''
  const due = data.openingOpen.map((t) => t.dueAt).sort((a, b) => a.getTime() - b.getTime())[0]
  const planned = data.openingOpen
    .map((t) => t.plannedStartAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0]

  return (
    <>
      <section className="rounded-xl border border-line bg-white p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-sub">担当店舗</span>
          <span className="font-bold">
            {data.store.code} {data.store.name}
          </span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-sub">担当者(ログ記録用)</span>
          <span className="font-bold">{selection.workerName}</span>
        </div>
        <Link
          href="/cleaning/login"
          className="mt-2 block text-right text-xs font-bold text-brand-dark"
        >
          店舗・担当者を変更
        </Link>
      </section>
      {done && <Notice tone="green">記録しました</Notice>}
      {memo && <Notice tone="green">活動メモを記録しました</Notice>}

      <section className="rounded-xl border border-line bg-white p-3">
        <h2 className="font-bold">本日の開店前清掃</h2>
        <p className="mt-1 text-xs text-sub">
          {due
            ? `目安 ${localTime(planned ?? null, tz)}開始 / 期限 ${localTime(due, tz)}(開店)・現在 ${localTime(data.now, tz)}`
            : `現在 ${localTime(data.now, tz)}`}
        </p>
        <div className="mt-2 flex justify-between text-sm">
          <span>進捗</span>
          <span className="font-bold">
            残り {data.openingOpen.length}室(稼働{data.roomsInService}室)
          </span>
        </div>
      </section>

      <h2 className="font-bold">開店前清掃リスト(未清掃の部屋)</h2>
      {data.openingOpen.length === 0 ? (
        <p className="text-sm text-sub">未清掃の部屋はありません</p>
      ) : (
        data.openingOpen.map((t) => (
          <TaskCard key={t.id} task={t} typeName={typeOf(t.roomId)} storeId={data.store.id} />
        ))
      )}

      <h2 className="font-bold">スポット清掃(至急)</h2>
      {data.urgentSpots.length === 0 ? (
        <p className="text-sm text-sub">至急のスポット清掃はありません</p>
      ) : (
        data.urgentSpots.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            typeName={typeOf(t.roomId)}
            storeId={data.store.id}
            detail={`期限 ${localTime(t.dueAt, tz)}${t.bookingStart ? `(次の予約 ${localTime(t.bookingStart, tz)} 開始)` : ''}・残り ${remaining(t.dueAt, data.now)}`}
          />
        ))
      )}
      <p className="text-xs text-sub">
        ※ 通常のスポット清掃は店舗スタッフが対応します。至急のもののみここに表示されます
      </p>
      <Link
        href="/cleaning/log"
        className="block rounded-xl border border-brand bg-white py-3 text-center font-bold text-brand"
      >
        本日の清掃ログを見る
      </Link>
      <Notice>
        前日20時の割当バッチで翌日の清掃予定を作成します（仮・CQ-68）。当日の予約変更で割当が変わった場合は都度清掃が発生します
      </Notice>
    </>
  )
}
