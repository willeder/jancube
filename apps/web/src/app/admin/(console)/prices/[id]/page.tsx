import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import { duration, hhmm, weekdayLabel, yen, ymd, ymdhm } from '@/components/admin/format'
import { PriceVersionFields } from '@/components/admin/master-fields'
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
import {
  assignPriceVersionAction,
  publishPriceVersionAction,
  updatePriceProfileAction,
} from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'

export const dynamic = 'force-dynamic'

/** A-16 料金パターンの編集: versions, publish, room assignments. */
export default async function PriceProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const staff = await requireStaff('prices.manage')
  const id = Number((await params).id)
  const { created } = await searchParams
  if (!Number.isInteger(id)) notFound()
  const { profile, assignments, rooms } = await withContainer((c) =>
    c.getPriceProfile(staff, id),
  ).catch((e) => {
    if (isDomainError(e, 'price_profile_not_found')) notFound()
    throw e
  })
  const latest = profile.versions[0]
  const published = profile.versions.filter((v) => v.status === 'published')
  const now = new Date()
  const stores = [...new Set(rooms.map((r) => r.storeCode))]

  return (
    <>
      <PageHeader
        title={`料金パターン — ${profile.name}`}
        description={
          <>
            コード <span className="font-mono">{profile.code}</span>
          </>
        }
        actions={
          <>
            <Link
              href={`/admin/prices/simulate?version=${latest?.id ?? ''}`}
              className={buttonClass.secondary}
            >
              この料金で試算
            </Link>
            <Link href="/admin/prices" className={buttonClass.secondary}>
              一覧へ戻る
            </Link>
          </>
        }
      />
      {created && (
        <div className="mb-4">
          <Notice tone="green">
            料金パターンを作成しました。下の「部屋への割当」から部屋に設定してください。
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="基本情報">
          <ActionForm action={updatePriceProfileAction} submitLabel="保存する">
            <input type="hidden" name="profileId" value={profile.id} />
            <Field label="パターン名">
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={profile.name}
                className={inputClass}
              />
            </Field>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={profile.isActive} />
              有効（無効にしても既存の割当は残ります）
            </label>
          </ActionForm>
        </Card>
        <Card title="版の履歴（新しい順）">
          <Table
            head={['版', '時間単価', 'パック', '最低', '税率', '適用開始', '公開']}
            rows={profile.versions.map((v) => [
              `第${v.versionNo}版`,
              yen(v.hourlyRate),
              v.packages.map((p) => `${duration(p.minutes)} ${yen(p.price)}`).join(' / ') || '—',
              duration(v.minimumMinutes),
              `${v.taxRatePercent}%`,
              ymdhm(v.validFrom),
              <Badge key="s" tone={v.status === 'published' ? 'green' : 'gray'}>
                {v.status === 'published' ? `公開 ${ymd(v.publishedAt)}` : v.status}
              </Badge>,
            ])}
          />
          {latest && latest.timeRules.length > 0 && (
            <p className="mt-2 text-xs text-sub">
              最新版の時間帯ルール:{' '}
              {latest.timeRules
                .map(
                  (r) =>
                    `${weekdayLabel(r.weekdayMask)}${r.startMinute !== null ? ` ${hhmm(r.startMinute)}-${hhmm(r.endMinute)}開始` : ''} -${yen(r.hourlyDiscount)}/時`,
                )
                .join(' / ')}
            </p>
          )}
        </Card>
      </div>

      <Card title="料金を変更（新しい版を公開）" className="mt-4">
        <p className="mb-3 text-xs text-sub">
          公開済みの版は変更しません（予約時の料金計算は当時の版を参照します）。新しい版は適用開始日から使われます。
        </p>
        <ActionForm
          action={publishPriceVersionAction}
          submitLabel="新しい版を公開する"
          confirm="新しい版を公開しますか？"
        >
          <input type="hidden" name="profileId" value={profile.id} />
          <PriceVersionFields defaults={{ ...(latest ?? {}), validFrom: now }} />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="moveRooms" defaultChecked />
            このパターンを使っている部屋を、適用開始日から新しい版に切り替える
          </label>
        </ActionForm>
      </Card>

      <Card title="部屋への割当（現在・予定）" className="mt-4">
        <Table
          head={['店舗', '部屋', '版', '適用開始', '適用終了']}
          rows={assignments.map((a) => [
            a.storeCode,
            a.roomCode,
            `第${a.versionNo}版`,
            ymdhm(a.validFrom),
            a.validTo ? ymdhm(a.validTo) : '—',
          ])}
          empty="このパターンを使っている部屋はありません"
        />
        {published.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="mb-2 font-bold">部屋に割り当てる（複数選択で一括設定・課題#35）</h3>
            <ActionForm
              // Remount when a version is published so the newest version is preselected.
              key={published[0]?.id}
              action={assignPriceVersionAction}
              submitLabel="割り当てる"
              confirm="選択した部屋の料金を切り替えますか？"
            >
              <input type="hidden" name="profileId" value={profile.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="版">
                  <select name="versionId" className={inputClass}>
                    {published.map((v) => (
                      <option key={v.id} value={v.id}>
                        第{v.versionNo}版（{yen(v.hourlyRate)}/時）
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="適用開始日"
                  hint="今日以前=即時。その日以降の別の割当は置き換わります"
                >
                  <input
                    name="validFrom"
                    type="date"
                    required
                    defaultValue={ymd(now)}
                    className={inputClass}
                  />
                </Field>
              </div>
              {stores.map((store) => (
                <fieldset key={store} className="rounded-lg border border-line p-3">
                  <legend className="px-1 text-sm font-bold">{store}</legend>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {rooms
                      .filter((r) => r.storeCode === store)
                      .map((r) => (
                        <label key={r.id} className="inline-flex items-center gap-1">
                          <input type="checkbox" name="roomIds" value={r.id} />
                          {r.code}（{r.roomTypeName}）
                        </label>
                      ))}
                  </div>
                </fieldset>
              ))}
            </ActionForm>
          </div>
        )}
      </Card>
    </>
  )
}
