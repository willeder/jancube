import { ROLE_LABELS } from '@jancube/application'
import { ROLES } from '@jancube/domain'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/admin/ActionForm'
import { STAFF_STATUS_LABELS, ymdhm } from '@/components/admin/format'
import { GrantRows } from '@/components/admin/master-fields'
import {
  Badge,
  buttonClass,
  Card,
  Field,
  inputClass,
  Notice,
  PageHeader,
} from '@/components/admin/ui'
import {
  resendInviteAction,
  setStaffEnabledAction,
  updateStaffAction,
} from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'

export const dynamic = 'force-dynamic'

const roleOptions = ROLES.map((r) => [r, ROLE_LABELS[r]] as const)

/** A-23 スタッフの編集: name, roles per store, enable/disable, invitation. */
export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ invited?: string }>
}) {
  const staff = await requireStaff('staff.manage')
  const id = Number((await params).id)
  const { invited } = await searchParams
  if (!Number.isInteger(id)) notFound()
  const [target, options] = await withContainer((c) =>
    Promise.all([c.getStaff(staff, id), c.listMasterOptions(staff)]),
  ).catch((e) => {
    if (isDomainError(e, 'staff_not_found')) notFound()
    throw e
  })
  const isSelf = target.id === staff.staffId

  return (
    <>
      <PageHeader
        title={`スタッフの編集 — ${target.name}`}
        description={
          <>
            {target.email} /{' '}
            <Badge
              tone={
                target.status === 'active' ? 'green' : target.status === 'invited' ? 'gold' : 'gray'
              }
            >
              {STAFF_STATUS_LABELS[target.status]}
            </Badge>{' '}
            / 最終ログイン {ymdhm(target.lastLoginAt)}
          </>
        }
        actions={
          <Link href="/admin/staff" className={buttonClass.secondary}>
            一覧へ戻る
          </Link>
        }
      />
      {invited && (
        <div className="mb-4">
          <Notice tone="green">招待メールを送信しました</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="氏名・ロール">
          <ActionForm action={updateStaffAction} submitLabel="保存する">
            <input type="hidden" name="staffId" value={target.id} />
            <Field label="氏名">
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={target.name}
                className={inputClass}
              />
            </Field>
            <Field label="ロールと担当店舗（オーナー・本部管理者は全店舗可、その他は店舗ごと）">
              <GrantRows grants={target.grants} stores={options.stores} roles={roleOptions} />
            </Field>
            <p className="text-xs text-sub">
              有効なオーナーが1人もいなくなる変更はできません。変更は次の画面操作から反映されます。
            </p>
          </ActionForm>
        </Card>
        <div className="space-y-4">
          <Card title="アカウントの有効 / 無効">
            {isSelf ? (
              <p className="text-sm text-sub">自分自身のアカウントは無効にできません。</p>
            ) : (
              <ActionForm
                action={setStaffEnabledAction}
                submitLabel={target.status === 'disabled' ? '有効にする' : '無効にする'}
                variant={target.status === 'disabled' ? 'primary' : 'danger'}
                confirm={
                  target.status === 'disabled'
                    ? undefined
                    : 'このスタッフを無効にしますか？ログイン中でも次の操作から利用できなくなります'
                }
              >
                <input type="hidden" name="staffId" value={target.id} />
                <input
                  type="hidden"
                  name="enabled"
                  value={target.status === 'disabled' ? 'true' : 'false'}
                />
              </ActionForm>
            )}
          </Card>
          {target.status === 'invited' && (
            <Card title="招待メール">
              <ActionForm action={resendInviteAction} submitLabel="招待メールを再送">
                <input type="hidden" name="staffId" value={target.id} />
                <p className="text-xs text-sub">新しいリンク（7日間有効）を送信します。</p>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
