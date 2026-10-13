'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { buttonClass, Field, inputClass } from '@/components/admin/ui'
import { FormError } from '@/components/FormParts'
import { staffLoginAction } from '@/server/admin-auth-actions'

export function LoginForm() {
  const [state, action, pending] = useActionState(staffLoginAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <Field label="ID（メールアドレス）">
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
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
        <input name="remember" type="checkbox" className="size-4 accent-brand" />
        このブラウザを記憶する
      </label>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full py-2.5`}>
        ログイン
      </button>
      <p className="text-center text-sm">
        <Link href="/admin/password" className="font-bold text-brand-dark">
          パスワードをお忘れの方
        </Link>
      </p>
    </form>
  )
}
