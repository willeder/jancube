'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect } from 'react'
import { FormError } from '@/components/FormParts'
import { unlinkLineAction } from '@/server/line-actions'

/** C-17 LINE連携の解除 (F-AUTH-06). Notifications fall back to email afterwards. */
export function UnlinkLineButton() {
  const router = useRouter()
  const [state, action, pending] = useActionState(unlinkLineAction, {
    error: null,
    unlinked: false,
  })
  useEffect(() => {
    if (state.unlinked) router.refresh()
  }, [state.unlinked, router])
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('LINE連携を解除しますか？お知らせはメールでお届けします')) {
          e.preventDefault()
        }
      }}
      className="mt-2"
    >
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="text-xs font-bold text-sub underline">
        LINE連携を解除する
      </button>
    </form>
  )
}
