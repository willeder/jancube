import Link from 'next/link'
import { duration, hhmm, weekdayLabel, yen, ymd } from '@/components/admin/format'
import { Badge, buttonClass, Notice, PageHeader, Table, TextLink } from '@/components/admin/ui'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/** A-16 料金プロファイル一覧 */
export default async function PricesPage() {
  const staff = await requireStaff('prices.manage')
  const profiles = await withContainer((c) => c.listPriceProfiles(staff))

  return (
    <>
      <PageHeader
        title="料金プロファイル"
        description="時間単価・パック料金・時間帯ルールをパターンとして管理し、部屋ごとに割り当てます。変更は新しい版として公開します"
        actions={
          <>
            <Link href="/admin/prices/simulate" className={buttonClass.secondary}>
              料金シミュレーション
            </Link>
            <Link href="/admin/prices/new" className={buttonClass.primary}>
              + パターンを作成
            </Link>
          </>
        }
      />
      <Table
        head={[
          'パターン',
          'コード',
          '時間単価',
          'パック',
          '時間帯ルール',
          '最低',
          '最新版',
          '割当部屋',
          '状態',
        ]}
        rows={profiles.map((p) => {
          const v = p.latest
          return [
            <TextLink key="n" href={`/admin/prices/${p.id}`}>
              {p.name}
            </TextLink>,
            <span key="c" className="font-mono text-xs">
              {p.code}
            </span>,
            v ? `${yen(v.hourlyRate)}/時` : '—',
            v?.packages.length
              ? v.packages.map((pk) => `${duration(pk.minutes)} ${yen(pk.price)}`).join(' / ')
              : '—',
            v?.timeRules.length
              ? v.timeRules
                  .map(
                    (r) =>
                      `${weekdayLabel(r.weekdayMask)}${r.startMinute !== null ? ` ${hhmm(r.startMinute)}-${hhmm(r.endMinute)}` : ''} -${yen(r.hourlyDiscount)}/時`,
                  )
                  .join(' / ')
              : '—',
            v ? duration(v.minimumMinutes) : '—',
            v ? `第${v.versionNo}版（${ymd(v.validFrom)}〜）` : '—',
            `${p.roomCount}室`,
            <Badge key="s" tone={p.isActive ? 'green' : 'gray'}>
              {p.isActive ? '有効' : '無効'}
            </Badge>,
          ]
        })}
        empty="料金プロファイルはまだありません"
      />
      <div className="mt-4">
        <Notice>
          【課題#34】料金プロファイルは部屋単位で設定（2026-10-01
          決定）。複数の部屋への一括設定（課題#35）は各パターンの画面から部屋を複数選択して行えます。
        </Notice>
      </div>
    </>
  )
}
