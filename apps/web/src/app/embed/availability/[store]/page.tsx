import type { AvailabilityWidget, WidgetCell } from '@jancube/application'
import { hhmm, WEEKDAYS, weekdayIndex } from '@/lib/format'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { maintenanceStatus } from '@/server/maintenance'

export const dynamic = 'force-dynamic'

const MARK: Record<WidgetCell, { text: string; className: string; label: string }> = {
  available: { text: '◯', className: 'text-brand', label: '空きあり' },
  few: { text: '△', className: 'text-gold', label: '残りわずか' },
  full: { text: '✕', className: 'text-sub/60', label: '満室' },
  past: { text: '−', className: 'text-sub/40', label: '受付終了' },
  closed: { text: '休', className: 'text-sub/40', label: '休業・時間外' },
}

/**
 * C-23 空き状況ウィジェット: compact view for an iframe on the store's WordPress site (Q-01, tracker
 * #24: the public pages link into the booking flow). No customer header; framing is allowed for
 * /embed/* only (next.config.ts). Usage: <iframe src="https://…/embed/availability/JC001?days=3">.
 */
export default async function AvailabilityWidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { store } = await params
  const { days } = await searchParams
  if (maintenanceStatus().enabled) {
    return <Frame>ただいまメンテナンス中です</Frame>
  }
  let widget: AvailabilityWidget
  try {
    widget = await withContainer((c) =>
      c.getAvailabilityWidget(store, Math.min(7, Math.max(1, Number(days) || 3))),
    )
  } catch (error) {
    return <Frame>{toUserMessage(error)}</Frame>
  }
  const updated = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(widget.generatedAt)

  return (
    <main className="mx-auto max-w-md bg-white p-3 text-xs">
      <div className="flex items-baseline justify-between">
        <h1 className="text-sm font-bold">
          {widget.store.code} {widget.store.name} 空き状況
        </h1>
        <span className="text-sub">更新 {updated}</span>
      </div>
      {widget.roomTypes.map((type) => (
        <section key={type.code} className="mt-2">
          <h2 className="font-bold text-brand-dark">{type.name}</h2>
          <table className="mt-1 w-full table-fixed border-collapse text-center">
            <thead>
              <tr className="text-sub">
                <th className="w-16 py-0.5 text-left font-normal">日付 / 時</th>
                {widget.blocks.map((m) => (
                  <th key={m} className="py-0.5 font-normal">
                    {hhmm(m).replace(':00', '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {type.rows.map((row) => (
                <tr key={row.date} className="border-t border-line">
                  <th className="py-1 text-left font-normal">{shortDate(row.date)}</th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={widget.blocks[i]}
                      className={`py-1 font-bold ${MARK[cell].className}`}
                      title={MARK[cell].label}
                    >
                      {MARK[cell].text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="mt-2 text-[10px] text-sub">
        ◯空きあり △残りわずか ✕満室（2時間ごとの目安。正確な空きは予約画面でご確認ください）
      </p>
      <a
        href={`/booking/${encodeURIComponent(widget.store.code)}/date?utm_source=wordpress&utm_medium=widget`}
        target="_top"
        className="mt-2 block rounded-lg bg-brand py-2 text-center text-sm font-bold text-white"
      >
        このお店を予約する
      </a>
    </main>
  )
}

/** "2026-07-06" → "7/6(月)" */
function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}(${WEEKDAYS[weekdayIndex(date)]})`
}

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="bg-white p-3 text-center text-xs text-sub">{children}</main>
}
