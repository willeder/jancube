'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { FormError, SubmitButton } from '@/components/FormParts'
import type { AuthFlow } from '@/lib/auth-flow'
import { resendCodeAction, verifyCodeAction } from '@/server/auth-actions'

const DIGITS = 6

export function VerifyForm({
  resendAfter,
  flow = 'booking',
  next,
}: {
  resendAfter: string
  flow?: AuthFlow
  next?: string
}) {
  const [state, action, pending] = useActionState(verifyCodeAction, { error: null })
  const [resendState, resend, resending] = useActionState(resendCodeAction, { error: null })
  const [code, setCode] = useState('')
  const wait = useSecondsUntil(resendAfter)
  const formId = useId()

  return (
    <div className="space-y-3">
      <div className="auth-card rounded-xl border border-line bg-white p-4">
        <form id={formId} action={action}>
          <input type="hidden" name="flow" value={flow} />
          {next && <input type="hidden" name="next" value={next} />}

          {/* One real input (SMS autofill, paste, screen readers); the boxes only display it. */}
          <label className="group relative mx-auto block w-full max-w-[318px]">
            <span className="sr-only">6桁の認証コード</span>
            <input
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, DIGITS))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={DIGITS}
              required
              // biome-ignore lint/a11y/noAutofocus: the code is the only thing to do on this screen
              autoFocus
              className="absolute inset-0 h-full w-full opacity-0"
            />
            <span aria-hidden className="grid grid-cols-6 gap-2">
              {Array.from({ length: DIGITS }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length display
                  key={i}
                  className={`flex h-14 min-w-0 items-center justify-center rounded-lg border-2 text-2xl font-bold tabular-nums ${
                    i < code.length
                      ? 'border-brand'
                      : i === code.length
                        ? 'border-line group-focus-within:border-brand'
                        : 'border-line'
                  }`}
                >
                  {code[i] ? '●' : ''}
                </span>
              ))}
            </span>
          </label>
        </form>

        <form action={resend} className="mt-1.5 text-center">
          <input type="hidden" name="flow" value={flow} />
          {next && <input type="hidden" name="next" value={next} />}
          <button
            type="submit"
            disabled={wait > 0 || resending}
            className="text-sm font-bold text-brand-dark underline disabled:text-sub disabled:no-underline"
          >
            {wait > 0 ? `コードを再送する（残り${mmss(wait)}）` : 'コードを再送する'}
          </button>
          <FormError message={resendState.error} />
        </form>
      </div>
      <FormError message={state.error} />
      <SubmitButton form={formId} pending={pending || code.length < DIGITS}>
        認証する
      </SubmitButton>
    </div>
  )
}

function useSecondsUntil(iso: string): number {
  const [seconds, setSeconds] = useState(() => secondsUntil(iso))
  useEffect(() => {
    setSeconds(secondsUntil(iso))
    const timer = setInterval(() => setSeconds(secondsUntil(iso)), 1000)
    return () => clearInterval(timer)
  }, [iso])
  return seconds
}

const secondsUntil = (iso: string) =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000))

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
