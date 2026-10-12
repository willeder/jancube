import { addDays, localDateOf, parseLocalDate } from '@jancube/domain'
import Link from 'next/link'
import {
  Badge,
  buttonClass,
  Card,
  inputClass,
  Notice,
  PageHeader,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { KEY_STATUS_LABEL, localDateTime, localTime } from '@/components/operations/time'
import { dateLabel } from '@/lib/format'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

const BOOKING_STATUS: Record<string, string> = {
  confirmed: '確定',
  completed: '利用済',
  canceled: 'キャンセル',
}

function validDate(value: string | undefined): string | null {
  if (!value) return null
  try {
    parseLocalDate(value)
    return value
  } catch {
    return null
  }
}

/** A-09 鍵状況: entry codes of the selected store and date (F-KEY-05). */
export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const staff = await requireStaff('keys.manage')
  const storeId = await selectedStoreId(staff, 'keys.manage')
  if (storeId === null || storeId < 0) {
    return (
      <>
        <PageHeader title="鍵状況" />
        <Notice>左上の店舗切り替えで店舗を選択してください</Notice>
      </>
    )
  }
  const { date: raw } = await searchParams
  const data = await withContainer(async (c) => {
    const store = await c.getOperationsStore(storeId)
    const date = validDate(raw) ?? localDateOf(new Date(), store?.timezone ?? 'Asia/Tokyo')
    return { date, ...(await c.listKeys(staff, storeId, date)) }
  })
  const { date, store, rows, device } = data
  const tz = store.timezone
  const issued = rows.filter(
    (r) => r.key && (r.key.status === 'issued' || r.key.status === 'active'),
  ).length
  const problems = rows.filter(
    (r) =>
      r.booking.status === 'confirmed' &&
      (!r.key || r.key.status === 'failed' || r.key.status === 'pending'),
  ).length

  return (
    <>
      <PageHeader
        title="鍵状況"
        description="入室コードの発行状態を確認し、再発行・再通知を行います。鍵の対象は店舗の入口錠です（部屋ごとの鍵はありません）"
      />
      <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
        <Link href={`/admin/keys?date=${addDays(date, -1)}`} className={buttonClass.secondary}>
          前日
        </Link>
        <input type="date" name="date" defaultValue={date} className={`${inputClass} w-44`} />
        <button type="submit" className={buttonClass.primary}>
          表示
        </button>
        <Link href={`/admin/keys?date=${addDays(date, 1)}`} className={buttonClass.secondary}>
          翌日
        </Link>
        <span className="ml-2 text-sm font-bold">
          {store.code} {store.name} / {dateLabel(date)}
        </span>
      </form>
      {problems > 0 && (
        <div className="mb-4">
          <Notice tone="red">
            入室コードが未発行・発行失敗のご予約が {problems}{' '}
            件あります。詳細から再発行してください。復旧できない場合は店舗スタッフによる手動解錠で対応してください
          </Notice>
        </div>
      )}
      <div className="mb-4 grid gap-4 md:grid-cols-[1fr_20rem]">
        <Table
          head={['予約番号', '時間', 'お客様', '部屋', '予約', '鍵の状態', '有効時間']}
          rows={rows.map(({ booking, key }) => [
            <TextLink key="code" href={`/admin/keys/${encodeURIComponent(booking.bookingCode)}`}>
              {booking.bookingCode}
            </TextLink>,
            `${localTime(booking.start, tz)}〜${localTime(booking.end, tz)}`,
            booking.contactName ?? '—',
            booking.assignment?.roomName ?? '未割当',
            BOOKING_STATUS[booking.status] ?? booking.status,
            key ? (
              <Badge
                key="status"
                tone={
                  key.status === 'issued' || key.status === 'active'
                    ? 'green'
                    : key.status === 'failed'
                      ? 'red'
                      : key.status === 'pending'
                        ? 'gold'
                        : 'gray'
                }
              >
                {KEY_STATUS_LABEL[key.status] ?? key.status}
              </Badge>
            ) : (
              <Badge key="status" tone={booking.status === 'confirmed' ? 'gold' : 'gray'}>
                未発行
              </Badge>
            ),
            key ? `${localTime(key.validFrom, tz)}〜${localTime(key.validTo, tz)}` : '—',
          ])}
          empty="この日のご予約はありません"
        />
        <Card title="入口錠">
          {device ? (
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
              <dt className="text-sub">デバイス</dt>
              <dd className="font-bold">{device.name}</dd>
              <dt className="text-sub">通信</dt>
              <dd>
                <Badge
                  tone={
                    device.communicationStatus === 'online'
                      ? 'green'
                      : device.communicationStatus === 'offline'
                        ? 'red'
                        : 'gray'
                  }
                >
                  {device.communicationStatus === 'online'
                    ? '正常'
                    : device.communicationStatus === 'offline'
                      ? '不通'
                      : '不明'}
                </Badge>
              </dd>
              <dt className="text-sub">最終応答</dt>
              <dd>{localDateTime(device.lastResponseAt, tz)}</dd>
              <dt className="text-sub">発行済</dt>
              <dd>
                {issued} / {rows.filter((r) => r.booking.status === 'confirmed').length} 件
              </dd>
            </dl>
          ) : (
            <Notice tone="red">
              有効な鍵デバイスがありません。鍵デバイス管理で登録してください
            </Notice>
          )}
          <p className="mt-3 text-sm">
            <TextLink href="/admin/lock-devices">鍵デバイス管理へ</TextLink>
          </p>
        </Card>
      </div>
    </>
  )
}
