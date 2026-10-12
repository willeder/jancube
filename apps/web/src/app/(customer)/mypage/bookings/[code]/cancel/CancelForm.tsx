'use client'

import { useActionState } from 'react'
import { FormError } from '@/components/FormParts'
import { buttonDanger } from '@/components/MyPageParts'
import { cancelBookingAction } from '@/server/mypage-actions'

/** C-15 キャンセル理由（任意）+ 「キャンセルを確定する」 */
export function CancelForm({ bookingCode }: { bookingCode: string }) {
  const [state, action, pending] = useActionState(cancelBookingAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="bookingCode" value={bookingCode} />
      <label className="block rounded-xl border border-line bg-white p-4 text-sm">
        <span className="font-bold">キャンセル理由（任意）</span>
        <textarea
          name="reason"
          rows={2}
          maxLength={1000}
          placeholder="ご都合が悪くなった 等"
          className="mt-2 block w-full rounded-lg border border-line px-3 py-2 text-base"
        />
      </label>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={buttonDanger}>
        {pending ? 'キャンセルしています…' : 'キャンセルを確定する'}
      </button>
    </form>
  )
}
