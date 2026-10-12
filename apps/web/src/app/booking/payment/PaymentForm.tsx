'use client'

import { type ReactNode, useActionState, useState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { yen } from '@/lib/format'
import { claimCouponAction, startCheckoutAction } from '@/server/payment-actions'

interface CouponView {
  grantId: number
  name: string
  note: string | null
  expiresAt: string
  /** null = not applicable to this booking */
  discount: number | null
}

export function PaymentForm({
  subtotal,
  coupons,
  initialGrantId,
  codeForm,
}: {
  subtotal: number
  coupons: CouponView[]
  initialGrantId: number | null
  codeForm: ReactNode
}) {
  const [state, action, pending] = useActionState(startCheckoutAction, { error: null })
  const [grantId, setGrantId] = useState<number | null>(initialGrantId)
  const [method, setMethod] = useState<'card' | 'paypay'>('card')
  const discount = coupons.find((c) => c.grantId === grantId)?.discount ?? 0
  const total = subtotal - discount

  return (
    <>
      <section className="space-y-2">
        {coupons.map((c) => {
          const selected = c.grantId === grantId
          const usable = c.discount !== null
          return (
            <label
              key={c.grantId}
              className={`block rounded-xl border-2 bg-white p-4 text-sm ${
                selected ? 'border-brand' : 'border-line'
              } ${usable ? '' : 'opacity-60'}`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-2 font-bold">
                  <input
                    type="radio"
                    name="coupon"
                    checked={selected}
                    disabled={!usable}
                    onChange={() => setGrantId(c.grantId)}
                    className="size-4 accent-brand"
                  />
                  {c.name}
                </span>
                {selected && (
                  <span className="shrink-0 rounded-full bg-brand-pale px-2 py-0.5 text-xs font-bold text-brand-dark">
                    適用中
                  </span>
                )}
              </span>
              <span className="mt-1 block text-xs text-sub">
                有効期限 {c.expiresAt}
                {c.note ? ` / ${c.note}` : ''}
                {usable ? '' : ' / このご予約には使えません'}
              </span>
            </label>
          )
        })}
        {coupons.length > 0 && (
          <label className="flex items-center gap-2 px-1 text-sm text-sub">
            <input
              type="radio"
              name="coupon"
              checked={grantId === null}
              onChange={() => setGrantId(null)}
              className="size-4 accent-brand"
            />
            クーポンを使わない
          </label>
        )}
      </section>

      {codeForm}

      <section className="rounded-xl border border-line bg-white p-4 text-sm">
        <dl className="space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-sub">小計</dt>
            <dd>{yen(subtotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-2 font-bold">
            <dt>合計（税込）</dt>
            <dd className="text-xl text-brand-dark">{yen(total)}</dd>
          </div>
          {discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-sub">クーポン割引</dt>
              <dd className="text-alert">−{yen(discount)}</dd>
            </div>
          )}
        </dl>
      </section>

      <form action={action} className="space-y-3">
        <input type="hidden" name="grantId" value={grantId ?? ''} />
        <input type="hidden" name="method" value={method} />
        {total > 0 && (
          <fieldset>
            <legend className="mb-2 font-bold">お支払い方法</legend>
            <div className="flex gap-2">
              <MethodButton active={method === 'card'} onClick={() => setMethod('card')}>
                💳 クレジットカード
              </MethodButton>
              <MethodButton active={method === 'paypay'} onClick={() => setMethod('paypay')}>
                📱 PayPay
              </MethodButton>
            </div>
          </fieldset>
        )}
        <FormError message={state.error} />
        <SubmitButton pending={pending}>
          {total > 0 ? `${yen(total)}を支払う` : '予約を確定する'}
        </SubmitButton>
        {total > 0 && (
          <p className="text-xs text-sub">決済は外部決済ページ（Stripe）に移動して行います</p>
        )}
      </form>
    </>
  )
}

function MethodButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-xl border px-4 py-2 text-sm font-bold ${
        active ? 'border-brand bg-brand text-white' : 'border-line bg-white'
      }`}
    >
      {children}
    </button>
  )
}

export function CouponCodeForm() {
  const [state, action, pending] = useActionState(claimCouponAction, { error: null })
  return (
    <form action={action} className="rounded-xl border border-line bg-white p-4 text-sm">
      <label className="font-bold" htmlFor="coupon-code">
        クーポンコードをお持ちの方
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="coupon-code"
          name="code"
          placeholder="例: JCUBE2026"
          autoCapitalize="characters"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2.5 text-base uppercase"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-brand px-4 font-bold text-brand disabled:opacity-60"
        >
          適用
        </button>
      </div>
      {state.error && <p className="mt-2 text-alert">{state.error}</p>}
    </form>
  )
}
