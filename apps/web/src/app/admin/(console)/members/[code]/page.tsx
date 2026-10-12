import { formatJapaneseMobile, minuteOfBusinessDay } from '@jancube/domain'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import {
  BOOKING_STATUS_LABELS,
  hhmm,
  MEMBER_STATUS_LABELS,
  memberStatusTone,
  yen,
  ymd,
  ymdhm,
} from '@/components/admin/format'
import {
  Badge,
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
} from '@/components/admin/ui'
import { addMemberNoteAction, changeMemberStatusAction } from '@/server/admin-member-coupon-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'

export const dynamic = 'force-dynamic'

const METHOD_LABELS: Record<string, string> = { card: 'カード', paypay: 'PayPay', other: 'その他' }
const PAYMENT_STATUS: Record<string, string> = {
  pending: '処理待ち',
  processing: '処理中',
  succeeded: '成功',
  failed: '失敗',
  canceled: '取消',
}
const DOCUMENT_LABELS: Record<string, string> = {
  terms: '利用規約',
  privacy: 'プライバシーポリシー',
  age_declaration: '18歳以上確認',
  cancellation_policy: 'キャンセルポリシー',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-sm last:border-0">
      <span className="text-sub">{label}</span>
      <span className="text-right font-bold">{children}</span>
    </div>
  )
}

