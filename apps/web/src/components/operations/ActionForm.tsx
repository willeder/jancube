'use client'

import { type ReactNode, useActionState } from 'react'
import { FormError } from '@/components/FormParts'

type FormState = { error: string | null }

/**
 * A form posting to a server action that returns `{ error }` (and redirects on success).
 * Inputs are disabled while the action runs so a double tap cannot submit twice.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>
  children: ReactNode
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, { error: null })
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state.error && (
        <div className="mt-2 w-full">
          <FormError message={state.error} />
        </div>
      )}
    </form>
  )
}
