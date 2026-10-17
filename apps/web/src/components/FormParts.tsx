import type { ReactNode } from 'react'

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg bg-alert-pale p-3 text-sm text-alert">
      {message}
    </p>
  )
}

export function SubmitButton({
  pending,
  children,
  form,
}: {
  pending: boolean
  children: ReactNode
  form?: string
}) {
  return (
    <button
      type="submit"
      form={form}
      disabled={pending}
      className="w-full rounded-xl bg-brand py-3 font-bold text-white disabled:opacity-60"
    >
      {children}
    </button>
  )
}
