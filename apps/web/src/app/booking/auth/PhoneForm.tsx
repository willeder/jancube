'use client'

import { useActionState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { sendCodeAction } from '@/server/auth-actions'

export function PhoneForm() {
  const [state, action, pending] = useActionState(sendCodeAction, { error: null })
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
          className="mt-2 block w-full rounded-lg border border-line px-3 py-2.5 text-base"
        />
        <span className="mt-2 block text-xs text-sub">※ SMSが届く番号をご入力ください</span>
      </label>
      <FormError message={state.error} />
      <SubmitButton pending={pending}>認証コードを送信</SubmitButton>
      <p className="text-xs text-sub">
        送信により利用規約・プライバシーポリシーに同意したものとみなします
      </p>
    </form>
  )
}
