'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import { buttonClass, Field, inputClass, Notice, Stat } from '@/components/admin/ui'
import { FormError } from '@/components/FormParts'
import { previewSegmentAction, runCampaignAction } from '@/server/admin-member-coupon-actions'

type Counts = { total: number; line: number; email: number; none: number }

const SEGMENTS: [string, string][] = [
  ['all_active', '有効な会員すべて'],
  ['single_use', '初回利用のみのお客様（2回目未利用）'],
  ['no_use_days', '一定期間ご利用のないお客様（未利用の会員を含む）'],
  ['registered_between', '登録日が期間内のお客様'],
  ['store_users', '特定店舗のご利用者'],
]

/** A-15: choose segment and coupon, preview the count, then issue (with confirmation). */
export function CampaignForm({
  campaignKey,
  coupons,
  stores,
}: {
  campaignKey: string
  coupons: { versionId: number; label: string }[]
  stores: { id: number; label: string }[]
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [segment, setSegment] = useState('all_active')
  const [counts, setCounts] = useState<Counts | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, startPreview] = useTransition()
  const [state, action, pending] = useActionState(runCampaignAction, { error: null })

  const preview = () => {
    if (!formRef.current) return
    const data = new FormData(formRef.current)
    startPreview(async () => {
      const result = await previewSegmentAction(data)
      if (result.ok) {
        setCounts(result.data)
        setPreviewError(null)
      } else {
        setCounts(null)
        setPreviewError(result.error)
      }
    })
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-4 lg:grid-cols-2"
      onChange={() => setCounts(null)}
      onSubmit={(e) => {
        if (!counts) {
          e.preventDefault()
          setPreviewError('先に「対象件数を確認」を押してください')
          return
        }
        if (
          !window.confirm(
            `${counts.total}名にクーポンを一斉発行します。取り消しはできません。よろしいですか？`,
          )
        ) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="campaignKey" value={campaignKey} />
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="mb-3 font-bold">① セグメントを選ぶ</h2>
          <div className="space-y-2">
            {SEGMENTS.map(([value, label]) => (
              <label
                key={value}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${segment === value ? 'border-brand bg-brand-pale' : 'border-line'}`}
              >
                <input
                  type="radio"
                  name="segmentCode"
                  value={value}
                  checked={segment === value}
                  onChange={() => setSegment(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {segment === 'no_use_days' && (
              <Field label="ご利用のない日数">
                <input name="days" inputMode="numeric" defaultValue={90} className={inputClass} />
              </Field>
            )}
            {segment === 'registered_between' && (
              <>
                <Field label="登録日 から">
                  <input name="from" type="date" required className={inputClass} />
                </Field>
                <Field label="登録日 まで">
                  <input name="to" type="date" required className={inputClass} />
                </Field>
              </>
            )}
            {segment === 'store_users' && (
              <Field label="店舗">
                <select name="storeId" className={inputClass}>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <p className="mt-2 text-xs text-sub">
            対象は状態「有効」の会員のみ（要注意・利用停止・退会は除外）。利用＝確定・利用済の予約。
          </p>
        </section>
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="mb-3 font-bold">② クーポンを選ぶ</h2>
          <Field label="クーポン（有効なクーポンの最新版）">
            <select name="couponVersionId" required className={inputClass}>
              {coupons.map((c) => (
                <option key={c.versionId} value={c.versionId}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-3">
            <Field label="配布施策名（社内用）">
              <input
                name="name"
                required
                maxLength={200}
                placeholder="2026秋 休眠会員向け"
                className={inputClass}
              />
            </Field>
          </div>
        </section>
      </div>
      <div className="space-y-4">
        <section className="rounded-xl border border-brand bg-brand-pale p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">対象件数プレビュー</h2>
            <button
              type="button"
              onClick={preview}
              disabled={previewing}
              className={buttonClass.secondary}
            >
              {previewing ? '集計中…' : '対象件数を確認'}
            </button>
          </div>
          {counts ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={`${counts.total}名`} label="対象会員" />
              <Stat value={`${counts.line}名`} label="LINEで通知可" />
              <Stat value={`${counts.email}名`} label="メールで通知可" />
              <Stat value={`${counts.none}名`} label="通知手段なし" />
            </div>
          ) : (
            <p className="text-sm text-sub">条件を選んで「対象件数を確認」を押してください。</p>
          )}
          <FormError message={previewError} />
        </section>
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="mb-2 font-bold">③ 通知</h2>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="notify" defaultChecked />
            付与を通知する（LINE連携済みはLINE、未連携はメール。文面は A-21「クーポン付与」）
          </label>
          <p className="mt-2 rounded-lg bg-gold-pale p-2 text-xs">
            通知チャネルの送り分けルール・本登録誘導の扱いは要確認 Q-07
          </p>
        </section>
        <FormError message={state.error} />
        {state.message && !state.error && <Notice tone="green">{state.message}</Notice>}
        <button type="submit" disabled={pending || !counts} className={buttonClass.primary}>
          {pending ? '発行中…' : counts ? `${counts.total}名に一斉発行する` : '一斉発行する'}
        </button>
        <Notice tone="red">一斉発行は取り消せません。送信前に対象件数と文面をご確認ください</Notice>
      </div>
    </form>
  )
}
