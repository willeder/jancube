import { runtimeConfig } from '@/server/runtime-config'
import { LiffEntry } from './LiffEntry'

export const dynamic = 'force-dynamic'

/**
 * L-02 LIFFエントリ (F-LINE-01/02/04). LIFF endpoint URL: {APP_URL}/liff. The rich menu opens
 * https://liff.line.me/{LIFF_ID}; `?next=/path` continues to another page after sign-in.
 */
export default function LiffEntryPage() {
  const config = runtimeConfig()
  return (
    <main className="customer-content ">
      <LiffEntry
        liffId={config.line.liffId}
        devStandIn={config.isDevelopment && !config.line.loginChannelId}
      />
    </main>
  )
}
