import { ROLE_LABELS } from '@jancube/application'
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '@jancube/domain'
import { ActionForm } from '@/components/admin/ActionForm'
import { STAFF_STATUS_LABELS, ymdhm } from '@/components/admin/format'
import { GrantRows } from '@/components/admin/master-fields'
import { Badge, Card, Field, inputClass, PageHeader, Table, TextLink } from '@/components/admin/ui'
import { inviteStaffAction } from '@/server/admin-master-actions'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

const roleOptions = ROLES.map((r) => [r, ROLE_LABELS[r]] as const)

/** A-23 スタッフ・ロール管理. Server-side rules restrict who may manage each role. */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const staff = await requireStaff('staff.manage')
  const { role } = await searchParams
  const [list, options] = await withContainer((c) =>
    Promise.all([c.listStaff(staff), c.listMasterOptions(staff)]),
  )
  const rows = role ? list.filter((s) => s.grants.some((g) => g.role === role)) : list

  return (
    <>
      <PageHeader
        title="スタッフ・ロール管理"
        description="スタッフの招待とロール・担当店舗を管理します"
      />
      <form method="get" className="mb-3 flex items-center gap-2">
        <select
          name="role"
          defaultValue={role ?? ''}
          className={`${inputClass} w-48`}
          aria-label="ロール"
        >
          <option value="">ロール: すべて</option>
          {roleOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="text-sm font-bold text-brand-dark">
          絞り込む
        </button>
      </form>
      <Table
        head={['氏名', 'メールアドレス', 'ロール・担当店舗', '最終ログイン', '状態', '']}
        rows={rows.map((s) => [
          s.name,
          s.email,
          s.grants.map((g) => `${ROLE_LABELS[g.role]}(${g.storeCode ?? '全店舗'})`).join(' / '),
          ymdhm(s.lastLoginAt),
          <Badge
            key="s"
            tone={s.status === 'active' ? 'green' : s.status === 'invited' ? 'gold' : 'gray'}
          >
            {STAFF_STATUS_LABELS[s.status]}
          </Badge>,
          <TextLink key="e" href={`/admin/staff/${s.id}`}>
            編集
          </TextLink>,
        ])}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="スタッフを招待">
          <ActionForm action={inviteStaffAction} submitLabel="招待メールを送る">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="氏名">
                <input name="name" required maxLength={100} className={inputClass} />
              </Field>
              <Field label="メールアドレス（ログインID）">
                <input name="email" type="email" required className={inputClass} />
              </Field>
            </div>
            <Field label="ロールと担当店舗">
              <GrantRows grants={[]} stores={options.stores} roles={roleOptions} />
            </Field>
            <p className="text-xs text-sub">
              招待メールのリンク（7日間有効）からパスワードを設定すると利用開始できます。
            </p>
          </ActionForm>
        </Card>
        <Card title="ロール別の権限">
          <Table
            head={['権限', ...ROLES.map((r) => ROLE_LABELS[r])]}
            rows={PERMISSIONS.map((p) => [
              <span key="p" className="font-mono text-xs">
                {p}
              </span>,
              ...ROLES.map((r) => (ROLE_PERMISSIONS[r].includes(p) ? '○' : '—')),
            ])}
          />
          <p className="mt-2 text-xs text-sub">
            オーナー・管理者・清掃の3ロールで運用します。管理者アカウントはオーナーが管理し、管理者は清掃担当を管理できます。担当店舗の制限は各操作でも適用されます。
          </p>
        </Card>
      </div>
    </>
  )
}
