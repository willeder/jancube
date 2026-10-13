import { formatJapaneseMobile } from '@jancube/domain'
import Link from 'next/link'
import { MEMBER_STATUS_LABELS, memberStatusTone } from '@/components/admin/format'
import {
  Badge,
  buttonClass,
  Field,
  inputClass,
  PageHeader,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** A-11 会員一覧 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; line?: string; page?: string }>
}) {
  const staff = await requireStaff('members.view')
  const params = await searchParams
  const result = await withContainer((c) =>
    c.searchMembers(staff, {
      query: params.q,
      status: params.status,
      line: params.line,
      page: Number(params.page ?? 1),
    }),
  )
  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1
  const to = Math.min(result.total, result.page * result.pageSize)
  const pageLink = (page: number) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    if (params.status) q.set('status', params.status)
    if (params.line) q.set('line', params.line)
    q.set('page', String(page))
    return `/admin/members?${q}`
  }

  return (
    <>
      <PageHeader
        title="会員一覧"
        description="氏名・電話番号・会員ID・メールで検索します。店舗スタッフは担当店舗の利用履歴がある会員のみ表示されます"
      />
      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <div className="w-72">
          <Field label="氏名 / 電話番号 / 会員ID / メール">
            <input
              name="q"
              defaultValue={params.q ?? ''}
              placeholder="山田 / 090… / JC-U-…"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="状態">
          <select name="status" defaultValue={params.status ?? ''} className={inputClass}>
            <option value="">すべて</option>
            {Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="LINE連携">
          <select name="line" defaultValue={params.line ?? ''} className={inputClass}>
            <option value="">すべて</option>
            <option value="linked">連携済</option>
            <option value="unlinked">未連携</option>
          </select>
        </Field>
        <button type="submit" className={buttonClass.primary}>
          検索
        </button>
      </form>
      <p className="mb-2 text-xs text-sub">
        該当 {result.total.toLocaleString('ja-JP')}件 / {from}〜{to}件を表示
      </p>
      <Table
        head={['会員ID', '氏名', '電話番号', 'メール', 'LINE', '利用回数', '最終利用', '状態']}
        rows={result.rows.map((m) => [
          <TextLink key="c" href={`/admin/members/${encodeURIComponent(m.memberCode)}`}>
            {m.memberCode}
          </TextLink>,
          `${m.familyName ?? ''} ${m.givenName ?? ''}`.trim() || '—',
          m.phone ? formatJapaneseMobile(m.phone) : '—',
          m.email ?? '—',
          m.lineLinked ? '連携済' : '未連携',
          `${m.useCount}回`,
          m.lastUseDate ?? '—',
          <Badge key="s" tone={memberStatusTone(m.status)}>
            {MEMBER_STATUS_LABELS[m.status] ?? m.status}
          </Badge>,
        ])}
      />
      <div className="mt-3 flex gap-3 text-sm">
        {result.page > 1 && (
          <Link className="font-bold text-brand-dark" href={pageLink(result.page - 1)}>
            ← 前へ
          </Link>
        )}
        {to < result.total && (
          <Link className="font-bold text-brand-dark" href={pageLink(result.page + 1)}>
            次へ →
          </Link>
        )}
        <span className="ml-auto text-xs text-sub">登録日の新しい順</span>
      </div>
    </>
  )
}