/** A-12 会員詳細 */
export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ granted?: string }>
}) {
  const staff = await requireStaff('members.view')
  const { code } = await params
  const { granted } = await searchParams
  const memberCode = decodeURIComponent(code)
  const detail = await withContainer((c) => c.getMemberDetail(staff, memberCode)).catch((e) => {
    if (isDomainError(e, 'member_not_found')) notFound()
    throw e
  })
  const { member } = detail
  const name = `${member.familyName ?? ''} ${member.givenName ?? ''}`.trim() || '（未登録）'
  const now = new Date()

  return (
    <>
      <PageHeader
        title={`会員詳細 — ${name}(${member.memberCode})`}
        description="ご住所は保持しません。予約・決済・クーポン・対応ログをこの画面で確認します"
        actions={
          <Link href="/admin/members" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      {granted && (
        <div className="mb-4">
          <Notice tone="green">
            クーポンを発行しました
            {granted === 'queued'
              ? '（通知を送信予定）'
              : granted === 'screen_only'
                ? '（連絡手段がないため通知なし・マイページに表示）'
                : ''}
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="プロフィール">
            <Row label="氏名">{name}</Row>
            <Row label="電話番号">{member.phone ? formatJapaneseMobile(member.phone) : '—'}</Row>
            <Row label="メール">{member.email ?? '—'}</Row>
            <Row label="LINE連携">
              {member.lineLinkedAt
                ? `連携済(${ymd(member.lineLinkedAt)})${member.lineFriendStatus === 'blocked' ? '・ブロック中' : ''}`
                : '未連携'}
            </Row>
            <Row label="登録日">{ymd(member.registeredAt)}</Row>
            <Row label="流入元">{member.registrationSource ?? '—'}</Row>
            <Row label="利用回数">{member.useCount}回</Row>
            <Row label="状態">
              <Badge tone={memberStatusTone(member.status)}>
                {MEMBER_STATUS_LABELS[member.status] ?? member.status}
              </Badge>
            </Row>
            {detail.canManage && member.status !== 'withdrawn' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/admin/members/${encodeURIComponent(member.memberCode)}/coupons/new`}
                  className={buttonClass.primary}
                >
                  個別クーポン発行(A-13)
                </Link>
              </div>
            )}
            <p className="mt-3 rounded-lg bg-gold-pale p-2 text-xs">
              【課題#22】お客様ご自身での氏名変更は不可。氏名変更の画面は別途対応予定です。
            </p>
          </Card>

          {detail.canManage && member.status !== 'withdrawn' && (
            <Card title="状態を変更（F-AUTH-08）">
              <ActionForm action={changeMemberStatusAction} submitLabel="状態を変更する">
                <input type="hidden" name="memberCode" value={member.memberCode} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="新しい状態">
                    <select name="status" defaultValue={member.status} className={inputClass}>
                      <option value="active">有効</option>
                      <option value="caution">要注意</option>
                      <option value="suspended">利用停止（予約不可）</option>
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="理由（監査ログに記録）">
                      <input name="reason" required maxLength={500} className={inputClass} />
                    </Field>
                  </div>
                </div>
              </ActionForm>
            </Card>
          )}

          <Card title="対応ログ(CS)">
            <Table
              head={['日時', '担当', '内容', '予約']}
              rows={detail.notes.map((n) => [
                ymdhm(n.occurredAt),
                n.staffName,
                <span key="b" className="whitespace-pre-wrap">
                  {n.body}
                </span>,
                n.bookingCode ?? '—',
              ])}
              empty="対応ログはありません"
            />
            {detail.canManage && (
              <div className="mt-3">
                <ActionForm action={addMemberNoteAction} submitLabel="対応ログを追加">
                  <input type="hidden" name="memberCode" value={member.memberCode} />
                  <Field label="対応内容">
                    <textarea
                      name="body"
                      required
                      rows={3}
                      maxLength={2000}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="関連する予約番号（任意）">
                    <input name="bookingCode" className={inputClass} />
                  </Field>
                </ActionForm>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="予約履歴">
            <Table
              head={['予約番号', '日時', '店舗・部屋', '金額', '状態']}
              rows={detail.bookings.map((b) => {
                const startMinute = minuteOfBusinessDay(b.businessDate, b.start, b.timezone)
                const endMinute = minuteOfBusinessDay(b.businessDate, b.end, b.timezone)
                return [
                  b.bookingCode,
                  `${b.businessDate} ${hhmm(startMinute)}-${hhmm(endMinute)}`,
                  `${b.storeCode} ${b.roomLabel}`,
                  yen(b.total),
                  <Badge key="s" tone={b.status === 'confirmed' ? 'green' : 'gray'}>
                    {BOOKING_STATUS_LABELS[b.status] ?? b.status}
                  </Badge>,
                ]
              })}
              empty="予約はありません"
            />
          </Card>
          <Card title="クーポン">
            <Table
              head={['クーポン', '種別', '残回数', '期限', '状態']}
              rows={detail.coupons.map((g) => {
                const left = Math.max(0, g.maxUses - g.used)
                const valid = !g.revokedAt && g.expiresAt > now && left > 0
                return [
                  g.couponName,
                  g.discountType === 'amount'
                    ? `額 ${yen(g.discountValue)}`
                    : `率 ${g.discountValue}%`,
                  `${left}回`,
                  ymd(new Date(g.expiresAt.getTime() - 1)),
                  <Badge key="s" tone={valid ? 'green' : 'gray'}>
                    {g.revokedAt ? '取消' : valid ? '有効' : '失効'}
                  </Badge>,
                ]
              })}
              empty="クーポンはありません"
            />
          </Card>
          <Card title="決済履歴">
            <Table
              head={['日時', '予約番号', '方法', '金額', '状態']}
              rows={detail.payments.map((p) => [
                ymdhm(p.at),
                p.bookingCode,
                METHOD_LABELS[p.method] ?? p.method,
                yen(p.amount),
                PAYMENT_STATUS[p.status] ?? p.status,
              ])}
              empty="決済はありません"
            />
          </Card>
          <Card title="同意履歴">
            <Table
              head={['文書', '版', '同意日時', '経路']}
              rows={detail.consents.map((c) => [
                DOCUMENT_LABELS[c.documentType] ?? c.title,
                c.version,
                ymdhm(c.agreedAt),
                c.channel,
              ])}
              empty="同意履歴はありません"
            />
          </Card>
        </div>
      </div>
    </>
  )
}
