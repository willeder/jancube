import { GRANT_TRIGGER_LABELS } from '@jancube/application'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import {
  COUPON_STATUS_LABELS,
  hhmm,
  lastDay,
  weekdayLabel,
  yen,
  ymd,
  ymdhm,
} from '@/components/admin/format'
import { CouponVersionFields } from '@/components/admin/master-fields'
import {
  Badge,
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
} from '@/components/admin/ui'
import {
  publishCouponVersionAction,
  setCouponStatusAction,
  updateCouponAction,
} from '@/server/admin-member-coupon-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'

export const dynamic = 'force-dynamic'

/** A-14 クーポン編集: name/status, version history and a new version. */
export default async function CouponDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const staff = await requireStaff('coupons.manage')
  const id = Number((await params).id)
  const { created } = await searchParams
  if (!Number.isInteger(id)) notFound()
  const [coupon, options] = await withContainer((c) =>
    Promise.all([c.getCoupon(staff, id), c.listMasterOptions(staff)]),
  ).catch((e) => {
    if (isDomainError(e, 'coupon_not_found')) notFound()
    throw e
  })
  const latest = coupon.versions[0]
  const storeCode = (sid: number) => options.stores.find((s) => s.id === sid)?.code ?? `#${sid}`
  const typeName = (tid: number) => options.roomTypes.find((t) => t.id === tid)?.name ?? `#${tid}`

  return (
    <>
      <PageHeader
        title={`クーポン — ${coupon.name}`}
        description={
          <>
            コード <span className="font-mono">{coupon.code}</span> /{' '}
            <Badge
              tone={
                coupon.status === 'active' ? 'green' : coupon.status === 'draft' ? 'gold' : 'gray'
              }
            >
              {COUPON_STATUS_LABELS[coupon.status]}
            </Badge>
          </>
        }
        actions={
          <Link href="/admin/coupons" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      {created && (
        <div className="mb-4">
          <Notice tone="green">クーポンを作成しました</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="基本情報">
          <ActionForm action={updateCouponAction} submitLabel="保存する">
            <input type="hidden" name="couponId" value={coupon.id} />
            <Field label="クーポン名（お客様に表示・発行済みにも反映）">
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={coupon.name}
                className={inputClass}
              />
            </Field>
            <Field label="キャンペーンタグ">
              <input
                name="campaignTag"
                maxLength={100}
                defaultValue={coupon.campaignTag ?? ''}
                className={inputClass}
              />
            </Field>
          </ActionForm>
        </Card>
        <Card title="有効化 / 停止">
          <p className="mb-3 text-sm text-sub">
            停止するとお客様は利用・取得できなくなります（発行済みの記録は残ります）。
          </p>
          <ActionForm
            action={setCouponStatusAction}
            submitLabel={coupon.status === 'active' ? '停止する' : '有効にする'}
            variant={coupon.status === 'active' ? 'danger' : 'primary'}
            confirm={coupon.status === 'active' ? 'このクーポンを停止しますか？' : undefined}
          >
            <input type="hidden" name="couponId" value={coupon.id} />
            <input
              type="hidden"
              name="status"
              value={coupon.status === 'active' ? 'disabled' : 'active'}
            />
          </ActionForm>
        </Card>
      </div>

      <Card title="条件の版（新しい順）" className="mt-4">
        <Table
          head={[
            '版',
            '割引',
            '最低金額',
            '回数',
            '期間',
            '曜日・時間',
            '対象',
            'トリガー',
            '公開日時',
          ]}
          rows={coupon.versions.map((v) => [
            `第${v.versionNo}版`,
            v.discountType === 'amount'
              ? yen(v.discountValue)
              : `${v.discountValue}%${v.maximumDiscount !== null ? `(上限${yen(v.maximumDiscount)})` : ''}`,
            v.minimumSpend ? yen(v.minimumSpend) : '—',
            `${v.maxUses}回`,
            `${ymd(v.validFrom)}〜${lastDay(v.validTo)}`,
            `${weekdayLabel(v.weekdayMask)}${v.startMinute !== null ? ` ${hhmm(v.startMinute)}-${hhmm(v.endMinute)}開始` : ''}`,
            `${v.storeIds.length ? v.storeIds.map(storeCode).join('/') : '全店舗'} / ${v.roomTypeIds.length ? v.roomTypeIds.map(typeName).join('/') : '全タイプ'}`,
            GRANT_TRIGGER_LABELS[v.grantTrigger],
            ymdhm(v.publishedAt),
          ])}
        />
      </Card>

      <Card title="条件を変更（新しい版を公開）" className="mt-4">
        <p className="mb-3 text-xs text-sub">
          発行済みのクーポンは発行時の版の条件で使えます。新しい版はこれから発行・取得される分に適用されます。
        </p>
        <ActionForm
          action={publishCouponVersionAction}
          submitLabel="新しい版を公開する"
          confirm="新しい版を公開しますか？"
        >
          <input type="hidden" name="couponId" value={coupon.id} />
          <CouponVersionFields
            defaults={latest ?? {}}
            stores={options.stores}
            roomTypes={options.roomTypes}
          />
        </ActionForm>
      </Card>
    </>
  )
}
