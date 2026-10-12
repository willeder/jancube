import { localToday } from '@jancube/application'
import { parseClock } from '@jancube/domain'
import { duration, yen } from '@/components/admin/format'
import {
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
} from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toAdminMessage } from '@/server/errors'

export const dynamic = 'force-dynamic'

const REJECTIONS: Record<string, string> = {
  not_started: '利用開始前',
  expired: '期限切れ',
  store_not_eligible: '対象外の店舗',
  room_not_eligible: '対象外の部屋タイプ',
  weekday_not_eligible: '対象外の曜日',
  time_not_eligible: '対象外の時間帯',
  below_minimum_spend: '最低利用金額に未達',
}

type Params = {
  mode?: string
  room?: string
  date?: string
  start?: string
  end?: string
  coupon?: string
  version?: string
  minutes?: string
}

/** A-17 料金シミュレーション: the quote the booking flow would make, with its breakdown. */
export default async function SimulatePage({ searchParams }: { searchParams: Promise<Params> }) {
  const staff = await requireStaff('prices.manage')
  const p = await searchParams
  const mode = p.mode === 'version' || (p.version && !p.room) ? 'version' : 'room'
  const options = await withContainer((c) => c.listSimulationOptions(staff))
  const date = p.date ?? localToday(new Date())
  const stores = [...new Set(options.rooms.map((r) => r.storeCode))]

  let result: Awaited<ReturnType<typeof run>> | null = null
  let error: string | null = null
  async function run() {
    return withContainer((c) =>
      mode === 'room'
        ? c.simulatePrice(staff, {
            mode: 'room',
            roomId: Number(p.room),
            date,
            startMinute: parseClock(p.start ?? ''),
            endMinute: parseClock(p.end ?? ''),
            couponId: p.coupon ? Number(p.coupon) : null,
          })
        : c.simulatePrice(staff, {
            mode: 'version',
            versionId: Number(p.version),
            minutes: Number(p.minutes ?? 0),
          }),
    )
  }
  const ready = mode === 'room' ? !!(p.room && p.start && p.end) : !!(p.version && p.minutes)
  if (ready) {
    try {
      result = await run()
    } catch (e) {
      error = toAdminMessage(e)
    }
  }

  return (
    <>
      <PageHeader
        title="料金シミュレーション"
        description="条件を入力して、予約画面と同じ計算で適用される料金の内訳を確認します"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="部屋・日時で試算">
          <form method="get" className="space-y-3">
            <input type="hidden" name="mode" value="room" />
            <Field label="部屋">
              <select name="room" defaultValue={p.room ?? ''} required className={inputClass}>
                {stores.map((store) => (
                  <optgroup key={store} label={store}>
                    {options.rooms
                      .filter((r) => r.storeCode === store)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code}（{r.roomTypeName}）
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="利用日">
                <input
                  name="date"
                  type="date"
                  defaultValue={date}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="開始">
                <input
                  name="start"
                  defaultValue={p.start ?? '13:00'}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="終了" hint="深夜は 26:00">
                <input name="end" defaultValue={p.end ?? '16:00'} required className={inputClass} />
              </Field>
            </div>
            <Field label="適用クーポン（任意）">
              <select name="coupon" defaultValue={p.coupon ?? ''} className={inputClass}>
                <option value="">なし</option>
                {options.coupons.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className={buttonClass.primary}>
              計算する
            </button>
          </form>
        </Card>
        <Card title="料金パターンで試算">
          <form method="get" className="space-y-3">
            <input type="hidden" name="mode" value="version" />
            <Field label="料金パターン（最新版）">
              <select name="version" defaultValue={p.version ?? ''} required className={inputClass}>
                {options.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="利用時間(分)" hint="30分単位">
              <input
                name="minutes"
                inputMode="numeric"
                defaultValue={p.minutes ?? '180'}
                required
                className={inputClass}
              />
            </Field>
            <button type="submit" className={buttonClass.primary}>
              計算する
            </button>
          </form>
        </Card>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="red">{error}</Notice>
        </div>
      )}
      {result && (
        <Card title="計算結果" className="mt-4 border-brand">
          <Table
            head={['項目', '内容', '金額']}
            rows={[
              [
                '適用パターン',
                `${result.version.profileName} 第${result.version.versionNo}版`,
                '—',
              ],
              [
                '利用時間',
                `${duration(result.minutes)}（30分単位）${result.belowMinimum ? ` ※最低利用時間 ${duration(result.version.minimumMinutes)} 未満のため予約不可` : ''}`,
                '—',
              ],
              ...result.quote.lines.map((l) => [
                l.kind === 'package' ? 'パック料金' : l.kind === 'hour' ? '時間料金' : '30分料金',
                l.kind === 'package' ? `${duration(l.minutes)}パック` : duration(l.minutes),
                yen(l.amount),
              ]),
              [
                '時間単価との比較',
                `通常 ${yen(result.quote.regularPrice)}`,
                result.quote.discountAmount > 0
                  ? `-${yen(result.quote.discountAmount)}（${result.quote.discountRatePercent}%お得）`
                  : '同額',
              ],
              ...(result.coupon
                ? [
                    [
                      'クーポン',
                      result.coupon.name,
                      result.coupon.evaluation.ok
                        ? `-${yen(result.coupon.evaluation.discount)}`
                        : `適用不可（${REJECTIONS[result.coupon.evaluation.reason] ?? result.coupon.evaluation.reason}）`,
                    ],
                  ]
                : []),
              [
                '合計(税込)',
                `うち消費税 ${yen(result.tax)}（${result.version.taxRatePercent}%）`,
                yen(result.total),
              ],
            ]}
          />
          {result.version.timeRules.length > 0 && (
            <p className="mt-2 text-xs text-sub">
              この版には時間帯ルールがありますが、現在の料金計算には反映されていません（要確認）。
            </p>
          )}
        </Card>
      )}
    </>
  )
}
