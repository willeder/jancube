import type { TimelineItem } from '@jancube/application'
import { can } from '@jancube/domain'
import Link from 'next/link'
import { buttonClass, Notice, PageHeader } from '@/components/admin/ui'
import { dateLabel, hhmm } from '@/lib/format'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

const SLOT_PX = 30
const LABEL_PX = 96

const itemClass: Record<TimelineItem['kind'], string> = {
  booking: 'border border-brand bg-brand-pale text-brand-dark',
  hold: 'border border-dashed border-gold bg-gold-pale text-ink',
  block: 'bg-line text-sub',
}

/** A-03 予約状況タイムライン: rooms × 30-minute slots for one business date. */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const staff = await requireStaff('bookings.view')
  const { date } = await searchParams
  let view: Awaited<ReturnType<typeof load>>
  try {
    view = await load(staff, date ?? null)
  } catch (error) {
    return (
      <>
        <PageHeader title="予約状況" />
        <Notice tone="red">{toUserMessage(error)}</Notice>
      </>
    )
  }
  const { opensMinute, closesMinute } = view
  const slots: number[] = []
  for (let m = opensMinute; m < closesMinute; m += 30) slots.push(m)
  const width = slots.length * SLOT_PX
  const place = (item: TimelineItem) => {
    const start = Math.max(item.startMinute, opensMinute)
    const end = Math.min(item.endMinute, closesMinute)
    return { left: ((start - opensMinute) / 30) * SLOT_PX, width: ((end - start) / 30) * SLOT_PX }
  }

  return (
    <>
      <PageHeader
        title="予約状況"
        description={`${view.store.code} ${view.store.name} / 30分刻み × 部屋の日別タイムライン。予約をクリックすると詳細・割当変更へ進みます`}
        actions={
          can(staff.access, 'bookings.manage') ? (
            <Link href="/admin/bookings/new" className={buttonClass.primary}>
              ＋ 代理予約作成
            </Link>
          ) : undefined
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {view.week.map((d) => (
          <Link
            key={d.date}
            href={`/admin/timeline?date=${d.date}`}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              d.date === view.date ? 'border-brand bg-brand text-white' : 'border-line bg-white'
            }`}
          >
            {dateLabel(d.date)} {d.count}件
          </Link>
        ))}
        <form className="ml-auto flex items-center gap-1 text-xs">
          <input
            type="date"
            name="date"
            defaultValue={view.date}
            className="rounded-lg border border-line bg-white px-2 py-1"
            aria-label="日付"
          />
          <button type="submit" className={buttonClass.secondary}>
            表示
          </button>
        </form>
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-sub">
        <span>
          <span className="mr-1 inline-block size-3 border border-brand bg-brand-pale align-middle" />
          確定
        </span>
        <span>
          <span className="mr-1 inline-block size-3 border border-dashed border-gold bg-gold-pale align-middle" />
          仮押さえ(決済待ち)
        </span>
        <span>
          <span className="mr-1 inline-block size-3 bg-line align-middle" />
          ブロック
        </span>
        <span>
          <span className="mr-1 inline-block size-3 border border-alert align-middle" />
          要清掃
        </span>
        <span>「仮」＝前日バッチによる仮割当</span>
      </div>
      {view.closed && (
        <div className="mb-2">
          <Notice>この日は休業日です（10:00〜24:00 の枠で表示しています）</Notice>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <div style={{ width: width + LABEL_PX }}>
          <div className="flex border-b border-line bg-paper text-[10px] text-sub">
            <div className="w-24 shrink-0 px-1.5 py-1">部屋 / 時刻</div>
            <div className="relative h-6" style={{ width }}>
              {slots
                .filter((m) => m % 60 === 0)
                .map((m) => (
                  <span
                    key={m}
                    className="absolute top-1"
                    style={{ left: ((m - opensMinute) / 30) * SLOT_PX }}
                  >
                    {hhmm(m)}
                  </span>
                ))}
            </div>
          </div>
          {view.rows.map((row) => (
            <div
              key={row.key}
              className={`flex border-b border-line last:border-b-0 ${row.inactive ? 'bg-paper' : ''}`}
            >
              <div className="w-24 shrink-0 px-1.5 py-1">
                <div
                  className={`text-xs font-bold ${row.inactive ? 'text-sub' : ''} ${
                    row.unassigned ? 'text-alert' : ''
                  }`}
                >
                  {row.label}
                  {row.dirty && !row.inactive && (
                    <span className="ml-1 rounded border border-alert px-1 text-[10px] text-alert">
                      要清掃
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-sub">{row.sub}</div>
              </div>
              <div
                className={`relative min-h-11 self-stretch ${row.inactive ? 'bg-line/60' : ''}`}
                style={{
                  width,
                  backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${SLOT_PX - 1}px, var(--color-line) ${SLOT_PX - 1}px ${SLOT_PX}px)`,
                }}
              >
                {row.items.map((item, i) => {
                  const pos = place(item)
                  if (pos.width <= 0) return null
                  const cls = `absolute top-1 bottom-1 overflow-hidden rounded px-1 text-[10px] leading-8 whitespace-nowrap ${itemClass[item.kind]}`
                  const text = `${item.provisional ? '仮 ' : ''}${item.label}`
                  return item.bookingCode ? (
                    <Link
                      // biome-ignore lint/suspicious/noArrayIndexKey: items of one row are re-rendered together
                      key={i}
                      href={`/admin/bookings/${item.bookingCode}`}
                      className={`${cls} hover:opacity-80`}
                      style={pos}
                      title={`${item.bookingCode} ${hhmm(item.startMinute)}-${hhmm(item.endMinute)} ${text}`}
                    >
                      {text}
                    </Link>
                  ) : (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: items of one row are re-rendered together
                      key={i}
                      className={cls}
                      style={pos}
                      title={`${hhmm(item.startMinute)}-${hhmm(item.endMinute)} ${item.label}`}
                    >
                      {item.label}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <UnassignedLinks rows={view.rows} />
      <div className="mt-4">
        <Notice>
          予約を選ぶと詳細が開きます。部屋の割当変更は予約詳細または未割当一覧から行ってください。
        </Notice>
      </div>
    </>
  )
}

/** Unassigned bookings get a direct link to A-07 (room assignment). */
function UnassignedLinks({ rows }: { rows: Awaited<ReturnType<typeof load>>['rows'] }) {
  const waiting = rows.filter((r) => r.unassigned).flatMap((r) => r.items)
  if (waiting.length === 0) return null
  return (
    <section className="mt-4 rounded-xl border border-line bg-white p-4 text-sm">
      <h2 className="mb-2 font-bold">部屋未割当の予約</h2>
      <ul className="flex flex-wrap gap-2">
        {waiting.map((item) => (
          <li key={item.bookingCode}>
            <Link
              href={`/admin/bookings/${item.bookingCode}/assignment`}
              className={buttonClass.secondary}
            >
              {item.bookingCode} {hhmm(item.startMinute)}〜 を割当(A-07)
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

async function load(staff: Awaited<ReturnType<typeof requireStaff>>, date: string | null) {
  const storeId = await selectedStoreId(staff, 'bookings.view')
  return withContainer((c) => c.getTimeline(staff.access, storeId, date))
}
