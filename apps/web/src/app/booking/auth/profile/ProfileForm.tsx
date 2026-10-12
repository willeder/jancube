'use client'

import { useActionState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { registerAction } from '@/server/auth-actions'

const field = 'mt-1.5 block w-full rounded-lg border border-line px-3 py-2.5 text-base'

export function ProfileForm() {
  const [state, action, pending] = useActionState(registerAction, { error: null })
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
        <p className="text-xs text-sub">※ 本人確認の必須要件ではありません</p>
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
      <SubmitButton pending={pending}>登録して支払いへ進む</SubmitButton>
    </form>
  )
}
