import type { CouponVersionDraft, PriceVersionDraft, StoreDraft } from '@jancube/domain'
import { hhmm, lastDay, WEEKDAYS, ymd } from './format'
import { Field, inputClass } from './ui'

/**
 * Field groups shared by the admin master forms. Names match the parsers in
 * `src/server/admin-form.ts`.
 */

type Option = { id: number; code: string; name: string }

const GRANT_TRIGGERS: [string, string][] = [
  ['manual', '手動配布・コード入力'],
  ['registration', '会員登録時（自動）'],
  ['line_friend', 'LINE友だち追加（自動）'],
  ['first_use', '初回利用後（自動）'],
  ['bulk', '一斉発行(A-15)'],
]

export function WeekdayChecks({ mask, name = 'weekday' }: { mask: number; name?: string }) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      {WEEKDAYS.map((label, i) => (
        <label key={label} className="inline-flex items-center gap-1">
          <input type="checkbox" name={name} value={i} defaultChecked={(mask & (1 << i)) !== 0} />
          {label}
        </label>
      ))}
    </div>
  )
}

/** A-14 coupon version (conditions). */
export function CouponVersionFields({
  defaults,
  stores,
  roomTypes,
}: {
  defaults: Partial<CouponVersionDraft>
  stores: readonly Option[]
  roomTypes: readonly Option[]
}) {
  const d = defaults
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="割引タイプ">
          <select
            name="discountType"
            defaultValue={d.discountType ?? 'amount'}
            className={inputClass}
          >
            <option value="amount">額(円)</option>
            <option value="percent">率(%)</option>
          </select>
        </Field>
        <Field label="割引値" hint="円 または %">
          <input
            name="discountValue"
            inputMode="decimal"
            required
            defaultValue={d.discountValue ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="値引上限(円)" hint="率のみ・空欄=上限なし">
          <input
            name="maximumDiscount"
            inputMode="numeric"
            defaultValue={d.maximumDiscount ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="最低利用金額(円)">
          <input
            name="minimumSpend"
            inputMode="numeric"
            defaultValue={d.minimumSpend ?? 0}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="利用回数(1付与あたり)">
          <input
            name="maxUses"
            inputMode="numeric"
            required
            defaultValue={d.maxUses ?? 1}
            className={inputClass}
          />
        </Field>
        <Field label="開始日">
          <input
            name="validFrom"
            type="date"
            required
            defaultValue={d.validFrom ? ymd(d.validFrom) : ''}
            className={inputClass}
          />
        </Field>
        <Field label="終了日(この日まで)">
          <input
            name="validTo"
            type="date"
            required
            defaultValue={d.validTo ? lastDay(d.validTo) : ''}
            className={inputClass}
          />
        </Field>
        <Field label="付与トリガー">
          <select
            name="grantTrigger"
            defaultValue={d.grantTrigger ?? 'manual'}
            className={inputClass}
          >
            {GRANT_TRIGGERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="対象曜日（利用開始日の曜日）">
        <WeekdayChecks mask={d.weekdayMask ?? 127} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="利用開始時刻 から" hint="空欄=終日">
          <input
            name="startTime"
            placeholder="10:00"
            defaultValue={hhmm(d.startMinute)}
            className={inputClass}
          />
        </Field>
        <Field label="利用開始時刻 まで" hint="深夜は 26:00 形式">
          <input
            name="endTime"
            placeholder="17:00"
            defaultValue={hhmm(d.endMinute)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="対象店舗（未選択=全店舗）">
        <div className="flex flex-wrap gap-3 text-sm">
          {stores.map((s) => (
            <label key={s.id} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                name="storeIds"
                value={s.id}
                defaultChecked={d.storeIds?.includes(s.id)}
              />
              {s.code} {s.name}
            </label>
          ))}
        </div>
      </Field>
      <Field label="対象部屋タイプ（未選択=すべて）">
        <div className="flex flex-wrap gap-3 text-sm">
          {roomTypes.map((t) => (
            <label key={t.id} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                name="roomTypeIds"
                value={t.id}
                defaultChecked={d.roomTypeIds?.includes(t.id)}
              />
              {t.name}
            </label>
          ))}
        </div>
      </Field>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" name="stackable" defaultChecked={d.stackable ?? false} />
        併用可（設定値として保存。Phase 1 は1予約1クーポンで運用・課題#6）
      </label>
      <Field label="お客様向け適用条件">
        <textarea
          name="conditionsNote"
          rows={2}
          defaultValue={d.conditionsNote ?? ''}
          className={inputClass}
        />
      </Field>
    </div>
  )
}

/** A-16 price version. Packages are entered one per line: "4h,5800" or "240,5800". */
export function PriceVersionFields({
  defaults,
  dateLabel = '適用開始日',
}: {
  defaults: Partial<PriceVersionDraft>
  dateLabel?: string
}) {
  const d = defaults
  const rules = [...(d.timeRules ?? []), undefined, undefined]
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="時間単価(円/60分)">
          <input
            name="hourlyRate"
            inputMode="numeric"
            required
            defaultValue={d.hourlyRate ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="最低利用時間(分)" hint="30分単位">
          <input
            name="minimumMinutes"
            inputMode="numeric"
            required
            defaultValue={d.minimumMinutes ?? 60}
            className={inputClass}
          />
        </Field>
        <Field label="消費税率(%)">
          <input
            name="taxRate"
            inputMode="decimal"
            required
            defaultValue={d.taxRatePercent ?? 10}
            className={inputClass}
          />
        </Field>
        <Field label={dateLabel} hint="今日以前=即時">
          <input
            name="validFrom"
            type="date"
            required
            defaultValue={d.validFrom ? ymd(d.validFrom) : ''}
            className={inputClass}
          />
        </Field>
      </div>
      <Field
        label="パック料金（1行に1パック: 時間,金額）"
        hint="例: 4h,5800 / 5.5h,7600 / 240,5800（分）"
      >
        <textarea
          name="packages"
          rows={5}
          defaultValue={(d.packages ?? []).map((p) => `${p.minutes / 60}h,${p.price}`).join('\n')}
          className={`${inputClass} font-mono`}
        />
      </Field>
      <div>
        <div className="mb-1 text-sm font-bold">曜日・時間帯ルール（1時間あたり値引）</div>
        <p className="mb-2 text-xs text-sub">
          保存のみ。現在の料金計算（予約画面・シミュレーション）には未反映です。曜日は 0=日〜6=土
          を並べて入力（例: 12345）。
        </p>
        <div className="space-y-2">
          {rules.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed input rows
            <div key={i} className="grid grid-cols-5 gap-2">
              <input
                name="ruleWeekdays"
                placeholder="曜日 12345"
                defaultValue={
                  r ? [0, 1, 2, 3, 4, 5, 6].filter((w) => r.weekdayMask & (1 << w)).join('') : ''
                }
                className={inputClass}
              />
              <select
                name="ruleHoliday"
                defaultValue={r?.holidayMode ?? 'any'}
                className={inputClass}
              >
                <option value="any">祝日問わず</option>
                <option value="exclude">祝日を除く</option>
                <option value="only">祝日のみ</option>
              </select>
              <input
                name="ruleStart"
                placeholder="開始 10:00"
                defaultValue={hhmm(r?.startMinute)}
                className={inputClass}
              />
              <input
                name="ruleEnd"
                placeholder="終了 17:00"
                defaultValue={hhmm(r?.endMinute)}
                className={inputClass}
              />
              <input
                name="ruleDiscount"
                placeholder="値引 円/時"
                defaultValue={r?.hourlyDiscount ?? ''}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** A-18 store fields. */
export function StoreFields({ d }: { d: Partial<StoreDraft> }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="店舗名">
          <input name="name" required defaultValue={d.name ?? ''} className={inputClass} />
        </Field>
        <Field label="電話番号">
          <input name="phone" defaultValue={d.phone ?? ''} className={inputClass} />
        </Field>
        <Field label="状態">
          <select name="status" defaultValue={d.status ?? 'preparing'} className={inputClass}>
            <option value="preparing">開業準備</option>
            <option value="open">営業中</option>
            <option value="closed">閉店</option>
          </select>
        </Field>
      </div>
      <Field label="住所">
        <input name="address" required defaultValue={d.address ?? ''} className={inputClass} />
      </Field>
      <Field label="アクセス情報">
        <input name="accessText" defaultValue={d.accessText ?? ''} className={inputClass} />
      </Field>
      <Field label="注意事項(予約画面に表示)">
        <textarea
          name="noticeText"
          rows={2}
          defaultValue={d.noticeText ?? ''}
          className={inputClass}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="地図URL">
          <input name="mapUrl" type="url" defaultValue={d.mapUrl ?? ''} className={inputClass} />
        </Field>
        <Field label="入室案内画像URL">
          <input
            name="entryGuideUrl"
            type="url"
            defaultValue={d.entryGuideUrl ?? ''}
            className={inputClass}
          />
        </Field>
      </div>
      <Field
        label="入室のご案内(店舗別)"
        hint="CQ-85 要確認: 入口の位置・コード入力の手順・お部屋までの順路"
      >
        <textarea
          name="entryGuideText"
          rows={3}
          defaultValue={d.entryGuideText ?? ''}
          className={inputClass}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="新システム受付開始日" hint="F-MIG-04 切替日。これより前の利用日は旧システム">
          <input
            name="bookingOpenDate"
            type="date"
            required
            defaultValue={d.bookingOpenDate ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="予約受付(何日先まで)">
          <input
            name="bookingHorizonDays"
            inputMode="numeric"
            required
            defaultValue={d.bookingHorizonDays ?? 60}
            className={inputClass}
          />
        </Field>
        <Field label="仮押さえ(分)">
          <input
            name="holdMinutes"
            inputMode="numeric"
            required
            defaultValue={d.holdMinutes ?? 10}
            className={inputClass}
          />
        </Field>
        <Field label="代理予約の仮押さえ(分)">
          <input
            name="proxyHoldMinutes"
            inputMode="numeric"
            required
            defaultValue={d.proxyHoldMinutes ?? 30}
            className={inputClass}
          />
        </Field>
        <Field label="清掃バッファ(分)">
          <input
            name="cleaningBufferMinutes"
            inputMode="numeric"
            required
            defaultValue={d.cleaningBufferMinutes ?? 15}
            className={inputClass}
          />
        </Field>
        <Field label="部屋最終確定の目安(開始前・分)">
          <input
            name="roomFinalizeMinutes"
            inputMode="numeric"
            defaultValue={d.roomFinalizeMinutes ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="鍵有効: 開始前(分)">
          <input
            name="keyBeforeMinutes"
            inputMode="numeric"
            required
            defaultValue={d.keyBeforeMinutes ?? 15}
            className={inputClass}
          />
        </Field>
        <Field label="鍵有効: 終了後(分)">
          <input
            name="keyAfterMinutes"
            inputMode="numeric"
            required
            defaultValue={d.keyAfterMinutes ?? 15}
            className={inputClass}
          />
        </Field>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={d.isActive ?? false} />
        お客様に公開する（予約画面の店舗一覧に表示）
      </label>
    </div>
  )
}

/** A-23 role rows (existing grants plus empty rows to add). */
export function GrantRows({
  grants,
  stores,
  roles,
}: {
  grants: readonly { role: string; storeId: number | null }[]
  stores: readonly Option[]
  roles: readonly (readonly [string, string])[]
}) {
  const rows = [...grants, { role: '', storeId: null }, { role: '', storeId: null }]
  return (
    <div className="space-y-2">
      {rows.map((g, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed input rows
        <div key={i} className="grid grid-cols-2 gap-2">
          <select name="grantRole" defaultValue={g.role} className={inputClass} aria-label="ロール">
            <option value="">（なし）</option>
            {roles.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            name="grantStore"
            defaultValue={g.storeId === null ? 'all' : String(g.storeId)}
            className={inputClass}
            aria-label="担当店舗"
          >
            <option value="all">全店舗（オーナー・本部のみ）</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {s.name}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}
