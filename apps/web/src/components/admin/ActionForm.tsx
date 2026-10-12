'use client'

import { type ReactNode, useActionState } from 'react'
import { FormError } from '@/components/FormParts'
import { buttonClass, Notice } from './ui'

export type AdminFormState = { error: string | null; message?: string | null }
type Action = (prev: AdminFormState, form: FormData) => Promise<AdminFormState>

/**
 * Admin form bound to a server action: shows the error or success message and disables the
 * submit button while pending. `confirm` asks before submitting irreversible operations.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className = 'space-y-3',
  variant = 'primary',
  confirm,
  inline = false,
}: {
  action: Action
  submitLabel: string
  children?: ReactNode
  className?: string
  variant?: keyof typeof buttonClass
  confirm?: string
  inline?: boolean
}) {
  const [state, formAction, pending] = useActionState(action, { error: null })
  return (
    <form
      action={formAction}
      className={inline ? 'inline-flex flex-wrap items-center gap-2' : className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      {children}
      {!inline && <FormError message={state.error} />}
      {!inline && state.message && !state.error && <Notice tone="green">{state.message}</Notice>}
      <div>
        <button type="submit" disabled={pending} className={buttonClass[variant]}>
          {pending ? '処理中…' : submitLabel}
        </button>
      </div>
      {inline && state.error && <span className="text-xs text-alert">{state.error}</span>}
    </form>
  )
}
