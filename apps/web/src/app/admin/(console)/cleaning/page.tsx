import { isUrgentSpot } from '@jancube/application'
import { addDays } from '@jancube/domain'
import Link from 'next/link'
import {
  Badge,
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Stat,
  Table,
} from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import {
  localTime,
  remaining,
  TASK_STATUS_LABEL,
  TASK_TYPE_LABEL,
} from '@/components/operations/time'
import { dateLabel } from '@/lib/format'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { type Container, withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { adminCleaningTaskAction, roomMemoAction } from '@/server/operations-actions'

export const dynamic = 'force-dynamic'

/** A-10 清掃状況: rooms' cleaning state, the plan of the date, and the date's log (F-CLN-02〜). */
export default async function CleaningPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; done?: string; memo?: string }>
}) {
  const staff = await requireStaff('cleaning.view')
  const storeId = await selectedStoreId(staff, 'cleaning.view')
  if (storeId === null || storeId < 0) {
    return (
      <>
        <PageHeader title="清掃状況" />
        <Notice>左上の店舗切り替えで店舗を選択してください</Notice>
      </>
    )
  }
  const { date, done, memo } = await searchParams
  let board: Awaited<ReturnType<Container['getCleaningBoard']>>
  let workers: { id: number; name: string }[] = []
  try {
    ;[board, workers] = await withContainer(async (c) => {
      const b = await c.getCleaningBoard(staff, storeId, date || undefined)
      return [b, b.canWork ? await c.cleaningAssignees(staff, storeId) : []] as const
    })
  } catch (error) {
    if (!isDomainError(error)) throw error
    return (
      <>
        <PageHeader title="清掃状況" />
        <Notice tone="red">{toUserMessage(error)}</Notice>
      </>
    )
  }
  const tz = board.store.timezone
  const now = board.now
  const open = board.tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress')
  const isUrgent = (t: (typeof open)[number]) => isUrgentSpot(t, now)
  const urgent = open.filter(isUrgent)
  const memos = board.activities.filter((a) => a.action === 'memo')
  const roomState = (roomId: number) => {
    const room = board.rooms.find((r) => r.roomId === roomId)
    if (room?.operatingStatus !== 'active') return { label: '休止', tone: 'gray' as const }
    if (urgent.some((t) => t.roomId === roomId))
      return { label: 'スポット至急', tone: 'red' as const }
    if (
      room.cleaningStatus === 'dirty' ||
      open.some((t) => t.roomId === roomId && t.taskType === 'opening')
    ) {
      return { label: '未清掃', tone: 'gold' as const }
    }
    return { label: '清掃済', tone: 'green' as const }
  }
  const toneClass = {
    gray: 'border-line bg-paper text-sub',
    red: 'border-alert bg-alert-pale',
    gold: 'border-gold bg-gold-pale',
    green: 'border-brand bg-white',
  }

  return (
    <>
      <PageHeader
        title="清掃状況"
        description="全部屋の清掃状態と、開始30分前が期限のスポット清掃を管理します"
      />
      <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
        <Link
          href={`/admin/cleaning?date=${addDays(board.date, -1)}`}
          className={buttonClass.secondary}
        >
          前日
        </Link>
        <input type="date" name="date" defaultValue={board.date} className={`${inputClass} w-44`} />
        <button type="submit" className={buttonClass.primary}>
          表示
        </button>
        <Link
          href={`/admin/cleaning?date=${addDays(board.date, 1)}`}
          className={buttonClass.secondary}
        >
          翌日
        </Link>
        <span className="ml-2 text-sm font-bold">
          {board.store.code} {board.store.name} / {dateLabel(board.date)}
        </span>
      </form>
      {done && <Notice tone="green">清掃タスクを更新しました</Notice>}
      {memo && <Notice tone="green">活動メモを記録しました</Notice>}
      <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={`${board.stats.openingRemaining}室`} label="要清掃(開店前)" />
        <Stat value={`${board.stats.urgentSpots}室`} label="スポット清掃 至急" />
        <Stat value={`${board.stats.roomsInService}室`} label="稼働中の部屋" />
        <Stat
          value={board.stats.openingDue ? localTime(board.stats.openingDue, tz) : '—'}
          label="開店前清掃の期限"
        />
      </div>
      {urgent.map((t) => (
        <div key={t.id} className="mb-2">
          <Notice tone="red">
            スポット清掃 至急: {t.roomName}
            {t.bookingStart ? `（次の予約 ${localTime(t.bookingStart, tz)} 開始` : '（'} / 期限{' '}
            {localTime(t.dueAt, tz)} / 残り {remaining(t.dueAt, now)}）
          </Notice>
        </div>
      ))}

      <h2 className="mt-4 mb-2 font-bold">部屋別 清掃状態</h2>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {board.rooms.map((room) => {
          const state = roomState(room.roomId)
          return (
            <div
              key={room.roomId}
              className={`rounded-xl border-2 px-3 py-2 text-center ${toneClass[state.tone]}`}
            >
              <div className="font-bold">{room.name}</div>
              <div className="text-xs text-sub">{room.roomTypeName}</div>
              <div className="text-xs font-bold">{state.label}</div>
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="清掃予定・スポット清掃 期限表">
          <Table
            head={['部屋', '種別', '退室', '次の予約', '期限', '残り', '状態', '操作']}
            rows={board.tasks
              .filter((t) => t.status !== 'canceled')
              .map((t) => [
                t.roomName,
                <span key="type">
                  {TASK_TYPE_LABEL[t.taskType]}
                  {isUrgent(t) && t.status !== 'done' && (
                    <>
                      {' '}
                      <Badge tone="red">至急</Badge>
                    </>
                  )}
                </span>,
                t.taskType === 'spot' ? localTime(t.plannedStartAt, tz) : '—',
                localTime(t.bookingStart, tz),
                localTime(t.dueAt, tz),
                t.status === 'done' ? '—' : remaining(t.dueAt, now),
                `${TASK_STATUS_LABEL[t.status]}${t.assignedStaffName ? `（${t.assignedStaffName}）` : ''}`,
                t.status === 'pending' || t.status === 'in_progress' ? (
                  board.canWork && workers.length > 0 ? (
                    <ActionForm
                      key="op"
                      action={adminCleaningTaskAction}
                      className="flex flex-wrap items-center gap-1"
                    >
                      <input type="hidden" name="taskId" value={t.id} />
                      <input type="hidden" name="date" value={board.date} />
                      <select
                        name="workerId"
                        className="rounded-lg border border-line px-1 py-1 text-xs"
                        aria-label="作業担当者"
                      >
                        {workers.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={`${buttonClass.primary} px-3 py-1`}>
                        完了
                      </button>
                    </ActionForm>
                  ) : (
                    '—'
                  )
                ) : (
                  '—'
                ),
              ])}
            empty="この日の清掃予定はありません（前日20時のバッチで作成されます）"
          />
        </Card>
        <Card title="本日の清掃ログ">
          <Table
            head={['完了時刻', '部屋', '種別', '担当', '活動メモ']}
            rows={board.logs.map((l) => [
              localTime(l.completedAt, tz),
              l.roomName,
              TASK_TYPE_LABEL[l.taskType],
              l.workerName,
              `${l.wasOverdue ? '【期限超過】' : ''}${l.notes ?? '—'}`,
            ])}
            empty="まだ完了した清掃はありません"
          />
          {memos.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {memos.map((m) => (
                <li key={m.id}>
                  <span className="text-sub">{localTime(m.occurredAt, tz)}</span> {m.roomName}:{' '}
                  {m.body}
                  <span className="text-xs text-sub">（入力: {m.staffName}）</span>
                </li>
              ))}
            </ul>
          )}
          {board.canWork && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-bold text-brand-dark">
                ＋ 活動メモを入力
              </summary>
              <ActionForm action={roomMemoAction} className="mt-2 space-y-2">
                <input type="hidden" name="storeId" value={board.store.id} />
                <input type="hidden" name="date" value={board.date} />
                <input type="hidden" name="source" value="admin" />
                <Field label="対象の部屋">
                  <select name="roomId" className={inputClass}>
                    {board.rooms.map((r) => (
                      <option key={r.roomId} value={r.roomId}>
                        {r.name}（{r.roomTypeName}）
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="メモ"
                  hint="入力者はログインアカウントとして記録されます（作業担当者とは別項目）"
                >
                  <textarea name="body" required maxLength={500} rows={3} className={inputClass} />
                </Field>
                <button type="submit" className={buttonClass.primary}>
                  記録する
                </button>
              </ActionForm>
            </details>
          )}
        </Card>
      </div>
      <div className="mt-4">
        <Notice>
          前日20時のバッチで翌日の清掃予定（開店前清掃・予約間のスポット清掃）を作成します（仮・CQ-68）。当日の割当変更で未清掃の部屋に移った場合は至急のスポット清掃が追加されます。
        </Notice>
      </div>
    </>
  )
}
