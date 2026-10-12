import { StatusScreen } from '@/components/StatusScreen'

export const dynamic = 'force-dynamic'

/** C-21 仮押さえ期限切れ: shown when the hold countdown runs out. */
export default async function HoldExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const { store } = await searchParams
  const again = store && /^[A-Za-z0-9_-]{1,32}$/.test(store) ? `/booking/${store}/date` : '/'
  return (
    <StatusScreen
      icon="⏳"
      title="仮押さえの期限が切れました"
      action={{ href: again, label: 'もう一度予約する' }}
    >
      お手数ですが、もう一度お日にちと時間の選択からお願いします
    </StatusScreen>
  )
}
