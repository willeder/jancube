'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { buttonClass, Field, inputClass, Notice } from '@/components/admin/ui'
import { yen } from '@/lib/format'
import { type CancelState, staffCancelAction } from '@/server/admin-booking-actions'

/** A-08: refund preview with optional fee override, then the result (including refund failures). */
export function CancelForm({
  bookingCode,
  paid,
  automaticRate,
  automaticFee,
  backHref,
}: {
  bookingCode: string
  paid: number
  automaticRate: number
  automaticFee: number
  backHref: string
}) {
  const [state, action, pending] = useActionState<CancelState, FormData>(staffCancelAction, {
    error: null,
  })
  const [override, setOverride] = useState(false)
  const [rate, setRate] = useState(String(automaticRate))
  const rateValue = Number(rate)
  const valid = rate.trim() !== '' && rateValue >= 0 && rateValue <= 100
  // Same rounding as the server (yen floored).
  const fee = override ? (valid ? Math.floor((paid * rateValue) / 100) : 0) : automaticFee
  const refund = paid - fee

  if (state.result) {
    return (
      <section className="space-y-3">
        <Notice tone="green">
          キャンセルしました。キャンセル料 {yen(state.result.fee)}（{state.result.feeRate}%）/ 返金{' '}
          {yen(state.result.refund)}
        </Notice>
        {state.result.refundFailed && (
          <Notice tone="red">
            返金処理に失敗しました。決済・返金履歴(A-26)から再実行してください
          </Notice>
        )}
        <p className="text-xs text-sub">
          鍵の失効・清掃予定の更新・お客様への通知は自動処理（ジョブ）で行われます
        </p>
        <div className="flex gap-2">
          <Link href={backHref} className={buttonClass.secondary}>
            予約詳細へ
          </Link>
          {state.result.refundFailed && (
            <Link href="/admin/payments?kind=refund&status=failed" className={buttonClass.primary}>
              決済・返金履歴へ
            </Link>
          )}
        </div>
      </section>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="bookingCode" value={bookingCode} />
      <section className="rounded-xl border-2 border-brand bg-brand-pale p-4 text-sm">
        <h2 className="mb-2 font-bold text-brand-dark">返金プレビュー</h2>
        <dl className="space-y-1">
          <div className="flex justify-between">
            <dt>お支払い額</dt>
            <dd>{yen(paid)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>キャンセル料({override ? rate || '—' : automaticRate}%)</dt>
            <dd>-{yen(fee)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-brand/30 pt-2 font-bold">
            <dt>返金額</dt>
            <dd className="text-xl text-brand-dark">{yen(refund)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-sub">決済事業者へ返金を依頼します（反映まで数日）</p>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-white p-4">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            name="override"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="size-4 accent-brand"
          />
          料率を手動で上書きする
        </label>
        {override && (
          <Field label="料率(%)">
            <input
              name="feeRate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
        <Field label={override ? '理由（必須・監査ログに記録）' : '理由（任意）'}>
          <input
            name="reason"
            required={override}
            maxLength={1000}
            className={inputClass}
            placeholder="例: 設備不具合による当店都合のキャンセル"
          />
        </Field>
      </section>

      <Notice tone="red">
        この操作は取り消せません。予約枠は即時に解放され、鍵の無効化・お客様への通知は自動処理で行われます
      </Notice>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || (override && !valid)}
          className={buttonClass.danger}
        >
          {pending ? '処理しています…' : 'キャンセルと返金を実行'}
        </button>
        <Link href={backHref} className={buttonClass.secondary}>
          戻る
        </Link>
      </div>
    </form>
  )
}
