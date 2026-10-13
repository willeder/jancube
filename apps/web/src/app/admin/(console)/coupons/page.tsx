import { COUPON_PRESETS, GRANT_TRIGGER_LABELS } from '@jancube/application'
import Link from 'next/link'
import { COUPON_STATUS_LABELS, lastDay, yen, ymd } from '@/components/admin/format'
import { Badge, buttonClass, Card, PageHeader, Table, TextLink } from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** A-14 クーポン一覧 */
export default async function CouponsPage() {
  const staff = await requireStaff('coupons.manage')
  const [coupons, options] = await withContainer((c) =>
    Promise.all([c.listCoupons(staff), c.listMasterOptions(staff)]),
  )
  const storeCode = (id: number) => options.stores.find((s) => s.id === id)?.code ?? `#${id}`

  return (
    <>
      <PageHeader
        title="クーポン管理"
        description="クーポンマスタの作成・編集。条件の変更は新しい版として公開され、発行済みのクーポンは元の条件のまま使えます。Phase 1 は割引型のみ"
        actions={
          <Link href="/admin/coupons/new" className={buttonClass.primary}>
            + クーポンを作成
          </Link>
        }
      />
      <Table
        head={[
          'クーポン',
          'コード',
          '割引',
          '回数',
          '期間',
          '対象店舗',
          'トリガー',
          '併用',
          '発行数',
          '状態',
        ]}
        rows={coupons.map((c) => {
          const v = c.latest
          return [
            <TextLink key="n" href={`/admin/coupons/${c.id}`}>
              {c.name}
            </TextLink>,
            <span key="c" className="font-mono text-xs">
              {c.code}
            </span>,
            v ? (v.discountType === 'amount' ? yen(v.discountValue) : `${v.discountValue}%`) : '—',
            v ? `${v.maxUses}回` : '—',
            v ? `${ymd(v.validFrom)}〜${lastDay(v.validTo)}` : '—',
            v && v.storeIds.length > 0 ? v.storeIds.map(storeCode).join('/') : '全店舗',
            v ? GRANT_TRIGGER_LABELS[v.grantTrigger] : '—',
            v?.stackable ? '可' : '不可',
            `${c.grantCount}件`,
            <Badge
              key="s"
              tone={c.status === 'active' ? 'green' : c.status === 'draft' ? 'gold' : 'gray'}
            >
              {COUPON_STATUS_LABELS[c.status]}
            </Badge>,
          ]
        })}
        empty="クーポンはまだありません"
      />
      <Card title="プリセットから作成" className="mt-4">
        <ul className="space-y-2 text-sm">
          {COUPON_PRESETS.map((p) => (
            <li key={p.key}>
              <TextLink href={`/admin/coupons/new?preset=${p.key}`}>{p.label}</TextLink>
              <span className="ml-2 text-xs text-sub">{p.description}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-sub">
          傾斜テーブル（回数に応じて割引額を変える設定）は Phase 1 追随（FR-5）。
        </p>
      </Card>
    </>
  )
}
