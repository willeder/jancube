import {
  formatReportTime,
  percent,
  REPORT_TIME_ZONE,
  REPORT_TYPES,
  type ReportExportRecord,
  type ReportSummary,
  type ReportType,
} from '@jancube/application'
import { utcToLocal, visibleStoreIds } from '@jancube/domain'
import type { ReactNode } from 'react'
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
import { yen } from '@/lib/format'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { messageForCode, toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

/** Main columns of each CSV (Q-05: final columns to be confirmed by the client). */
const COLUMNS: Record<Exclude<ReportType, 'audit_logs'>, string> = {
  bookings:
    '予約番号・利用日時・店舗・部屋タイプ/部屋・会員番号・状態・経路・流入元/UTM・金額・クーポン・決済/返金額',
  sales: '計上日時・決済/返金・方法・金額(税込)・税率・うち消費税・店舗・予約番号・外部取引ID',
  occupancy: '日付・店舗・部屋タイプ・部屋数・営業時間・予約室時間・空き室時間・稼働率',
  acquisition: '経路・流入元・UTM・予約数・売上・初回率・2回目転換率',
  coupon_effect: 'クーポン・配布数・利用数・利用率・割引総額・売上・再予約率',
  coupon_redemptions: '適用日時・クーポン・予約番号・会員番号・利用回・割引額・状態',
  cleaning: '完了時刻・店舗・部屋・種別・担当・所要時間・期限超過',
  funnel: '店舗選択・空き状況表示(訪問者)・仮押さえ・ログイン・決済開始・確定・確定率',
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`
}

/** A-27 レポート・CSVエクスポート (F-RPT-02〜07, F-PAY-09, F-CPN-10). */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; store?: string; error?: string }>
}) {
  const staff = await requireStaff('reports.export')
  const q = await searchParams
  const today = utcToLocal(new Date(), REPORT_TIME_ZONE).date
  const from = q.from || monthStart(today)
  const to = q.to || today
  const selected = await selectedStoreId(staff, 'reports.export')
  const storeId = q.store === 'all' ? null : q.store ? Number(q.store) : selected

  const visible = visibleStoreIds(staff.access, 'reports.export')
  let summary: ReportSummary | null = null
  let history: ReportExportRecord[] = []
  let stores: { id: number; code: string; name: string }[] = []
  let error = messageForCode(q.error)
  try {
    ;[summary, history, stores] = await withContainer((c) =>
      Promise.all([
        c.getReportSummary(staff.access, { from, to, storeId }),
        c.listReportExports(staff.access, storeId),
        c.listAdminStores(),
      ]),
    )
  } catch (e) {
    error = toUserMessage(e)
  }
  const choices = visible === null ? stores : stores.filter((s) => visible.includes(s.id))

  const params = (type: string) => {
    const p = new URLSearchParams({ type, from, to })
    if (storeId !== null) p.set('store', String(storeId))
    return `/admin/reports/export?${p.toString()}`
  }
  const totals = summary && {
    paid: summary.sales.reduce((n, s) => n + s.paid, 0),
    refunded: summary.sales.reduce((n, s) => n + s.refunded, 0),
    booked: summary.occupancy.reduce((n, o) => n + o.booked, 0),
    available: summary.occupancy.reduce((n, o) => n + o.available, 0),
    confirmed: summary.funnel.lines.reduce((n, l) => n + l.confirmed, 0),
  }

  return (
    <>
      <PageHeader
        title="レポート・CSVエクスポート"
        description="期間と店舗を指定して集計の確認とCSV出力ができます。CSVはUTF-8(BOM付き)でExcelでそのまま開けます"
      />

      <Card title="出力条件" className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="店舗">
              <select
                name="store"
                defaultValue={storeId === null ? 'all' : String(storeId)}
                className={inputClass}
              >
                {visible === null && <option value="all">全店舗</option>}
                {choices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="開始日">
              <input type="date" name="from" defaultValue={from} className={inputClass} required />
            </Field>
          </div>
          <div className="w-44">
            <Field label="終了日">
              <input type="date" name="to" defaultValue={to} className={inputClass} required />
            </Field>
          </div>
          <div className="w-44">
            <Field label="文字コード">
              <select disabled className={inputClass} defaultValue="utf8bom">
                <option value="utf8bom">UTF-8(BOM付き)</option>
              </select>
            </Field>
          </div>
          <button type="submit" className={buttonClass.primary}>
            集計を表示
          </button>
        </form>
        <p className="mt-2 text-xs text-sub">
          予約・稼働は利用日、売上・クーポン・清掃は発生日（日本時間）で集計します。最長1年
        </p>
      </Card>

      {error && (
        <div className="mb-4">
          <Notice tone="red">{error}</Notice>
        </div>
      )}

      <div className="mb-2">
        <Table
          head={['レポート', '単位', '主な項目', '出力']}
          rows={(Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).map((type) => [
            <span key="l" className="whitespace-nowrap font-bold">
              {REPORT_TYPES[type].label}
            </span>,
            <span key="u" className="whitespace-nowrap text-xs">
              {REPORT_TYPES[type].unit}
            </span>,
            <span key="c" className="text-xs text-sub">
              {COLUMNS[type]}
            </span>,
            <a key="b" href={params(type)} className={`${buttonClass.secondary} whitespace-nowrap`}>
              CSV出力
            </a>,
          ])}
        />
      </div>
      <div className="mb-6">
        <Notice>
          CSVの具体的な出力項目は要確認（Q-05）です。会計処理・分析で必要な項目をご指定ください。
          金額はすべて税込、消費税額は税込金額から逆算（切り捨て）しています
        </Notice>
      </div>

      {summary && totals && (
        <section className="mb-6 space-y-4">
          <h2 className="font-bold">期間の集計（{summary.stores.length}店舗）</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat value={yen(totals.paid - totals.refunded)} label="売上（決済−返金）" />
            <Stat
              value={pct(percent(totals.booked, totals.available))}
              label="稼働率（予約室時間/提供室時間）"
            />
            <Stat value={`${totals.confirmed}件`} label="Web/LINE予約の確定" />
            <Stat value={`${summary.funnel.liffOpened}人`} label="LINE(LIFF)からの来訪" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <SummaryCard title="売上（店舗×日）">
              <Table
                head={['日付', '店舗', '決済件数', '決済額', '返金額', '純売上']}
                rows={summary.sales.map((s) => [
                  s.date,
                  s.storeCode,
                  s.payments,
                  yen(s.paid),
                  yen(s.refunded),
                  <b key="n">{yen(s.net)}</b>,
                ])}
              />
            </SummaryCard>
            <SummaryCard title="稼働率（店舗×日）">
              <Table
                head={['日付', '店舗', '予約室時間', '提供室時間', '稼働率']}
                rows={summary.occupancy
                  .filter((o) => o.available > 0 || o.booked > 0)
                  .map((o) => [
                    o.date,
                    o.storeCode,
                    hours(o.booked),
                    hours(o.available),
                    pct(o.rate),
                  ])}
              />
            </SummaryCard>
            <SummaryCard title="流入元">
              <Table
                head={['経路', '流入元', '予約数', '売上', '初回率', '2回目転換率']}
                rows={summary.acquisition.map((a) => [
                  <Badge key="c" tone={a.channel === 'liff' ? 'green' : 'gray'}>
                    {a.channel}
                  </Badge>,
                  [a.acquisitionSource ?? a.utmSource ?? '（直接）', a.utmCampaign]
                    .filter(Boolean)
                    .join(' / '),
                  a.bookings,
                  yen(a.sales),
                  pct(a.firstTimeRate),
                  pct(a.secondRate),
                ])}
              />
            </SummaryCard>
            <SummaryCard title="クーポン効果">
              <Table
                head={['クーポン', '配布', '利用率', '利用件数', '割引総額', '再予約率']}
                rows={summary.coupons.map((c) => [
                  <span key="n">
                    {c.name}
                    <span className="block text-xs text-sub">{c.code}</span>
                  </span>,
                  c.issued,
                  pct(c.usageRate),
                  c.redemptions,
                  yen(c.discountTotal),
                  pct(c.rebookRate),
                ])}
              />
              <p className="mt-1 text-xs text-sub">
                配布数は全店舗共通（クーポンは店舗に紐づかないため）
              </p>
            </SummaryCard>
            <SummaryCard title="清掃実績">
              <Table
                head={['店舗', '完了', '開店前', 'スポット', '期限超過', '平均所要']}
                rows={summary.cleaning.map((c) => [
                  c.storeCode,
                  c.total,
                  c.opening,
                  c.spot,
                  c.overdue,
                  c.averageMinutes === null ? '—' : `${c.averageMinutes}分`,
                ])}
              />
            </SummaryCard>
            <SummaryCard title="予約ファネル（Web・LINE）">
              <Table
                head={[
                  '店舗',
                  '店舗選択',
                  '空き状況',
                  '仮押さえ',
                  'ログイン',
                  '決済開始',
                  '確定',
                  '確定率',
                ]}
                rows={summary.funnel.lines.map((l) => [
                  l.storeCode,
                  l.storeSelected,
                  l.slotsViewed,
                  l.holds,
                  l.signedIn,
                  l.checkoutStarted,
                  l.confirmed,
                  pct(l.conversion),
                ])}
              />
              <p className="mt-1 text-xs text-sub">
                店舗選択・空き状況は訪問者数、仮押さえ以降は予約データの件数です
              </p>
            </SummaryCard>
          </div>
        </section>
      )}

      <h2 className="mb-2 font-bold">出力履歴</h2>
      <Table
        head={['日時', 'レポート', '条件', '出力者', '件数', '状態']}
        rows={history.map((h) => [
          <span key="t" className="whitespace-nowrap tabular-nums">
            {formatReportTime(h.createdAt).slice(0, 16)}
          </span>,
          REPORT_TYPES[h.reportType as ReportType]?.label ?? h.reportType,
          `${h.storeCode ?? '全店舗'} / ${h.periodFrom}〜${h.periodTo}`,
          h.staffName,
          h.rowCount === null ? '—' : `${h.rowCount}件`,
          <Badge
            key="s"
            tone={h.status === 'completed' ? 'green' : h.status === 'failed' ? 'red' : 'gold'}
          >
            {h.status === 'completed' ? '完了' : h.status === 'failed' ? '失敗' : '出力中'}
          </Badge>,
        ])}
        empty="出力履歴はありません"
      />
    </>
  )
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-bold">{title}</h3>
      <div className="max-h-80 overflow-y-auto">{children}</div>
    </div>
  )
}
