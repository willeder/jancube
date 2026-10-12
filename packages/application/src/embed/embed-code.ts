import { DomainError } from '@jancube/domain'

export type EmbedTheme = 'light' | 'dark'

export const EMBED_DAY_CHOICES = [1, 3, 7] as const

export interface EmbedOptions {
  /** Public base URL of the booking site, e.g. https://jancube.net */
  readonly baseUrl: string
  readonly storeCode: string
  readonly storeName: string
  /** Days shown by the availability widget at first (Figma A-29: 3; CQ-72 open). */
  readonly days: number
  readonly theme: EmbedTheme
  /** Iframe height in px. */
  readonly height?: number
}

export interface EmbedSnippets {
  /** C-23 availability widget URL (the iframe source). */
  readonly widgetUrl: string
  /** Store's booking start page with UTM tags, used by the link button. */
  readonly bookingUrl: string
  readonly iframe: string
  readonly linkButton: string
  /** Same widget through the WordPress plugin (integrations/wordpress/jancube-availability). */
  readonly shortcode: string
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A-29 埋め込みコード発行 (F-EMB-02): iframe for the availability widget and a plain link button,
 * both tagged so bookings from the website are counted as acquisition source "website" (F-RPT-05).
 */
export function buildEmbedSnippets(options: EmbedOptions): EmbedSnippets {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(options.storeCode)) {
    throw new DomainError('store_not_found', 'invalid store code')
  }
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(options.baseUrl)) {
    throw new DomainError('invalid_url', 'the base URL must be an http(s) URL without query')
  }
  const origin = options.baseUrl.replace(/\/+$/, '')
  const days = Math.min(14, Math.max(1, Math.trunc(options.days) || 3))
  const height = Math.min(1200, Math.max(200, Math.trunc(options.height ?? 360)))
  const theme: EmbedTheme = options.theme === 'dark' ? 'dark' : 'light'
  const store = encodeURIComponent(options.storeCode)

  const widgetUrl = `${origin}/embed/availability/${store}?days=${days}&theme=${theme}`
  const bookingUrl = `${origin}/booking/${store}/date?utm_source=website&utm_medium=referral&utm_campaign=hp_button`

  const title = escapeHtml(`雀CUBE ${options.storeName} 空き状況`)
  const iframe =
    `<iframe src="${escapeHtml(widgetUrl)}" title="${title}" width="100%" ` +
    `height="${height}" style="border:0;max-width:100%" loading="lazy"></iframe>`
  const dark = theme === 'dark'
  const linkButton =
    `<a href="${escapeHtml(bookingUrl)}" target="_blank" rel="noopener" ` +
    `style="display:inline-block;padding:12px 24px;border-radius:8px;` +
    `background:${dark ? '#ffffff' : '#007140'};color:${dark ? '#007140' : '#ffffff'};` +
    `font-weight:bold;text-decoration:none">` +
    `${escapeHtml(options.storeName)}を予約する</a>`
  const shortcode = `[jancube_availability store="${options.storeCode}" days="${days}" theme="${theme}" height="${height}"]`

  return {
    widgetUrl,
    bookingUrl,
    iframe,
    linkButton,
    shortcode,
  }
}
