import type { BookingDetail } from '@jancube/application'
import { can } from '@jancube/domain'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  BOOKING_SOURCE,
  bookingWhen,
  CHANNEL,
  jsonLabel,
  NOTIFICATION_EVENT,
  PAYMENT_METHOD,
  PaymentBadge,
  phoneLabel,
  StatusBadge,
  shortDateTime,
} from '@/components/admin/booking-format'
import { Badge, buttonClass, Card, Notice, PageHeader, Table } from '@/components/admin/ui'
import { durationLabel, yen } from '@/lib/format'
import { resendNotificationAction } from '@/server/admin-booking-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

/** A-05 予約詳細: everything recorded about one booking, and the manual operations. */
export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ resent?: string; error?: string }>
}) {
  const staff = await requireStaff('bookings.view')
  const { code } = await params
  const { resent, error } = await searchParams
  let d: BookingDetail
  try {
    d = await withContainer((c) => c.getBookingDetail(staff.access, decodeURIComponent(code)))
  } catch (e) {
    return (
      <>
        <PageHeader title="予約詳細" />
        <Notice tone="red">{toUserMessage(e)}</Notice>
      </>
    )
  }
  const b = d.booking
  const tz = b.timezone
  const at = (v: Date | null) => shortDateTime(v, tz)
  const canManage = can(staff.access, 'bookings.manage', b.storeId)
  const canCancel = can(staff.access, 'bookings.cancel', b.storeId) && b.status === 'confirmed'
  const self = `/admin/bookings/${b.bookingCode}`

  return (
    <>
      <PageHeader
        title={`予約詳細 ${b.bookingCode}`}
        description="1件の予約に関する履歴と手動操作"
        actions={
          <Link href="/admin/bookings" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      {resent && (
        <div className="mb-3">
          <Notice tone="green">通知を再送キューに登録しました</Notice>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Notice tone="red">{error}</Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="予約情報">
            <Rows
              rows={[
                ['状態', <StatusBadge key="s" status={b.status} />],
                ['店舗', `${b.storeCode} ${b.storeName}`],
                ['日時', bookingWhen(b)],
                [
                  '部屋',
                  `${b.roomGroupName} → ${b.roomName ?? '未割当'}${
                    b.assignmentStatus === 'provisional'
                      ? '（仮割当）'
                      : b.assignmentStatus === 'final'
                        ? '（確定）'
                        : ''
                  }`,
                ],
                ['人数', `${b.guestCount}名`],
                ['金額', `${yen(b.total)}（小計 ${yen(b.subtotal)} / 割引 ${yen(b.discount)}）`],
                ['作成経路', BOOKING_SOURCE[b.source] ?? b.source],
                ['流入元', [b.acquisitionSource, b.utm].filter(Boolean).join(' / ') || '—'],
                [
                  '作成',
                  `${at(b.createdAt)}${b.createdByStaffName ? `（代理: ${b.createdByStaffName}）` : ''}`,
                ],
                ['確定', at(b.confirmedAt)],
                ...(b.status === 'draft'
                  ? ([['仮押さえ期限', at(b.holdExpiresAt)]] as [string, ReactNode][])
                  : []),
              ]}
            />
          </Card>

          <Card title="お客様">
            {d.member ? (
              <Rows
                rows={[
                  ['氏名', d.member.name ?? '—'],
                  ['電話番号', phoneLabel(d.member.phone)],
                  ['メール', d.member.email ?? '—'],
                  ['LINE連携', d.member.lineLinked ? '連携済' : '未連携'],
                  ['会員ID', `${d.member.memberCode}（${d.member.status}）`],
                ]}
              />
            ) : (
              <Rows
                rows={[
                  ['氏名', b.customerName ?? '—'],
                  ['電話番号', phoneLabel(b.phone)],
                  ['会員', '未登録（決済リンクからの認証待ち）'],
                ]}
              />
            )}
          </Card>

          {d.cancellation && (
            <Card title="キャンセル記録">
              <Rows
                rows={[
                  ['日時', at(d.cancellation.requestedAt)],
                  ['支払額', yen(d.cancellation.paidAmount)],
                  [
                    '料率',
                    `${d.cancellation.appliedFeeRate}%（自動 ${d.cancellation.automaticFeeRate}%）${
                      d.cancellation.manualOverride ? ' 手動上書き' : ''
                    }`,
                  ],
                  ['キャンセル料', yen(d.cancellation.feeAmount)],
                  ['返金額', yen(d.cancellation.refundAmount)],
                  ['理由', d.cancellation.reason ?? '—'],
                  ['操作者', d.cancellation.staffName ?? 'お客様'],
                ]}
              />
            </Card>
          )}

          <Card title="鍵(AccessKey / KeyEvent)">
            <Table
              head={['デバイス', '状態', '有効期間', '発行', '失効']}
              rows={d.keys.map((k) => [
                k.deviceName,
                k.status,
                `${at(k.validFrom)}〜${at(k.validTo)}`,
                at(k.issuedAt),
                at(k.revokedAt),
              ])}
              empty="鍵はまだ発行されていません"
            />
            <div className="mt-2">
              <Table
                head={['日時', 'イベント', '結果', 'エラー', 'デバイス']}
                rows={d.keyEvents.map((e) => [
                  at(e.occurredAt),
                  e.eventType,
                  e.result,
                  e.errorCode ?? '—',
                  e.deviceName,
                ])}
                empty="鍵イベントはありません"
              />
            </div>
            <p className="mt-2 text-xs text-sub">
              鍵の再発行は鍵状況(A-09)から行います。入室コードはこの画面には表示しません
            </p>
          </Card>

          <Card title="部屋割当履歴">
            <Table
              head={['部屋', '段階', '経路', '割当', '解放', '操作者']}
              rows={d.assignments.map((a) => [
                a.roomName,
                a.status === 'final' ? '確定' : '仮',
                a.source,
                at(a.assignedAt),
                a.releasedAt ? `${at(a.releasedAt)} ${a.reason ?? ''}` : '—',
                a.staffName ?? 'system',
              ])}
              empty="まだ部屋が割り当てられていません"
            />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="決済 / 返金">
            <Table
              head={['種別', '方法', '金額', '状態', '日時']}
              rows={[
                ...d.payments.map((p) => [
                  '決済',
                  PAYMENT_METHOD[p.method] ?? p.method,
                  yen(p.amount),
                  <PaymentBadge key="s" status={p.status} />,
                  at(p.paidAt ?? p.createdAt),
                ]),
                ...d.refunds.map((r) => [
                  '返金',
                  r.reason,
                  `-${yen(r.amount)}`,
                  <span key="s" title={r.failureMessage ?? undefined}>
                    <PaymentBadge status={r.status} />
                  </span>,
                  at(r.refundedAt ?? r.createdAt),
                ]),
              ]}
              empty="決済はまだありません"
            />
            {d.refunds.some((r) => r.status === 'failed') && (
              <p className="mt-2 text-xs text-alert">
                失敗した返金は決済・返金履歴(A-26)から再実行できます
              </p>
            )}
            {d.paymentLinks.length > 0 && (
              <div className="mt-2">
                <Table
                  head={['決済リンク発行', '期限', '状態', '発行者']}
                  rows={d.paymentLinks.map((l) => [
                    at(l.createdAt),
                    at(l.expiresAt),
                    l.usedAt ? `決済済 ${at(l.usedAt)}` : l.revokedAt ? '失効' : '未決済',
                    l.issuedByName ?? '—',
                  ])}
                />
              </div>
            )}
          </Card>

          <Card title="料金計算ログ">
            <Table
              head={['版', '時間', '時間料金', 'パック割', '時間帯割', 'クーポン', '合計', '税率']}
              rows={d.priceCalculations.map((c) => [
                c.revisionNo,
                durationLabel(c.durationMinutes),
                yen(c.baseAmount),
                `-${yen(c.packageDiscount)}`,
                `-${yen(c.timeDiscount)}`,
                `-${yen(c.couponDiscount)}`,
                yen(c.total),
                `${c.taxRate}%`,
              ])}
            />
            {d.coupons.length > 0 && (
              <ul className="mt-2 text-sm">
                {d.coupons.map((c) => (
                  <li key={`${c.couponName}-${c.status}`}>
                    クーポン: {c.couponName} -{yen(c.discount)} <Badge>{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="通知履歴">
            <Table
              head={['予定', '種別', 'チャネル', '結果', '試行', '']}
              rows={d.notifications.map((n) => [
                at(n.scheduledAt),
                NOTIFICATION_EVENT[n.event] ?? n.event,
                CHANNEL[n.channel] ?? n.channel,
                n.status === 'sent'
                  ? `送信済 ${at(n.sentAt)}`
                  : n.status === 'failed'
                    ? '失敗'
                    : n.status,
                n.attempts.length === 0
                  ? '—'
                  : n.attempts.map((a) => (
                      <div key={a.attemptNo} className="text-xs">
                        #{a.attemptNo} {a.result} {at(a.at)}
                        {a.error ? ` ${a.error}` : ''}
                      </div>
                    )),
                canManage ? (
                  <form key="r" action={resendNotificationAction}>
                    <input type="hidden" name="deliveryId" value={n.id} />
                    <input type="hidden" name="back" value={self} />
                    <button type="submit" className="text-xs font-bold text-brand-dark underline">
                      再送
                    </button>
                  </form>
                ) : null,
              ])}
              empty="通知はまだありません"
            />
          </Card>

          <Card title="変更履歴 / 操作履歴">
            <Table
              head={['日時', '操作者', '内容', '前→後']}
              rows={[
                ...d.changes.map((h) => ({
                  at: h.changedAt,
                  cells: [
                    at(h.changedAt),
                    h.actor,
                    `予約変更${h.reason ? `（${h.reason}）` : ''}`,
                    `${jsonLabel(h.before)} → ${jsonLabel(h.after)}`,
                  ],
                })),
                ...d.audit.map((l) => ({
                  at: l.occurredAt,
                  cells: [
                    at(l.occurredAt),
                    l.actor,
                    `${l.action}${l.reason ? `（${l.reason}）` : ''}`,
                    `${jsonLabel(l.before)} → ${jsonLabel(l.after)}`,
                  ],
                })),
              ]
                .sort((x, y) => x.at.getTime() - y.at.getTime())
                .map((r) => r.cells)}
              empty="履歴はありません"
            />
          </Card>

          <Card title="手動操作">
            <div className="flex flex-wrap gap-2">
              {canManage && b.status === 'confirmed' && (
                <Link href={`${self}/assignment`} className={buttonClass.secondary}>
                  割当変更(A-07)
                </Link>
              )}
              {canCancel && (
                <Link href={`${self}/cancel`} className={buttonClass.secondary}>
                  キャンセル・返金(A-08)
                </Link>
              )}
              {can(staff.access, 'keys.manage', b.storeId) && (
                <Link href="/admin/keys" className={buttonClass.secondary}>
                  鍵状況・再発行(A-09)
                </Link>
              )}
              {can(staff.access, 'payments.view', b.storeId) && (
                <Link href="/admin/payments" className={buttonClass.secondary}>
                  決済・返金履歴(A-26)
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 py-1.5">
          <dt className="shrink-0 text-sub">{label}</dt>
          <dd className="text-right font-bold">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
