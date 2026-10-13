import {
  Badge,
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import {
  KEY_EVENT_LABEL,
  KEY_RESULT_LABEL,
  KEY_STATUS_LABEL,
  localDateTime,
  localTime,
} from '@/components/operations/time'
import { dateLabel } from '@/lib/format'
import { requireStaff } from '@/server/admin-session'
import { type Container, withContainer } from '@/server/container'
import { isDomainError, toUserMessage } from '@/server/errors'
import {
  manualUnlockAction,
  reissueKeyAction,
  resendKeyNoticeAction,
  testLockDevicesAction,
} from '@/server/operations-actions'

export const dynamic = 'force-dynamic'

const DONE: Record<string, string> = {
  reissued: '入室コードを再発行しました',
  resent: 'お客様に入室コードを再通知しました',
  recorded: '手動解錠の対応を記録しました',
  tested: 'デバイス疎通テストを実行しました（結果はデバイス状態とイベントログを確認してください）',
}

const detailText = (details: Readonly<Record<string, unknown>> | null) => {
  if (!details) return '—'
  const parts = ['message', 'reason', 'note', 'communication', 'detail']
    .map((k) => details[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  return parts.join(' / ') || '—'
}

/** A-09 鍵状況(予約別): status, failure reason, history, and recovery (F-KEY-05 / F-KEY-06). */
export default async function KeyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const staff = await requireStaff('keys.manage')
  const { code } = await params
  const { done } = await searchParams
  let data: Awaited<ReturnType<Container['getKeyDetail']>>
  try {
    data = await withContainer((c) => c.getKeyDetail(staff, decodeURIComponent(code)))
  } catch (error) {
    if (!isDomainError(error)) throw error
    return (
      <>
        <PageHeader title="鍵状況" />
        <Notice tone="red">{toUserMessage(error)}</Notice>
      </>
    )
  }
  const { booking, store, key, code: entryCode, events, device } = data
  const tz = store.timezone
  const lastFailure = [...events].reverse().find((e) => e.result === 'failure')
  const lastAttempt = [...events]
    .reverse()
    .find((e) => e.eventType === 'issue' || e.eventType === 'revoke')
  const statusTone = !key
    ? 'gold'
    : key.status === 'failed'
      ? 'red'
      : key.status === 'issued'
        ? 'green'
        : 'gray'
  const canAct = booking.status === 'confirmed'

  return (
    <>
      <PageHeader
        title={`鍵状況 — ${booking.bookingCode}`}
        description="鍵の発行状態と失敗理由を確認し、再発行・再通知を行います。鍵の対象は店舗の入口錠です（部屋ごとの鍵はありません）"
        actions={
          <>
            <TextLink href={`/admin/keys?date=${booking.businessDate}`}>一覧へ戻る</TextLink>
            <TextLink
              href={`/admin/bookings/${encodeURIComponent(booking.bookingCode)}/assignment`}
            >
              割当変更
            </TextLink>
          </>
        }
      />
      {done && DONE[done] && <Notice tone="green">{DONE[done]}</Notice>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="鍵の状態">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-sub">現在の状態</dt>
              <dd>
                <Badge tone={statusTone}>
                  {key ? (KEY_STATUS_LABEL[key.status] ?? key.status) : '未発行'}
                </Badge>
              </dd>
              <dt className="text-sub">ご利用</dt>
              <dd className="font-bold">
                {dateLabel(booking.businessDate)} {localTime(booking.start, tz)}〜
                {localTime(booking.end, tz)}
                {booking.contactName && ` / ${booking.contactName} 様`}
              </dd>
              <dt className="text-sub">対象部屋</dt>
              <dd className="font-bold">
                {booking.assignment?.roomName ?? '未割当'}（入口錠 {device?.name ?? '未登録'}）
              </dd>
              <dt className="text-sub">入室コード</dt>
              <dd className="font-bold">
                {entryCode ? (
                  <details>
                    <summary className="cursor-pointer text-brand-dark">表示する</summary>
                    <span className="font-mono text-lg tracking-widest">{entryCode}</span>
                  </details>
                ) : (
                  '—（未発行）'
                )}
              </dd>
              <dt className="text-sub">有効時間</dt>
              <dd className="font-bold">{key ? `${data.validFrom} 〜 ${data.validTo}` : '—'}</dd>
              <dt className="text-sub">最終試行</dt>
              <dd>{lastAttempt ? localDateTime(lastAttempt.occurredAt, tz) : '—'}</dd>
              <dt className="text-sub">失敗理由</dt>
              <dd className={lastFailure ? 'font-bold text-alert' : ''}>
                {lastFailure
                  ? `${lastFailure.errorCode ?? ''} ${detailText(lastFailure.details)}`
                  : '—'}
              </dd>
            </dl>
          </Card>
          <Card title="鍵イベントログ">
            <Table
              head={['日時', 'イベント', '結果', '詳細']}
              rows={events.map((e) => [
                localDateTime(e.occurredAt, tz),
                `${KEY_EVENT_LABEL[e.eventType] ?? e.eventType}${e.attemptNo > 1 ? `(${e.attemptNo}回目)` : ''}`,
                KEY_RESULT_LABEL[e.result] ?? e.result,
                `${e.errorCode ? `${e.errorCode} ` : ''}${detailText(e.details)}${e.staffName ? `（${e.staffName}）` : ''}`,
              ])}
              empty="まだ記録はありません"
            />
          </Card>
        </div>
        <div className="space-y-4">
          {canAct && key?.status !== 'issued' && data.preparationDue && (
            <Notice tone="red">
              前日の鍵発行バッチ後も未発行です。復旧できない場合は店舗スタッフによる手動解錠で対応してください
            </Notice>
          )}
          <Card title="復旧操作">
            {!canAct ? (
              <p className="text-sm text-sub">確定済みのご予約のみ操作できます</p>
            ) : (
              <div className="space-y-4">
                <ActionForm action={reissueKeyAction} className="space-y-2">
                  <input type="hidden" name="bookingCode" value={booking.bookingCode} />
                  <Field label="再発行の理由(監査ログに記録)">
                    <input
                      name="reason"
                      required
                      maxLength={500}
                      className={inputClass}
                      placeholder="デバイス応答なしのため"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="notify"
                      defaultChecked
                      className="size-4 accent-brand"
                    />
                    新しいコードをお客様に通知する
                  </label>
                  <button type="submit" className={buttonClass.primary}>
                    鍵を再発行する
                  </button>
                </ActionForm>
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={resendKeyNoticeAction}>
                    <input type="hidden" name="bookingCode" value={booking.bookingCode} />
                    <button type="submit" className={buttonClass.secondary} disabled={!entryCode}>
                      お客様に鍵コードを再通知
                    </button>
                  </ActionForm>
                  {device && (
                    <ActionForm action={testLockDevicesAction}>
                      <input type="hidden" name="id" value={device.id} />
                      <input
                        type="hidden"
                        name="back"
                        value={`/admin/keys/${encodeURIComponent(booking.bookingCode)}?done=tested`}
                      />
                      <button type="submit" className={buttonClass.secondary}>
                        デバイス疎通テスト
                      </button>
                    </ActionForm>
                  )}
                </div>
                <ActionForm action={manualUnlockAction} className="space-y-2">
                  <input type="hidden" name="bookingCode" value={booking.bookingCode} />
                  <Field label="手動解錠で対応(記録のみ)">
                    <input
                      name="note"
                      required
                      maxLength={500}
                      className={inputClass}
                      placeholder="スタッフが入口を解錠して案内"
                    />
                  </Field>
                  <button type="submit" className={buttonClass.secondary}>
                    手動解錠で対応したことを記録
                  </button>
                </ActionForm>
              </div>
            )}
          </Card>
          <Card title="デバイス状態(A-20 連携)">
            {device ? (
              <Table
                head={['デバイス', '電池', '通信', '最終応答']}
                rows={[
                  [
                    device.name,
                    device.batteryPercent === null ? '—' : `${device.batteryPercent}%`,
                    device.communicationStatus === 'online'
                      ? '正常'
                      : device.communicationStatus === 'offline'
                        ? '不通'
                        : '不明',
                    localDateTime(device.lastResponseAt, tz),
                  ],
                ]}
              />
            ) : (
              <Notice tone="red">有効な鍵デバイスがありません</Notice>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
