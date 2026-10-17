import type { RoomDraft, RoomPhoto } from '@jancube/application'
import { Field, inputClass } from '@/components/admin/ui'

/** A-19 room fields shared by the add and edit forms. */
export function RoomFields({ d }: { d: Partial<RoomDraft> & { photos?: readonly RoomPhoto[] } }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="表示名">
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={d.name}
            className={inputClass}
          />
        </Field>
        <Field label="稼働状態">
          <select
            name="operatingStatus"
            defaultValue={d.operatingStatus ?? 'active'}
            className={inputClass}
          >
            <option value="active">稼働</option>
            <option value="paused">休止</option>
            <option value="broken">故障</option>
          </select>
        </Field>
        <Field label="表示順">
          <input
            name="sortOrder"
            inputMode="numeric"
            required
            defaultValue={d.sortOrder ?? 0}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <Field label="フロア・お部屋の位置（通知と予約詳細に表示）">
          <input
            name="locationText"
            maxLength={500}
            defaultValue={d.locationText ?? ''}
            className={inputClass}
            placeholder="2階・エレベーターを出て右手の2番目"
          />
        </Field>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" name="isNamedBooking" defaultChecked={d.isNamedBooking} />
          指名予約の対象
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" name="isVipCandidate" defaultChecked={d.isVipCandidate} />
          VIP候補
        </label>
      </div>
      <Field label="紹介文(予約画面に表示)">
        <textarea
          name="description"
          rows={2}
          maxLength={2000}
          defaultValue={d.description ?? ''}
          className={inputClass}
        />
      </Field>
      <Field
        label="写真（1行に1枚: 画像URL | 説明）"
        hint="最大10枚。表示順は入力順。アップロード機能は今後追加予定"
      >
        <textarea
          name="photos"
          rows={3}
          defaultValue={(d.photos ?? [])
            .map((p) => (p.alt ? `${p.url} | ${p.alt}` : p.url))
            .join('\n')}
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
    </div>
  )
}
