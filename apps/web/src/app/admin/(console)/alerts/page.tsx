import type { AlertRow } from '@jancube/application'
import { shortDateTime } from '@/components/admin/booking-format'
import {
  Badge,
  buttonClass,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Stat,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { alertAction } from '@/server/admin-booking-actions'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  notification_failed: '通知失敗',
  refund_failed: '返金失敗',
  key_issue_failed: '鍵発行失敗',
  webhook_failed: 'Webhook失敗',
  assignment_failed: '仮割当不能',
}

const STATUS: Record<AlertRow['status'], { label: string; tone: 'red' | 'gold' | 'green' }> = {
  open: { label: '未対応', tone: 'red' },
  in_progress: { label: '対応中', tone: 'gold' },
  resolved: { label: '解決済', tone: 'green' },
}

const SEVERITY: Record<AlertRow['severity'], string> = {
  critical: '重大',
  warning: '警告',
  info: '情報',
}

/** A-25 アラート一覧: failures of automatic processing with their recovery steps. */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; type?: string; error?: string }>
}) {
  const staff = await requireStaff('alerts.manage')
  const q = await searchParams
  let data: Awaited<ReturnType<typeof load>>
  try {
    data = await load(staff, q)
  } catch (e) {
    return (
      <>
        <PageHeader title="アラート一覧" />
        <Notice tone="red">{toUserMessage(e)}</Notice>
      </>
    )
  }
  const self = `/admin/alerts?${new URLSearchParams(
    Object.entries({ status: q.status, severity: q.severity, type: q.type }).filter(
      ([, v]) => v,
    ) as [string, string][],
  )}`

  return (
    <>
      <PageHeader
        title="アラート一覧"
        description="自動処理の失敗を検知し、失敗理由と復旧手順を表示します"
      />
      <div className="mb-4 grid grid-cols-3 gap-3 md:w-2/3">
        <Stat value={`${data.counts.open}件`} label="未対応" />
        <Stat value={`${data.counts.inProgress}件`} label="対応中" />
        <Stat value={`${data.counts.resolvedSince}件`} label="24時間以内に解決" />
      </div>
      {q.error && (
        <div className="mb-3">
          <Notice tone="red">{q.error}</Notice>
        </div>
      )}
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="状態">
          <select name="status" defaultValue={q.status ?? ''} className={inputClass}>
            <option value="">未対応・対応中</option>
            <option value="open">未対応</option>
            <option value="in_progress">対応中</option>
            <option value="resolved">解決済</option>
          </select>
        </Field>
        <Field label="重要度">
          <select name="severity" defaultValue={q.severity ?? ''} className={inputClass}>
            <option value="">すべて</option>
            <option value="critical">重大</option>
            <option value="warning">警告</option>
            <option value="info">情報</option>
          </select>
        </Field>
        <Field label="種別">
          <select name="type" defaultValue={q.type ?? ''} className={inputClass}>
            <option value="">すべて</option>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className={buttonClass.primary}>
          検索
        </button>
      </form>

      <Table
        head={['発生日時', '種別', '対象', '失敗理由', '復旧手順', '状態', '操作']}
        rows={data.rows.map((a) => [
          shortDateTime(a.detectedAt),
          <span key="t">
            {TYPE_LABEL[a.alertType] ?? a.alertType}
            <br />
            <span className="text-xs text-sub">{SEVERITY[a.severity]}</span>
          </span>,
          <span key="o">
            {a.storeCode ?? '全店'}
            {a.bookingCode && (
              <>
                <br />
                <TextLink href={`/admin/bookings/${a.bookingCode}`}>{a.bookingCode}</TextLink>
              </>
            )}
          </span>,
          <span key="f" className="text-xs">
            {a.failureReason}
          </span>,
          <span key="r" className="text-xs">
            {a.recoverySteps}
          </span>,
          <span key="s">
            <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
            {a.assignedStaffName && (
              <span className="block text-xs text-sub">担当 {a.assignedStaffName}</span>
            )}
            {a.resolvedAt && (
              <span className="block text-xs text-sub">{shortDateTime(a.resolvedAt)}</span>
            )}
          </span>,
          a.status === 'resolved' ? null : (
            <div key="a" className="flex flex-col gap-1">
              {a.assignedStaffId !== staff.staffId && (
                <form action={alertAction}>
                  <input type="hidden" name="alertId" value={a.id} />
                  <input type="hidden" name="op" value="assign" />
                  <input type="hidden" name="back" value={self} />
                  <button type="submit" className={buttonClass.secondary}>
                    自分が対応
                  </button>
                </form>
              )}
              <form action={alertAction}>
                <input type="hidden" name="alertId" value={a.id} />
                <input type="hidden" name="op" value="resolve" />
                <input type="hidden" name="back" value={self} />
                <button type="submit" className={buttonClass.primary}>
                  解決
                </button>
              </form>
            </div>
          ),
        ])}
        empty="該当するアラートはありません"
      />
      <div className="mt-3">
        <Notice>
          自動再試行の回数・手動フォールバック手順は要確認(Q-04)。再試行が必要なものは各画面（鍵:
          A-09、返金: A-26、通知: 予約詳細の「再送」）から行い、完了後に「解決」にしてください
        </Notice>
      </div>
    </>
  )
}

async function load(
  staff: Awaited<ReturnType<typeof requireStaff>>,
  q: { status?: string; severity?: string; type?: string },
) {
  const storeId = await selectedStoreId(staff, 'alerts.manage')
  return withContainer((c) =>
    c.listAlerts(staff.access, storeId, {
      status: q.status,
      severity: q.severity,
      alertType: q.type,
    }),
  )
}
