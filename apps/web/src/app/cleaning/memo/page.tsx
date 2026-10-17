import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Notice } from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import { MemoInput } from '@/components/operations/MemoInput'
import { localTime, TASK_TYPE_LABEL } from '@/components/operations/time'
import { requireCleaningSelection } from '@/server/cleaning-session'
import { withContainer } from '@/server/container'
import { roomMemoAction } from '@/server/operations-actions'

export const dynamic = 'force-dynamic'

/** K-04: reuse the existing authorized memo use case; the signed-in author is never a form field. */
export default async function CleaningMemoPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; task?: string; saved?: string }>
}) {
  const { staff, selection } = await requireCleaningSelection()
  const query = await searchParams
  const [board, log] = await withContainer((container) =>
    Promise.all([
      container.getTodayCleaningTasks(staff, selection.storeId),
      container.getCleaningLog(staff, selection.storeId, 'day'),
    ]),
  )
  const room = board.rooms.find((item) => item.roomId === Number(query.room))
  if (!room) notFound()
  const task = [...board.openingOpen, ...board.urgentSpots].find(
    (item) => item.id === Number(query.task) && item.roomId === room.roomId,
  )
  if (query.task && !task) notFound()
  const memos = log.activities
    .filter((activity) => activity.action === 'memo' && activity.roomCode === room.code)
    .slice()
    .reverse()
  return (
    <>
      <Link href="/cleaning" className="font-bold text-brand-dark">
        ‹ 前の画面に戻る
      </Link>
      <h1>活動メモを残す</h1>
      <p className="text-sm text-sub">清掃や備品対応などの作業内容を、お部屋ごとに記録します。</p>
      {query.saved && <Notice tone="green">活動メモを記録しました</Notice>}
      <section className="cleaning-card space-y-3">
        <ReadOnly label="対象店舗" value={`${board.store.code} ${board.store.name}`} />
        <ReadOnly label="対象の部屋" value={`${room.name}（${room.roomTypeName}）`} />
        <ReadOnly
          label="作業の種類"
          value={task ? `${TASK_TYPE_LABEL[task.taskType]}清掃` : '活動メモ'}
        />
        <ReadOnly label="作業担当者" value={selection.workerName} />
        <p className="text-xs text-sub">
          入力者はログインアカウント（{staff.name}）として記録され、作業担当者とは区別されます。
        </p>
      </section>
      <h2>活動メモ</h2>
      <ActionForm action={roomMemoAction} className="space-y-3">
        <input type="hidden" name="source" value="cleaning" />
        <input type="hidden" name="storeId" value={selection.storeId} />
        <input type="hidden" name="roomId" value={room.roomId} />
        <input type="hidden" name="taskId" value={task?.id ?? ''} />
        <input type="hidden" name="back" value="memo" />
        <div className="cleaning-card">
          <MemoInput />
        </div>
        <button type="submit" className="cleaning-primary">
          記録する
        </button>
      </ActionForm>
      <h2>本日の記録（{room.name}）</h2>
      {memos.length === 0 ? (
        <p className="text-xs text-sub">この部屋の活動メモはまだありません。</p>
      ) : (
        <ul className="space-y-3">
          {memos.map((memo) => (
            <li key={memo.id} className="cleaning-card">
              <div className="flex flex-wrap justify-between gap-2 text-xs text-sub">
                <span>入力：{memo.staffName}</span>
                <time>{localTime(memo.occurredAt, board.store.timezone)}</time>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap">{memo.body}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-[12.5px] font-bold text-sub">{label}</p>
      <p className="rounded-lg border-[1.5px] border-line bg-white px-3 py-[9px] text-sm">
        {value}
      </p>
    </div>
  )
}
