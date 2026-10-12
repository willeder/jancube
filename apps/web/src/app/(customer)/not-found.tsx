import { StatusScreen } from '@/components/StatusScreen'

/** C-21: page not found on customer screens. */
export default function CustomerNotFound() {
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
