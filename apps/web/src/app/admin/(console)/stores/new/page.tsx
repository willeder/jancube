import Link from 'next/link'
import { ActionForm } from '@/components/admin/ActionForm'
import { StoreFields } from '@/components/admin/master-fields'
import { buttonClass, Card, Field, inputClass, PageHeader } from '@/components/admin/ui'
import { createStoreAction } from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'

export const dynamic = 'force-dynamic'

/** A-18 店舗を追加 (all-store administrators). */
export default async function NewStorePage() {
  await requireStaff('stores.manage')
  return (
    <>
      <PageHeader
        title="店舗を追加"
        description="営業時間は毎日 10:00〜24:00 で作成されます。作成後に店舗の画面で変更してください"
        actions={
          <Link href="/admin/stores" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      <Card className="max-w-4xl">
        <ActionForm action={createStoreAction} submitLabel="店舗を作成">
          <div className="w-60">
            <Field label="店舗コード" hint="例: JC004（作成後は変更不可）">
              <input name="code" required maxLength={32} className={`${inputClass} font-mono`} />
            </Field>
          </div>
          <StoreFields d={{ status: 'preparing', isActive: false }} />
        </ActionForm>
      </Card>
    </>
  )
}
