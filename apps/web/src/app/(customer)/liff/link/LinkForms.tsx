'use client'

import { useActionState, useEffect, useState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import {
  liffRegisterAction,
  liffResendCodeAction,
  liffSendCodeAction,
  liffVerifyCodeAction,
  linkSignedInMemberAction,
} from '@/server/line-actions'

const field = 'mt-1.5 block w-full rounded-lg border border-line px-3 py-2.5 text-base'

/** L-03 step 1 (same input as C-05). */
export function LinkPhoneForm() {
  const [state, action, pending] = useActionState(liffSendCodeAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <label className="block rounded-xl border border-line bg-white p-4 text-sm">
        <span className="font-bold">携帯電話番号</span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="090-1234-5678"
          required
          className={field}
        />
        <span className="mt-2 block text-xs text-sub">
          ※ SMSが届く番号をご入力ください。ご登録済みの方はその会員情報と連携します
        </span>
      </label>
      <FormError message={state.error} />
      <SubmitButton pending={pending}>認証コードを送信</SubmitButton>
    </form>
  )
}

/** L-03 / C-17: link the member who is already signed in. */
export function LinkSignedInForm() {
  const [state, action, pending] = useActionState(linkSignedInMemberAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <FormError message={state.error} />
      <SubmitButton pending={pending}>この会員情報とLINEを連携する</SubmitButton>
    </form>
  )
}

/** L-03 step 2 (same rules as C-06). */
export function LinkVerifyForm({ resendAfter }: { resendAfter: string }) {
  const [state, action, pending] = useActionState(liffVerifyCodeAction, { error: null })
  const [resendState, resend, resending] = useActionState(liffResendCodeAction, { error: null })
  const wait = useSecondsUntil(resendAfter)
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <label className="block rounded-xl border border-line bg-white p-4 text-sm">
          <span className="font-bold">6桁の認証コード</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            // biome-ignore lint/a11y/noAutofocus: the code is the only thing to do on this screen
            autoFocus
            className={`${field} text-center text-2xl tracking-[0.5em] tabular-nums`}
          />
        </label>
        <FormError message={state.error} />
        <SubmitButton pending={pending}>認証してLINEと連携する</SubmitButton>
      </form>
      <form action={resend} className="text-center">
        <button
          type="submit"
          disabled={wait > 0 || resending}
          className="text-sm font-bold text-brand-dark underline disabled:text-sub disabled:no-underline"
        >
          {wait > 0 ? `コードを再送する（残り${wait}秒）` : 'コードを再送する'}
        </button>
        <FormError message={resendState.error} />
      </form>
    </div>
  )
}

/** L-03 step 3 for new customers (same fields as C-07). */
export function LinkProfileForm() {
  const [state, action, pending] = useActionState(liffRegisterAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-3 rounded-xl border border-line bg-white p-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-bold">姓</span>
            <input
              name="familyName"
              autoComplete="family-name"
              placeholder="山田"
              maxLength={100}
              required
              className={field}
            />
          </label>
          <label className="block">
            <span className="font-bold">名</span>
            <input
              name="givenName"
              autoComplete="given-name"
              placeholder="太郎"
              maxLength={100}
              required
              className={field}
            />
          </label>
        </div>
        <label className="block">
          <span className="font-bold">メールアドレス（任意）</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="taro@example.com"
            maxLength={254}
            className={field}
          />
        </label>
      </div>
      <div className="space-y-2.5 rounded-xl border border-line bg-white p-4 text-sm">
        <label className="flex items-center gap-2.5">
          <input name="agreesToTerms" type="checkbox" required className="size-5 accent-brand" />
          利用規約・プライバシーポリシーに同意する
        </label>
        <label className="flex items-center gap-2.5">
          <input name="confirmsAdult" type="checkbox" required className="size-5 accent-brand" />
          18歳以上であることを確認しました
        </label>
      </div>
      <FormError message={state.error} />
      <SubmitButton pending={pending}>登録してLINEと連携する</SubmitButton>
    </form>
  )
}

function useSecondsUntil(iso: string): number {
  const [seconds, setSeconds] = useState(() => secondsUntil(iso))
  useEffect(() => {
    setSeconds(secondsUntil(iso))
    const timer = setInterval(() => setSeconds(secondsUntil(iso)), 1000)
    return () => clearInterval(timer)
  }, [iso])
  return seconds
}

const secondsUntil = (iso: string) =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000))
