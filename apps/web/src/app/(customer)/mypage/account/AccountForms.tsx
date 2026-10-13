'use client'

import { useActionState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { buttonDanger } from '@/components/MyPageParts'
import { updateEmailAction, withdrawAction } from '@/server/mypage-actions'

/** C-17 メールアドレス（任意）「保存する」 */
export function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updateEmailAction, { error: null })
  return (
    <form action={action} className="mt-4 space-y-3">
      <label className="block">
        <span className="font-bold">メールアドレス（任意）</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={email}
          maxLength={254}
          placeholder="taro@example.com"
          className="mt-1.5 block w-full rounded-lg border border-line px-3 py-2.5 text-base"
        />
        <span className="mt-1 block text-xs text-sub">空欄で保存すると登録を削除します</span>
      </label>
      <FormError message={state.error} />
      <SubmitButton pending={pending}>保存する</SubmitButton>
    </form>
  )
}

/** C-17 退会 (F-AUTH-07) with an explicit confirmation. */
export function WithdrawForm() {
  const [state, action, pending] = useActionState(withdrawAction, { error: null })
  return (
    <form action={action} className="mt-3 space-y-3">
      <label className="flex items-center gap-2.5 text-sm">
        <input name="confirm" type="checkbox" required className="size-5 accent-alert" />
        上記を確認し、退会します
      </label>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={buttonDanger}>
        {pending ? '手続き中…' : '退会する'}
      </button>
    </form>
  )
}
