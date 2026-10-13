import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import { lastDay, yen } from '@/components/admin/format'
import { buttonClass, Card, Field, inputClass, Notice, PageHeader } from '@/components/admin/ui'
import { grantCouponAction } from '@/server/admin-member-coupon-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'

export const dynamic = 'force-dynamic'

/** A-13 個別クーポン発行 */
export default async function GrantCouponPage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requireStaff('members.manage')
  const memberCode = decodeURIComponent((await params).code)
  const [detail, coupons] = await withContainer((c) =>
    Promise.all([c.getMemberDetail(staff, memberCode), c.listGrantableCoupons(staff)]),
  ).catch((e) => {
    if (isDomainError(e, 'member_not_found')) notFound()
    throw e
  })
  const { member } = detail
  const back = `/admin/members/${encodeURIComponent(member.memberCode)}`

  return (
    <>
      <PageHeader
        title="個別クーポン発行"
        description={`口コミ御礼など、特定のお客様へ個別にクーポンを付与します。対象: ${member.familyName ?? ''} ${member.givenName ?? ''}(${member.memberCode}) / 利用${member.useCount}回 / 最終 ${member.lastUseDate ?? '—'}`}
        actions={
          <Link href={back} className={buttonClass.secondary}>
            会員詳細へ戻る
          </Link>
        }
      />
      <Card className="max-w-3xl">
        {coupons.length === 0 ? (
          <Notice>
            発行できるクーポンがありません。先に A-14
            クーポン管理で有効なクーポンを作成してください。
          </Notice>
        ) : (
          <ActionForm action={grantCouponAction} submitLabel="発行する">
            <input type="hidden" name="memberCode" value={member.memberCode} />
            {/* One token per rendered form: a double submit grants once. */}
            <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
            <Field label="クーポン（有効なクーポンの最新版）">
              <select name="couponVersionId" required className={inputClass}>
                {coupons.map((c) => (
                  <option key={c.couponVersionId} value={c.couponVersionId}>
                    {c.name}（
                    {c.discountType === 'amount' ? yen(c.discountValue) : `${c.discountValue}%`}・
                    {c.maxUses}回・〜{lastDay(c.validTo)}・第{c.versionNo}版）
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="利用回数" hint="空欄=クーポンの設定どおり">
                <input name="maxUses" inputMode="numeric" className={inputClass} />
              </Field>
              <Field
                label="有効期限（この日まで）"
                hint="空欄=クーポンの終了日。終了日より後にはできません"
              >
                <input name="expiresOn" type="date" className={inputClass} />
              </Field>
            </div>
            <Field label="社内メモ（監査ログに記録）">
              <input
                name="internalNote"
                maxLength={1000}
                placeholder="Google口コミ投稿の御礼 / 確認者"
                className={inputClass}
              />
            </Field>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="notify" defaultChecked />
              LINE・メールで付与を通知する（通知テンプレート「クーポン付与」の文面）
            </label>
            <p className="rounded-lg bg-gold-pale p-2 text-xs">
              割引型のみ(Phase 1)。ポイント・回数券は対象外。通知文面は A-21
              通知テンプレートで管理します。
            </p>
          </ActionForm>
        )}
      </Card>
    </>
  )
}
