import { COUPON_PRESETS, endOfLocalDate, localToday, startOfLocalDate } from '@jancube/application'
import { addDays } from '@jancube/domain'
import Link from 'next/link'
import { ActionForm } from '@/components/admin/ActionForm'
import { CouponVersionFields } from '@/components/admin/master-fields'
import { buttonClass, Card, Field, inputClass, Notice, PageHeader } from '@/components/admin/ui'
import { createCouponAction } from '@/server/admin-member-coupon-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** A-14 クーポン作成 (optionally from a preset: F-CPN-02 / F-CPN-04). */
export default async function NewCouponPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>
}) {
  const staff = await requireStaff('coupons.manage')
  const { preset: presetKey } = await searchParams
  const options = await withContainer((c) => c.listMasterOptions(staff))
  const preset = COUPON_PRESETS.find((p) => p.key === presetKey)
  const today = localToday(new Date())

  return (
    <>
      <PageHeader
        title={preset ? `クーポンを作成 — ${preset.label}` : 'クーポンを作成'}
        actions={
          <Link href="/admin/coupons" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      {preset && (
        <div className="mb-4">
          <Notice>{preset.description}</Notice>
        </div>
      )}
      <Card className="max-w-4xl">
        <ActionForm action={createCouponAction} submitLabel="保存する">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="クーポン名（お客様に表示）">
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={preset?.name}
                className={inputClass}
              />
            </Field>
            <Field
              label="クーポンコード"
              hint="英数字。手動配布型はお客様がこのコードを入力して取得"
            >
              <input
                name="code"
                required
                maxLength={64}
                defaultValue={preset?.code}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="キャンペーンタグ">
              <input
                name="campaignTag"
                maxLength={100}
                defaultValue={preset?.campaignTag ?? ''}
                className={inputClass}
              />
            </Field>
          </div>
          <CouponVersionFields
            stores={options.stores}
            roomTypes={options.roomTypes}
            defaults={{
              discountType: preset?.discountType ?? 'amount',
              discountValue: preset?.discountValue,
              maximumDiscount: preset?.maximumDiscount ?? null,
              maxUses: preset?.maxUses ?? 1,
              grantTrigger: preset?.grantTrigger ?? 'manual',
              conditionsNote: preset?.conditionsNote ?? '全店舗対象 / 併用不可',
              validFrom: startOfLocalDate(today),
              validTo: endOfLocalDate(addDays(today, (preset?.validDays ?? 90) - 1)),
              weekdayMask: 127,
            }}
          />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="activate" defaultChecked />
            保存と同時に有効にする（外すと下書き）
          </label>
        </ActionForm>
      </Card>
    </>
  )
}
