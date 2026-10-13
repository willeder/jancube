'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { buttonClass, Field, inputClass, Notice } from '@/components/admin/ui'
import { FormError } from '@/components/FormParts'
import { requestPasswordResetAction, setPasswordAction } from '@/server/admin-auth-actions'

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, { error: null })
  if (state.sent) {
    return (
      <Notice tone="green">
        ご登録がある場合、再設定用のメールを送信しました。メールのリンクから手続きしてください。
      </Notice>
    )
  }
  return (
    <form action={action} className="space-y-3">
      <Field label="メールアドレス">
        <input name="email" type="email" required className={inputClass} />
      </Field>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        再設定メールを送る
      </button>
      <p className="text-center text-sm">
        <Link href="/admin/login" className="font-bold text-brand-dark">
          ログインへ戻る
        </Link>
      </p>
    </form>
  )
}

export function SetPasswordForm({ token, purpose }: { token: string; purpose: string }) {
  const [state, action, pending] = useActionState(setPasswordAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="purpose" value={purpose} />
      <Field label="新しいパスワード" hint="英字と数字を含む12文字以上">
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className={inputClass}
        />
      </Field>
      <Field label="新しいパスワード（確認）">
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
        />
      </Field>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        パスワードを設定する
      </button>
    </form>
  )
}
