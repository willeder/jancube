'use client'

import { useActionState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import type { AuthFlow } from '@/lib/auth-flow'
import { registerAction } from '@/server/auth-actions'

const field = 'mt-1.5 block w-full rounded-lg border border-line px-3 py-2.5 text-base'

/** C-07 会員登録 (booking flow and C-22). */
export function ProfileForm({ flow = 'booking', next }: { flow?: AuthFlow; next?: string }) {
  const [state, action, pending] = useActionState(registerAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="flow" value={flow} />
      {next && <input type="hidden" name="next" value={next} />}
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
          <span className="font-bold">メールアドレス（必須）</span>
          <input
            name="email"
            required
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
          <span>
            <a href="/legal/terms" target="_blank" className="underline" rel="noopener">
              利用規約
            </a>
            ・
            <a href="/legal/privacy" target="_blank" className="underline" rel="noopener">
              プライバシーポリシー
            </a>
            に同意する
          </span>
        </label>
        <label className="flex items-center gap-2.5">
          <input name="confirmsAdult" type="checkbox" required className="size-5 accent-brand" />
          18歳以上であることを確認しました
        </label>
      </div>

      <FormError message={state.error} />
      <SubmitButton pending={pending}>
        {flow === 'booking' ? '登録して支払いへ進む' : '登録する'}
      </SubmitButton>
    </form>
  )
}
