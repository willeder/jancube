import { NOTIFICATION_EVENT_LABELS, TEMPLATE_VARIABLE_LABELS } from '@jancube/application'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import { CHANNEL_LABELS, ymdhm } from '@/components/admin/format'
import {
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
} from '@/components/admin/ui'
import {
  publishTemplateVersionAction,
  updateTemplateSettingsAction,
} from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'
import { TemplateEditor } from '../TemplateEditor'

export const dynamic = 'force-dynamic'

/** A-21 テンプレート編集: settings, new version with preview, version history. */
export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const staff = await requireStaff('notifications.manage')
  const id = Number((await params).id)
  const { created } = await searchParams
  if (!Number.isInteger(id)) notFound()
  const { template, variables } = await withContainer((c) => c.getTemplate(staff, id)).catch(
    (e) => {
      if (isDomainError(e, 'template_not_found', 'forbidden')) notFound()
      throw e
    },
  )
  const current = template.versions[0]

  return (
    <>
      <PageHeader
        title={`テンプレート編集 — ${NOTIFICATION_EVENT_LABELS[template.event]}`}
        description={`${CHANNEL_LABELS[template.channel]} / ${template.storeCode ?? '全店舗'}`}
        actions={
          <Link href="/admin/notification-templates" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      {created && (
        <div className="mb-4">
          <Notice tone="green">テンプレートを作成しました</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="文面（新しい版として公開）">
          <TemplateEditor
            action={publishTemplateVersionAction}
            submitLabel="公開する"
            event={template.event}
            channel={template.channel}
            variables={variables.map((name) => ({
              name,
              label: TEMPLATE_VARIABLE_LABELS[name] ?? name,
            }))}
            defaults={{
              subject: current?.subject ?? null,
              body: current?.body ?? '',
              entryGuideUrl: current?.entryGuideUrl ?? null,
            }}
          >
            <input type="hidden" name="templateId" value={template.id} />
          </TemplateEditor>
          <p className="mt-3 rounded-lg bg-gold-pale p-2 text-xs">
            送信待ちの通知は作成時の文面のまま送られます（F-NTF-09）。通知チャネルの送り分け・本登録誘導の文面は要確認
            Q-07
          </p>
        </Card>
        <Card title="設定">
          <ActionForm action={updateTemplateSettingsAction} submitLabel="保存する">
            <input type="hidden" name="templateId" value={template.id} />
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="isEnabled" defaultChecked={template.isEnabled} />
              有効（無効にするとこのチャネルでは送信しません）
            </label>
            <Field label="チャネル優先順位" hint="同じ種別の中で小さいほど優先">
              <input
                name="priority"
                inputMode="numeric"
                defaultValue={template.priority}
                className={inputClass}
              />
            </Field>
          </ActionForm>
        </Card>
      </div>
      <Card title="版の履歴" className="mt-4">
        <Table
          head={['版', '公開日時', '公開者', '件名', '本文']}
          rows={template.versions.map((v) => [
            `第${v.versionNo}版`,
            ymdhm(v.publishedAt),
            v.publishedByName,
            v.subject ?? '—',
            <span key="b" className="line-clamp-2 max-w-xl whitespace-pre-wrap text-xs">
              {v.body}
            </span>,
          ])}
        />
      </Card>
    </>
  )
}
