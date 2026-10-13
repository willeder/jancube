import Link from 'next/link'
import { StatusScreen } from '@/components/StatusScreen'
import { maintenanceStatus } from '@/server/maintenance'

/** Customer-facing screens (C-xx): mobile-first with the 雀CUBE header. */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const maintenance = maintenanceStatus()
  return (
    <>
      <header className="bg-brand text-white print:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <Link href="/" className="font-bold">
            🀄 雀CUBE 予約
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs opacity-80">jancube.net</span>
            {/* Tracker #23 (open): permanent entry to the member's page; placed top right for now. */}
            <Link
              href="/mypage"
              aria-label="マイページ"
              className="flex size-8 items-center justify-center rounded-full bg-white/15"
            >
              👤
            </Link>
          </div>
        </div>
      </header>
      {maintenance.enabled ? (
        // C-21 メンテナンス (MAINTENANCE_MODE)
        <StatusScreen icon="🛠" title="ただいまメンテナンス中です">
          <p>{maintenance.message ?? 'ご予約の受付を一時停止しています。'}</p>
          <p className="mt-1">ご不便をおかけしますが、しばらくしてから再度アクセスしてください</p>
        </StatusScreen>
      ) : (
        children
      )}
    </>
  )
}
