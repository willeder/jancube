import { SEGMENT_LABELS } from '@jancube/application'
import { ActionForm } from '@/components/admin/ActionForm'
import { CAMPAIGN_STATUS_LABELS, lastDay, yen, ymdhm } from '@/components/admin/format'
import { Badge, Card, Notice, PageHeader, Table } from '@/components/admin/ui'
import { runCampaignAction } from '@/server/admin-member-coupon-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { CampaignForm } from './CampaignForm'

export const dynamic = 'force-dynamic'

/** A-15 セグメント一斉発行 */
export default async function CampaignsPage() {
  const staff = await requireStaff('coupons.manage')
  const [coupons, campaigns, options] = await withContainer((c) =>
    Promise.all([
      c.listGrantableCoupons(staff),
      c.listCampaigns(staff),
      c.listMasterOptions(staff),
    ]),
  )

  return (
    <>
      <PageHeader
        title="セグメント一斉発行"
        description="定型セグメントを選び、対象件数を確認してからクーポンを一斉付与します"
      />
      {coupons.length === 0 ? (
        <Notice>
          発行できるクーポンがありません。先に A-14 で有効なクーポンを作成してください。
        </Notice>
      ) : (
        <CampaignForm
          // A new key per page view: re-submitting the same form never issues twice.
          campaignKey={crypto.randomUUID()}
          coupons={coupons.map((c) => ({
            versionId: c.couponVersionId,
            label: `${c.name}（${c.discountType === 'amount' ? yen(c.discountValue) : `${c.discountValue}%`}・${c.maxUses}回・〜${lastDay(c.validTo)}）`,
          }))}
          stores={options.stores.map((s) => ({ id: s.id, label: `${s.code} ${s.name}` }))}
        />
      )}
      <Card title="発行履歴" className="mt-6">
        <Table
          head={[
            '実行日時',
            '施策名',
            'クーポン',
            'セグメント',
            '対象',
            '付与',
            '状態',
            '実行者',
            '',
          ]}
          rows={campaigns.map((k) => [
            ymdhm(k.startedAt ?? k.createdAt),
            k.name,
            k.couponName,
            SEGMENT_LABELS[k.segmentCode as keyof typeof SEGMENT_LABELS] ?? k.segmentCode,
            `${k.targetCount}名`,
            `${k.grantedCount}件`,
            <Badge
              key="s"
              tone={k.status === 'completed' ? 'green' : k.status === 'failed' ? 'red' : 'gold'}
            >
              {CAMPAIGN_STATUS_LABELS[k.status] ?? k.status}
            </Badge>,
            k.issuedByName,
            k.status === 'completed' ? (
              '—'
            ) : (
              // Resume with the same campaign key: members already granted are skipped.
              <ActionForm
                key="r"
                action={runCampaignAction}
                submitLabel="再実行"
                variant="secondary"
                inline
              >
                <input type="hidden" name="campaignKey" value={k.campaignKey} />
                <input type="hidden" name="name" value={k.name} />
                <input type="hidden" name="couponVersionId" value={k.couponVersionId} />
                <input type="hidden" name="segmentCode" value={k.segmentCode} />
                {(['days', 'from', 'to', 'storeId'] as const).map((field) =>
                  k.segmentConditions[field] === undefined ? null : (
                    <input
                      key={field}
                      type="hidden"
                      name={field}
                      value={String(k.segmentConditions[field])}
                    />
                  ),
                )}
                <input type="hidden" name="notify" value="on" />
              </ActionForm>
            ),
          ])}
          empty="一斉発行の履歴はありません"
        />
      </Card>
    </>
  )
}
