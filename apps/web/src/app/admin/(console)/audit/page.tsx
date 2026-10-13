import { AUDIT_ACTION_LABELS, type AuditLogEntry, REPORT_TIME_ZONE } from '@jancube/application'
import { addDays, utcToLocal } from '@jancube/domain'
import Link from 'next/link'
import {
  Badge,
  buttonClass,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
} from '@/components/admin/ui'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { messageForCode, toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

type Search = {
  from?: string
  to?: string
  actor?: string
  action?: string
  target?: string
  before?: string
  error?: string
}

const ACTOR_TONE = { system: 'gray', staff: 'green', member: 'gold' } as const

const jstTime = (instant: Date) => {
  const { date, minuteOfDay } = utcToLocal(instant, REPORT_TIME_ZONE)
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const mm = String(minuteOfDay % 60).padStart(2, '0')
  return `${date.slice(5).replace('-', '/')} ${hh}:${mm}:${String(instant.getUTCSeconds()).padStart(2, '0')}`
}

function Values({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-sub">—</span>
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return (
    <code title={text} className="block max-w-56 truncate text-xs">
      {text}
    </code>
  )
}

/** A-24 監査ログ (F-OPS-01): who did what to which record, with before/after values. */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff('audit.view')
  const storeId = await selectedStoreId(staff, 'audit.view')
  const q = await searchParams
  const today = utcToLocal(new Date(), REPORT_TIME_ZONE).date
  const from = q.from || addDays(today, -6)
  const to = q.to || today
  const before = Number(q.before) > 0 ? Number(q.before) : null

  let result: Awaited<ReturnType<typeof search>> | null = null
  let error: string | null = messageForCode(q.error)
  try {
    result = await search()
  } catch (e) {
    error = toUserMessage(e)
  }
  function search() {
    return withContainer((c) =>
      c.searchAuditLogs(staff.access, {
        from,
        to,
        actor: q.actor,
        action: q.action,
        target: q.target,
        storeId,
        beforeId: before,
      }),
    )
  }

  const filters = new URLSearchParams({
    from,
    to,
    actor: q.actor ?? '',
    action: q.action ?? '',
    target: q.target ?? '',
  })
  const csv = new URLSearchParams(filters)
  csv.set('type', 'audit_logs')
  if (storeId !== null) csv.set('store', String(storeId))

  return (
    <>
      <PageHeader
        title="監査ログ"
        description="管理操作・顧客操作・システム処理を、操作者・対象・前後の値とともに記録しています（保持期間は Q-06 で確定）"
      />
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4">
        <div className="w-56">
          <Field label="操作者" hint="氏名・メール・会員番号、または system">
            <input name="actor" defaultValue={q.actor} className={inputClass} />
          </Field>
        </div>
        <div className="w-56">
          <Field label="対象" hint="予約番号などの対象コード、対象ID">
            <input name="target" defaultValue={q.target} className={inputClass} />
          </Field>
        </div>
        <div className="w-48">
          <Field label="操作種別">
            <select name="action" defaultValue={q.action ?? ''} className={inputClass}>
              <option value="">すべて</option>
              {(result?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {AUDIT_ACTION_LABELS[a] ?? a}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="開始日">
            <input type="date" name="from" defaultValue={from} className={inputClass} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="終了日">
            <input type="date" name="to" defaultValue={to} className={inputClass} />
          </Field>
        </div>
        <button type="submit" className={buttonClass.primary}>
          検索
        </button>
        <a href={`/admin/reports/export?${csv.toString()}`} className={buttonClass.secondary}>
          CSV出力
        </a>
      </form>

      {error && (
        <div className="mb-4">
          <Notice tone="red">{error}</Notice>
        </div>
      )}

      {result && (
        <>
          <Table
            head={['日時', '操作者', 'ロール', '店舗', '対象', '操作', '前の値', '後の値', 'IP']}
            rows={result.entries.map((e: AuditLogEntry) => [
              <span key="t" className="whitespace-nowrap tabular-nums">
                {jstTime(e.occurredAt)}
              </span>,
              <span key="a" className="whitespace-nowrap">
                <Badge tone={ACTOR_TONE[e.actorType]}>
                  {e.actorType === 'system'
                    ? 'system'
                    : e.actorType === 'staff'
                      ? 'スタッフ'
                      : '顧客'}
                </Badge>{' '}
                {e.actorLabel}
              </span>,
              <span key="r" className="text-xs">
                {e.actorRoles.join(' / ') || '—'}
              </span>,
              e.storeCode ?? '—',
              <span key="g" className="whitespace-nowrap">
                {e.targetCode ?? `${e.targetType}${e.targetId ? ` #${e.targetId}` : ''}`}
              </span>,
              <span key="o" className="whitespace-nowrap" title={e.action}>
                {AUDIT_ACTION_LABELS[e.action] ?? e.action}
                {e.reason && <span className="block text-xs text-sub">理由: {e.reason}</span>}
              </span>,
              <Values key="b" value={e.before} />,
              <Values key="f" value={e.after} />,
              <span key="i" className="text-xs tabular-nums">
                {e.ip ?? '—'}
              </span>,
            ])}
            empty="条件に一致するログはありません"
          />
          <div className="mt-3 flex gap-3 text-sm">
            {before && (
              <Link
                href={`/admin/audit?${filters.toString()}`}
                className="font-bold text-brand-dark"
              >
                ‹ 最新に戻る
              </Link>
            )}
            {result.nextBeforeId && (
              <Link
                href={`/admin/audit?${filters.toString()}&before=${result.nextBeforeId}`}
                className="font-bold text-brand-dark"
              >
                さらに古いログ ›
              </Link>
            )}
          </div>
        </>
      )}
    </>
  )
}
