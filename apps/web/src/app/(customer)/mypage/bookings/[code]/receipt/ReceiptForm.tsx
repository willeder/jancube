'use client'

import { useActionState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { buttonOutline } from '@/components/MyPageParts'
import { issueReceiptAction } from '@/server/mypage-actions'

/** C-19 宛名 + 「発行する」/「再発行する」 */
export function ReceiptForm({
  bookingCode,
  defaultName,
  reissue,
}: {
  bookingCode: string
  defaultName: string
  reissue: boolean
}) {
  const [state, action, pending] = useActionState(issueReceiptAction, { error: null })
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="bookingCode" value={bookingCode} />
      <label className="block">
        <span className="font-bold">宛名</span>
        <span className="mt-1.5 flex items-center gap-2">
          <input
            name="recipientName"
            defaultValue={defaultName}
            maxLength={100}
            required
            className="block w-full rounded-lg border border-line px-3 py-2.5 text-base"
          />
          <span className="shrink-0">様</span>
        </span>
      </label>
      <FormError message={state.error} />
      <SubmitButton pending={pending}>{reissue ? '再発行する' : '発行する'}</SubmitButton>
    </form>
  )
}

/** Prints the receipt (the browser can save it as PDF). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${buttonOutline} print:hidden`}
    >
      印刷・PDFで保存
    </button>
  )
}
