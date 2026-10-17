'use client'

import { useActionState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { buttonDanger } from '@/components/MyPageParts'
import {
  updateEmailAction,
  updateNotificationChannelAction,
  withdrawAction,
} from '@/server/mypage-actions'

/** C-17 メールアドレス（任意）「保存する」 */
export function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updateEmailAction, { error: null })
  return (
    <form action={action} className="mt-4 space-y-3">
      <label className="block">
        <span className="font-bold">メールアドレス（必須）</span>
        <input
          name="email"
          required
          type="email"
          autoComplete="email"
          defaultValue={email}
          maxLength={254}
          placeholder="taro@example.com"
          className="mt-1.5 block w-full rounded-lg border border-line px-3 py-2.5 text-base"
        />
        <span className="mt-1 block text-xs text-sub">ご予約のお知らせに使用します</span>
      </label>
      <FormError message={state.error} />
      <SubmitButton pending={pending}>保存する</SubmitButton>
    </form>
  )
}

/** Explicit preference remains visible when LINE is temporarily unreachable. */
export function NotificationChannelForm({
  channel,
  linked,
}: {
  channel: 'email' | 'line'
  linked: boolean
}) {
  const [state, action, pending] = useActionState(updateNotificationChannelAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <label className="block font-bold">
        お知らせの受取方法
        <select
          name="channel"
          defaultValue={channel}
          className="mt-2 block w-full rounded-lg border border-line p-3"
        >
          <option value="email">メール</option>
          <option value="line" disabled={!linked}>
            LINE{linked ? '' : '（連携が必要です）'}
          </option>
        </select>
      </label>
      <p className="text-xs text-sub">
        LINEを選択してブロックした場合、メールへの自動切替は行いません。
      </p>
      <FormError message={state.error} />
      <SubmitButton pending={pending}>受取方法を保存する</SubmitButton>
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
