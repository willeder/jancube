import {
  NOTIFICATION_EVENT_LABELS,
  TEMPLATE_VARIABLE_LABELS,
  TEMPLATE_VARIABLES,
} from '@jancube/application'
import { NOTIFICATION_EVENTS } from '@jancube/domain'
import { CHANNEL_LABELS, ymd } from '@/components/admin/format'
import {
  Badge,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { createTemplateAction } from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { TemplateEditor } from './TemplateEditor'

export const dynamic = 'force-dynamic'

/** A-21 通知テンプレート一覧 */
export default async function TemplatesPage() {
  const staff = await requireStaff('notifications.manage')
  const [templates, options] = await withContainer((c) =>
    Promise.all([c.listTemplates(staff), c.listMasterOptions(staff)]),
  )
  const allVariables = [...new Set(Object.values(TEMPLATE_VARIABLES).flat())]

  return (
    <>
      <PageHeader
        title="通知テンプレート"
        description="通知種別ごとのLINE・メール・SMS文面と差し込み変数を管理します。チャネルは優先順位の小さい順に、連絡可能なものが使われます（F-NTF-07）"
      />
      <Table
        head={['種別', 'チャネル', '対象店舗', '優先順位', '最新版', '最終更新', '状態', '']}
        rows={templates.map((t) => [
          NOTIFICATION_EVENT_LABELS[t.event],
          CHANNEL_LABELS[t.channel],
          t.storeCode ?? '全店舗',
          t.priority,
          t.latestVersionNo ? `第${t.latestVersionNo}版` : '—',
          ymd(t.latestPublishedAt),
          <Badge key="s" tone={t.isEnabled ? 'green' : 'gray'}>
            {t.isEnabled ? '有効' : '無効'}
          </Badge>,
          <TextLink key="e" href={`/admin/notification-templates/${t.id}`}>
            編集
          </TextLink>,
        ])}
      />
      <div className="mt-4">
        <Notice>
          【課題#8】予約完了通知からは鍵コード（入室コード）を削除し、前日通知で「部屋番号＋入室コード」をお知らせします（2026-10-01
          決定）。
        </Notice>
      </div>
      <Card title="テンプレートを追加（店舗別の文面・チャネル追加）" className="mt-4 max-w-4xl">
        <TemplateEditor
          action={createTemplateAction}
          submitLabel="作成して公開"
          event={null}
          channel={null}
          variables={allVariables.map((name) => ({
            name,
            label: TEMPLATE_VARIABLE_LABELS[name] ?? name,
          }))}
          defaults={{ subject: '', body: '', entryGuideUrl: null }}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="通知種別">
              <select name="event" className={inputClass}>
                {NOTIFICATION_EVENTS.map((e) => (
                  <option key={e} value={e}>
                    {NOTIFICATION_EVENT_LABELS[e]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="チャネル">
              <select name="channel" className={inputClass}>
                <option value="line">LINE</option>
                <option value="email">メール</option>
                <option value="sms">SMS</option>
              </select>
            </Field>
            <Field label="対象店舗">
              <select name="storeId" className={inputClass}>
                <option value="all">全店舗</option>
                {options.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="優先順位" hint="1が最優先">
              <input name="priority" inputMode="numeric" defaultValue={1} className={inputClass} />
            </Field>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="isEnabled" defaultChecked />
            有効
          </label>
          <p className="text-xs text-sub">
            使える差し込み変数は通知種別ごとに決まっています（公開時にチェックします）。メールは件名が必須です。
          </p>
        </TemplateEditor>
      </Card>
    </>
  )
}
