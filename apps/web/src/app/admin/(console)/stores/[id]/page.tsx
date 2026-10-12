import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import { hhmm, WEEKDAYS } from '@/components/admin/format'
import { StoreFields } from '@/components/admin/master-fields'
import {
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
} from '@/components/admin/ui'
import {
  deleteCalendarDayAction,
  saveCalendarDayAction,
  setWeeklyHoursAction,
  updateStoreAction,
} from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'

export const dynamic = 'force-dynamic'

/** A-18 店舗の編集: settings, weekly hours, closures / special hours. */
export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const staff = await requireStaff('stores.manage')
  const id = Number((await params).id)
  const { created } = await searchParams
  if (!Number.isInteger(id)) notFound()
  const { store, calendar } = await withContainer((c) => c.getStoreMaster(staff, id)).catch((e) => {
    if (isDomainError(e, 'store_not_found', 'forbidden')) notFound()
    throw e
  })

  return (
    <>
      <PageHeader
        title={`店舗の編集 — ${store.code} ${store.name}`}
        actions={
          <>
            <Link href={`/admin/rooms?store=${store.id}`} className={buttonClass.secondary}>
              部屋マスタ
            </Link>
            <Link href="/admin/stores" className={buttonClass.secondary}>
              一覧へ戻る
            </Link>
          </>
        }
      />
      {created && (
        <div className="mb-4">
          <Notice tone="green">
            店舗を作成しました。営業時間・部屋・料金を設定してから公開してください。
          </Notice>
        </div>
      )}
      <Card title="基本情報・予約設定" className="max-w-5xl">
        <ActionForm action={updateStoreAction} submitLabel="保存する">
          <input type="hidden" name="storeId" value={store.id} />
          <StoreFields d={store} />
        </ActionForm>
      </Card>

      <div className="mt-4 grid max-w-5xl gap-4 lg:grid-cols-2">
        <Card title="通常営業時間">
          <ActionForm action={setWeeklyHoursAction} submitLabel="営業時間を保存">
            <input type="hidden" name="storeId" value={store.id} />
            <div className="space-y-2">
              {WEEKDAYS.map((label, weekday) => {
                const h = store.weekly.find((w) => w.weekday === weekday)
                return (
                  <div
                    key={label}
                    className="grid grid-cols-[2rem_1fr_1fr_auto] items-center gap-2 text-sm"
                  >
                    <span className="font-bold">{label}</span>
                    <input
                      name={`opens${weekday}`}
                      aria-label={`${label} 営業開始`}
                      defaultValue={h ? hhmm(h.opensMinute) : '10:00'}
                      className={inputClass}
                    />
                    <input
                      name={`closes${weekday}`}
                      aria-label={`${label} 営業終了`}
                      defaultValue={h ? hhmm(h.closesMinute) : '24:00'}
                      className={inputClass}
                    />
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        name={`closed${weekday}`}
                        defaultChecked={h?.isClosed}
                      />
                      定休
                    </label>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-sub">深夜営業は 26:00 のように入力します（最大 48:00）。</p>
          </ActionForm>
        </Card>

        <Card title="休業日・特別営業時間">
          <ActionForm action={saveCalendarDayAction} submitLabel="追加・更新">
            <input type="hidden" name="storeId" value={store.id} />
            <div className="grid grid-cols-3 gap-2">
              <Field label="日付">
                <input name="date" type="date" required className={inputClass} />
              </Field>
              <Field label="開始" hint="特別営業時">
                <input name="opens" placeholder="10:00" className={inputClass} />
              </Field>
              <Field label="終了">
                <input name="closes" placeholder="22:00" className={inputClass} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" name="isClosed" defaultChecked />
                休業日
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" name="isHoliday" />
                料金計算上の祝日
              </label>
            </div>
            <Field label="理由">
              <input name="reason" maxLength={500} className={inputClass} />
            </Field>
          </ActionForm>
          <div className="mt-4">
            <Table
              head={['日付', '内容', '理由', '']}
              rows={calendar.map((d) => [
                d.date,
                d.isClosed
                  ? '休業'
                  : d.opensMinute !== null
                    ? `${hhmm(d.opensMinute)}-${hhmm(d.closesMinute)}`
                    : '通常営業',
                `${d.isHoliday ? '[祝日] ' : ''}${d.reason ?? ''}`,
                <ActionForm
                  key="d"
                  action={deleteCalendarDayAction}
                  submitLabel="削除"
                  variant="secondary"
                  inline
                  confirm={`${d.date} の設定を削除しますか？`}
                >
                  <input type="hidden" name="storeId" value={store.id} />
                  <input type="hidden" name="date" value={d.date} />
                </ActionForm>,
              ])}
              empty="登録はありません（30日前以降を表示）"
            />
          </div>
        </Card>
      </div>
    </>
  )
}
