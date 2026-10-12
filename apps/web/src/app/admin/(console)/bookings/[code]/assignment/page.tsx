import {
  Badge,
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  TextLink,
} from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import { localTime } from '@/components/operations/time'
import { dateLabel } from '@/lib/format'
import { requireStaff } from '@/server/admin-session'
import { type Container, withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import { reassignRoomAction } from '@/server/operations-actions'

export const dynamic = 'force-dynamic'

/** A-07 割当変更 (F-RM-06 手動割当変更 / F-RM-07 即時確定). */
export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const staff = await requireStaff('bookings.manage')
  const { code } = await params
  const { done } = await searchParams
  const bookingCode = decodeURIComponent(code)
  let data: Awaited<ReturnType<Container['getAssignmentOptions']>>
  try {
    data = await withContainer((c) => c.getAssignmentOptions(staff, bookingCode))
  } catch (error) {
    if (!isDomainError(error)) throw error
    return (
      <>
        <PageHeader title="割当変更" />
        <Notice tone="red">{toUserMessage(error)}</Notice>
      </>
    )
  }
  const { booking, store, options } = data
  const tz = store.timezone
  const choosable = options.filter((o) => o.available)
  const editable = booking.status === 'confirmed'

  return (
    <>
      <PageHeader
        title={`割当変更 — ${booking.bookingCode}${booking.contactName ? ` ${booking.contactName} 様` : ''}`}
        description="部屋の割り当てを手動で変更します。確定後の変更はお客様への再通知が発生します"
        actions={
          <TextLink href={`/admin/keys/${encodeURIComponent(booking.bookingCode)}`}>
            鍵状況を見る
          </TextLink>
        }
      />
      {done && <Notice tone="green">割当を変更しました</Notice>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="現在の割当">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-sub">利用日時</dt>
            <dd className="font-bold">
              {dateLabel(booking.businessDate)} {localTime(booking.start, tz)}〜
              {localTime(booking.end, tz)}
            </dd>
            <dt className="text-sub">部屋グループ</dt>
            <dd>{booking.roomGroupName}</dd>
            <dt className="text-sub">現在の割当</dt>
            <dd className="font-bold">
              {booking.assignment ? (
                <>
                  {booking.assignment.roomName}{' '}
                  <Badge tone={booking.assignment.status === 'final' ? 'green' : 'gold'}>
                    {booking.assignment.status === 'final' ? '確定' : '仮割当'}
                  </Badge>
                </>
              ) : (
                <span className="text-sub">未割当（前日バッチで割当予定）</span>
              )}
            </dd>
          </dl>
          <h3 className="mt-4 mb-2 text-sm font-bold">部屋ごとの空き状況</h3>
          <ul className="space-y-1 text-sm">
            {options.map((o) => (
              <li
                key={o.roomId}
                className={o.available ? 'text-brand-dark' : o.current ? '' : 'text-alert'}
              >
                {o.current ? '● ' : o.available ? '✅ ' : '⚠ '}
                <span className="font-bold">{o.name}</span>（
                {o.cleaningStatus === 'clean' ? '清掃済' : '未清掃'}）
                {o.current
                  ? ' 現在の部屋'
                  : o.available
                    ? ` 競合なし。${localTime(booking.start, tz)}-${localTime(booking.end, tz)} で変更できます`
                    : ` ${o.problem}`}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="変更内容">
          {!editable ? (
            <Notice tone="red">確定済みのご予約のみ割当を変更できます</Notice>
          ) : (
            <ActionForm action={reassignRoomAction} className="space-y-3">
              <input type="hidden" name="bookingCode" value={booking.bookingCode} />
              <Field label="変更先の部屋">
                <select name="roomId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    選択してください
                  </option>
                  {booking.assignment?.status === 'provisional' && (
                    <option value={booking.assignment.roomId}>
                      {booking.assignment.roomName}（現在の部屋のまま確定）
                    </option>
                  )}
                  {choosable.map((o) => (
                    <option key={o.roomId} value={o.roomId}>
                      {o.name}（
                      {o.cleaningStatus === 'clean' ? '清掃済' : '未清掃・スポット清掃を追加'}）
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="finalize"
                  defaultChecked
                  className="size-4 accent-brand"
                />
                この部屋で確定する（即時確定）
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="notify"
                  defaultChecked
                  className="size-4 accent-brand"
                />
                お客様に部屋変更のお知らせを再通知する
              </label>
              <Field label="変更理由(監査ログに記録)">
                <input
                  name="reason"
                  required
                  maxLength={500}
                  className={inputClass}
                  placeholder="設備不具合のため"
                />
              </Field>
              <div className="flex gap-2">
                <button type="submit" className={buttonClass.primary}>
                  変更を確定する
                </button>
                <a href="/admin/bookings" className={buttonClass.secondary}>
                  キャンセル
                </a>
              </div>
            </ActionForm>
          )}
        </Card>
      </div>
      <div className="mt-4">
        <Notice>
          部屋番号は前日の通知時点でお知らせします（前日バッチは20時を想定・CQ-68）。仮割当は開始30分前に自動で確定します（CQ-31
          未決のため暫定）。前日通知後に変更した場合は、チェックを入れるとお客様へ再通知します。
        </Notice>
      </div>
    </>
  )
}
