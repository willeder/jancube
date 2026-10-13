import { buildEmbedSnippets, EMBED_DAY_CHOICES, type EmbedSnippets } from '@jancube/application'
import { visibleStoreIds } from '@jancube/domain'
import { buttonClass, Card, Field, inputClass, Notice, PageHeader } from '@/components/admin/ui'
import { requireStaff, selectedStoreId } from '@/server/admin-session'
import { withContainer } from '@/server/container'
import { toUserMessage } from '@/server/errors'
import { runtimeConfig } from '@/server/runtime-config'
import { CopyField } from './CopyField'

export const dynamic = 'force-dynamic'

type Search = { store?: string; mode?: string; days?: string; theme?: string }

/**
 * A-29 埋め込みコード発行 (F-EMB-02): iframe for the C-23 availability widget, a link button, and the
 * WordPress shortcode (integrations/wordpress/jancube-availability).
 */
export default async function EmbedCodePage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff('stores.manage')
  const q = await searchParams
  const visible = visibleStoreIds(staff.access, 'stores.manage')
  const selected = await selectedStoreId(staff, 'stores.manage')
  const stores = (await withContainer((c) => c.listAdminStores())).filter(
    (s) => visible === null || visible.includes(s.id),
  )
  const store =
    stores.find((s) => s.code === q.store) ??
    stores.find((s) => s.id === selected) ??
    stores[0] ??
    null
  const mode = q.mode === 'button' ? 'button' : 'iframe'
  const days = EMBED_DAY_CHOICES.find((d) => String(d) === q.days) ?? 3
  const theme = q.theme === 'dark' ? 'dark' : 'light'

  let snippets: EmbedSnippets | null = null
  let error: string | null = null
  if (store) {
    try {
      // Snippets point at the public site (APP_URL).
      snippets = buildEmbedSnippets({
        baseUrl: runtimeConfig().appUrl,
        storeCode: store.code,
        storeName: store.name,
        days,
        theme,
      })
    } catch (e) {
      error = toUserMessage(e)
    }
  }
  // Preview from this server, whatever the public URL is.
  const preview = store
    ? `/embed/availability/${encodeURIComponent(store.code)}?days=${days}&theme=${theme}`
    : null

  return (
    <>
      <PageHeader
        title="埋め込みコード発行"
        description="既存ホームページ（WordPress）に貼り付ける空き状況ウィジェットと予約ボタンのコードを発行します"
      />

      <Card title="発行条件" className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="店舗">
              <select name="store" defaultValue={store?.code} className={inputClass}>
                {stores.map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.code} {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="表示方式">
              <select name="mode" defaultValue={mode} className={inputClass}>
                <option value="iframe">空き状況（iframe）</option>
                <option value="button">予約ボタン（リンク）</option>
              </select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="初期表示日数">
              <select name="days" defaultValue={String(days)} className={inputClass}>
                {EMBED_DAY_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-36">
            <Field label="テーマ">
              <select name="theme" defaultValue={theme} className={inputClass}>
                <option value="light">ライト</option>
                <option value="dark">ダーク</option>
              </select>
            </Field>
          </div>
          <button type="submit" className={buttonClass.primary}>
            コードを発行
          </button>
        </form>
        <p className="mt-2 text-xs text-sub">
          表示中以外の日付を選べるようにするかは未決です（CQ-72）。予約ボタンには流入元計測用のUTM（utm_source=website）が付きます
        </p>
      </Card>

      {error && <Notice tone="red">{error}</Notice>}
      {!store && <Notice tone="red">発行できる店舗がありません</Notice>}

      {snippets && store && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="埋め込みコード">
            <div className="space-y-4">
              {mode === 'iframe' ? (
                <CopyField label="HTML（iframe）" value={snippets.iframe} />
              ) : (
                <CopyField label="HTML（予約ボタン）" value={snippets.linkButton} />
              )}
              {mode === 'iframe' && (
                <CopyField label="WordPress ショートコード" value={snippets.shortcode} rows={2} />
              )}
              <p className="text-xs text-sub">
                WordPress では「雀CUBE
                空き状況」プラグイン（integrations/wordpress/jancube-availability）を
                有効化すると、ショートコードを固定ページや投稿に貼るだけで表示できます。
                プラグインを使わない場合は「カスタムHTML」ブロックにHTMLを貼り付けてください
              </p>
            </div>
          </Card>
          <Card title="プレビュー">
            {mode === 'iframe' && preview ? (
              <iframe
                src={preview}
                title={`雀CUBE ${store.name} 空き状況`}
                className="h-[360px] w-full rounded-lg border border-line"
                loading="lazy"
              />
            ) : (
              <div className={`rounded-lg p-6 ${theme === 'dark' ? 'bg-ink' : 'bg-paper'}`}>
                <a
                  href={snippets.bookingUrl}
                  target="_blank"
                  rel="noopener"
                  className={`inline-block rounded-lg px-6 py-3 font-bold ${
                    theme === 'dark' ? 'bg-white text-brand' : 'bg-brand text-white'
                  }`}
                >
                  {store.name}を予約する
                </a>
              </div>
            )}
            <p className="mt-2 break-all text-xs text-sub">
              {mode === 'iframe' ? snippets.widgetUrl : snippets.bookingUrl}
            </p>
          </Card>
        </div>
      )}
    </>
  )
}
