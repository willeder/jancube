import { can, visibleStoreIds } from '@jancube/domain'
import { Field, inputClass, Notice } from '@/components/admin/ui'
import { ActionForm } from '@/components/operations/ActionForm'
import { currentStaff } from '@/server/admin-session'
import { cleaningSelection } from '@/server/cleaning-session'
import { withContainer } from '@/server/container'
import {
  cleaningLoginAction,
  cleaningLogoutAction,
  selectCleaningWorkerAction,
} from '@/server/operations-actions'

export const dynamic = 'force-dynamic'

const bigButton = 'w-full rounded-xl bg-brand py-3 font-bold text-white disabled:opacity-60'

/** K-01 清掃ログイン・担当選択 */
export default async function CleaningLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const staff = await currentStaff()
  const signedIn = staff && can(staff.access, 'cleaning.work') ? staff : null
  const { store } = await searchParams

  let stores: { id: number; code: string; name: string }[] = []
  let workers: { id: number; name: string }[] = []
  let current: Awaited<ReturnType<typeof cleaningSelection>> = null
  let storeId = 0
  if (signedIn) {
    const visible = visibleStoreIds(signedIn.access, 'cleaning.work')
    current = await cleaningSelection(signedIn)
    stores = (await withContainer((c) => c.listAdminStores())).filter(
      (s) => visible === null || visible.includes(s.id),
    )
    storeId = Number(store) || current?.storeId || stores[0]?.id || 0
    if (storeId && can(signedIn.access, 'cleaning.work', storeId)) {
      workers = await withContainer((c) => c.cleaningAssignees(signedIn, storeId))
    }
  }

  return (
    <>
      <h1 className="text-lg font-bold">{signedIn ? '担当の選択' : 'ログイン'}</h1>
      <p className="text-sm text-sub">清掃担当の方専用の画面です。管理機能は表示されません</p>
      {!signedIn ? (
        <ActionForm
          action={cleaningLoginAction}
          className="space-y-3 rounded-xl border border-line bg-white p-4"
        >
          <Field label="ID(メールアドレス)">
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
            />
          </Field>
          <Field label="パスワード">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input name="remember" type="checkbox" defaultChecked className="size-5 accent-brand" />
            この端末を記憶する
          </label>
          <button type="submit" className={bigButton}>
            ログイン
          </button>
        </ActionForm>
      ) : (
        <>
          <form action={cleaningLogoutAction} className="flex items-center justify-between text-sm">
            <span>
              ログイン中: <span className="font-bold">{signedIn.name}</span>
            </span>
            <button type="submit" className="font-bold text-brand-dark">
              ログアウト
            </button>
          </form>
          {stores.length > 1 && (
            <form method="get" className="flex gap-2 rounded-xl border border-line bg-white p-4">
              <select
                name="store"
                defaultValue={storeId}
                className={inputClass}
                aria-label="担当店舗"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="shrink-0 rounded-lg border border-brand px-3 text-sm font-bold text-brand"
              >
                切替
              </button>
            </form>
          )}
          <ActionForm
            action={selectCleaningWorkerAction}
            className="space-y-3 rounded-xl border border-line bg-white p-4"
          >
            <input type="hidden" name="storeId" value={storeId} />
            <Field label="担当店舗">
              <input
                readOnly
                value={stores.find((s) => s.id === storeId)?.name ?? '—'}
                className={`${inputClass} bg-paper`}
              />
            </Field>
            <Field label="担当者(ログ記録用)">
              <select
                name="workerId"
                defaultValue={current?.storeId === storeId ? current.workerId : signedIn.staffId}
                className={inputClass}
              >
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className={bigButton} disabled={workers.length === 0}>
              本日の清掃タスクへ
            </button>
          </ActionForm>
        </>
      )}
      <Notice>
        清掃ロールは清掃完了入力のみ可能です(F-CLN-03)。予約情報・お客様情報は表示しません
      </Notice>
    </>
  )
}
