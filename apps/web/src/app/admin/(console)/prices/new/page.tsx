import Link from 'next/link'
import { ActionForm } from '@/components/admin/ActionForm'
import { PriceVersionFields } from '@/components/admin/master-fields'
import { buttonClass, Card, Field, inputClass, PageHeader } from '@/components/admin/ui'
import { createPriceProfileAction } from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'

export const dynamic = 'force-dynamic'

/** A-16 パターンを作成 (profile + version 1). */
export default async function NewPriceProfilePage() {
  await requireStaff('prices.manage')
  return (
    <>
      <PageHeader
        title="料金パターンを作成"
        actions={
          <Link href="/admin/prices" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      <Card className="max-w-4xl">
        <ActionForm action={createPriceProfileAction} submitLabel="作成して第1版を公開">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="パターン名">
              <input
                name="name"
                required
                maxLength={200}
                placeholder="標準(平日)"
                className={inputClass}
              />
            </Field>
            <Field label="料金コード" hint="英数字（例: STD_WEEKDAY）">
              <input name="code" required maxLength={32} className={`${inputClass} font-mono`} />
            </Field>
          </div>
          <PriceVersionFields defaults={{ validFrom: new Date() }} />
          <p className="text-xs text-sub">作成後、パターンの画面で部屋に割り当てます。</p>
        </ActionForm>
      </Card>
    </>
  )
}
