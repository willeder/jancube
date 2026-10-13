'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import type { AdminFormState } from '@/components/admin/ActionForm'
import { buttonClass, Field, inputClass, Notice } from '@/components/admin/ui'
import { FormError } from '@/components/FormParts'
import { previewTemplateAction } from '@/server/admin-master-actions'

type Variable = { name: string; label: string }

/**
 * A-21 本文の編集: variable chips insert `{{name}}`, preview renders with sample values, and the
 * server checks the variables again when publishing.
 */
export function TemplateEditor({
  action,
  submitLabel,
  event,
  channel,
  variables,
  defaults,
  children,
}: {
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>
  submitLabel: string
  /** Fixed for an existing template; null = chosen in the form (fields named event/channel). */
  event: string | null
  channel: string | null
  variables: Variable[]
  defaults: { subject: string | null; body: string; entryGuideUrl: string | null }
  children?: React.ReactNode
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [state, formAction, pending] = useActionState(action, { error: null })
  const [preview, setPreview] = useState<{ subject: string | null; body: string } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, startPreview] = useTransition()

  const insert = (name: string) => {
    const el = bodyRef.current
    if (!el) return
    const token = `{{${name}}}`
    const start = el.selectionStart ?? el.value.length
    el.value = el.value.slice(0, start) + token + el.value.slice(el.selectionEnd ?? start)
    el.focus()
    el.selectionStart = el.selectionEnd = start + token.length
  }

  const runPreview = () => {
    const form = formRef.current
    if (!form) return
    const data = new FormData(form)
    startPreview(async () => {
      const result = await previewTemplateAction({
        event: event ?? String(data.get('event') ?? ''),
        channel: channel ?? String(data.get('channel') ?? ''),
        subject: (data.get('subject') as string | null) || null,
        body: String(data.get('body') ?? ''),
      })
      if (result.ok) {
        setPreview({ subject: result.subject, body: result.body })
        setPreviewError(null)
      } else {
        setPreview(null)
        setPreviewError(result.error)
      }
    })
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {children}
      {channel === null || channel === 'email' ? (
        <Field label="件名（メールのみ）">
          <input
            name="subject"
            maxLength={250}
            defaultValue={defaults.subject ?? ''}
            className={inputClass}
          />
        </Field>
      ) : null}
      <Field label="本文">
        <textarea
          ref={bodyRef}
          name="body"
          required
          rows={10}
          defaultValue={defaults.body}
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
      <div>
        <div className="mb-1 text-sm font-bold">差し込み変数（クリックで挿入）</div>
        <div className="flex flex-wrap gap-1">
          {variables.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={() => insert(v.name)}
              className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs"
              title={v.label}
            >
              {`{{${v.name}}}`} <span className="text-sub">{v.label}</span>
            </button>
          ))}
        </div>
      </div>
      <Field label="入室案内画像URL（任意）">
        <input
          name="entryGuideUrl"
          type="url"
          defaultValue={defaults.entryGuideUrl ?? ''}
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={previewing}
          className={buttonClass.secondary}
        >
          {previewing ? '確認中…' : 'プレビュー（サンプル値）'}
        </button>
        <button
          type="submit"
          disabled={pending}
          className={buttonClass.primary}
          onClick={(e) => {
            if (!window.confirm('この文面を公開しますか？公開後の通知はこの文面で送信されます'))
              e.preventDefault()
          }}
        >
          {pending ? '公開中…' : submitLabel}
        </button>
      </div>
      <FormError message={previewError ?? state.error} />
      {state.message && !state.error && <Notice tone="green">{state.message}</Notice>}
      {preview && (
        <div className="rounded-lg border border-line bg-paper p-3 text-sm">
          {preview.subject && <div className="mb-2 font-bold">件名: {preview.subject}</div>}
          <pre className="whitespace-pre-wrap font-sans">{preview.body}</pre>
        </div>
      )}
    </form>
  )
}
