import { StatusScreen } from '@/components/StatusScreen'

/** Unmatched URLs (outside any route group). Same pattern as C-21. */
export default function NotFound() {
  return (
    <StatusScreen
      icon="🔍"
      title="ページが見つかりません"
      action={{ href: '/', label: 'トップへ戻る' }}
    >
      URLが間違っているか、ページが移動・削除された可能性があります
    </StatusScreen>
  )
}
