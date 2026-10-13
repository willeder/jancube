import type { DayAvailability, IssuedPaymentLink } from '@jancube/application'
import { addDays, utcToLocal, visibleStoreIds } from '@jancube/domain'
import { DEFAULT_TIMEZONE, shortDateTime } from '@/components/admin/booking-format'
import {
  Badge,
  buttonClass,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
  TextLink,
} from '@/components/admin/ui'
import { yen } from '@/lib/format'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { ProxyBookingForm } from './ProxyBookingForm'

export const dynamic = 'force-dynamic'

/** A-06 代理予約作成 (F-ADM-09): phone bookings held for the customer with a payment link. */
export default async function ProxyBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; date?: string }>
}) {
  const staff = await requireStaff('bookings.manage')
  const q = await searchParams
  const today = utcToLocal(new Date(), DEFAULT_TIMEZONE).date

  const loaded = await withContainer(async (c) => {
    const selected = await selectedStoreId(staff, 'bookings.manage')
    const visible = visibleStoreIds(staff.access, 'bookings.manage')
    const stores = (await c.listAdminStores()).filter(
      (s) =>
        (visible === null || visible.includes(s.id)) && (selected === null || s.id === selected),
    )
    const store = stores.find((s) => s.code === q.store) ?? stores[0]
    // Default to the first date the store takes bookings in the new system (cutover).
    const date =
      q.date || (store && store.booking.openDate > today ? store.booking.openDate : today)
    let day: DayAvailability | null = null
    let error: string | null = null
    if (store) {
      try {
        day = await c.adminDayAvailability(store.code, date)
      } catch (e) {
        error = toUserMessage(e)
      }
    }
    // Links issued since the start of today (store time).
    const since = new Date(`${today}T00:00:00+09:00`)
    const links: IssuedPaymentLink[] = await c
      .listPaymentLinks(staff.access, selected, since)
      .catch(() => [])
    return { stores, store, date, day, error, links }
  })
  const { stores, store, date, day, error, links } = loaded
  const now = new Date()

  return (
    <>
      <PageHeader
        title="代理予約作成"
        description="お電話でのご予約を仮押さえし、お客様へ決済リンクをお送りします"
      />
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4">
        <Field label="店舗">
          <select name="store" defaultValue={store?.code} className={inputClass}>
            {stores.map((s) => (
              <option key={s.id} value={s.code}>
                {s.code} {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="日付">
          <input
            type="date"
            name="date"
            defaultValue={date}
            min={today}
            max={addDays(today, 90)}
            className={inputClass}
          />
        </Field>
        <button type="submit" className={buttonClass.secondary}>
          空き状況を表示
        </button>
      </form>

      {!store && <Notice tone="red">代理予約できる店舗がありません</Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      {day && <ProxyBookingForm day={day} />}

      <section className="mt-6">
        <h2 className="mb-2 font-bold">発行済みリンク(本日)</h2>
        <Table
          head={['発行時刻', '予約番号', 'お客様', '金額', '期限', '状態']}
          rows={links.map((l) => [
            shortDateTime(l.issuedAt),
            <TextLink key="c" href={`/admin/bookings/${l.bookingCode}`}>
              {l.bookingCode}
            </TextLink>,
            l.customerName ?? '—',
            yen(l.total),
            shortDateTime(l.expiresAt),
            l.usedAt || l.bookingStatus === 'confirmed' ? (
              <Badge key="s" tone="green">
                決済済
              </Badge>
            ) : l.revokedAt || l.expiresAt <= now || l.bookingStatus !== 'draft' ? (
              <Badge key="s" tone="red">
                期限切れ
              </Badge>
            ) : (
              <Badge key="s" tone="gold">
                未決済
              </Badge>
            ),
          ])}
          empty="本日発行したリンクはありません"
        />
        <p className="mt-2 text-xs text-sub">
          リンクはお支払い期限（仮押さえ期限と同じ・CQ-23確認中）を過ぎると無効になり、仮押さえは自動で解放されます。
          リンクのURLは発行直後の画面にのみ表示されます（保存しているのはハッシュ値のみ）
        </p>
      </section>
    </>
  )
}
