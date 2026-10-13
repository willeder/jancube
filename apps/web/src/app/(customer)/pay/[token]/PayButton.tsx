'use client'

import { useActionState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import { openPaymentLinkAction } from '@/server/payment-link-actions'

/** C-18 「お支払いに進む」 */
export function PayButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState(openPaymentLinkAction, { error: null })
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormError message={state.error} />
      <SubmitButton pending={pending}>
        {pending ? 'お待ちください…' : 'お支払いに進む'}
      </SubmitButton>
    </form>
  )
}
