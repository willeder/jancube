import 'server-only'
import type { CreateHoldInput } from '@jancube/application'
import { cookies } from 'next/headers'

/**
 * Where a booking comes from, for bookings.source and the acquisition columns (F-RPT-05).
 *
 * - `jc_channel=liff` is set when the customer enters through the LIFF app (/liff), so bookings
 *   made in the LINE app are saved with source 'liff'.
 * - `jc_acq` keeps the latest UTM tags seen on a booking page (recorded by /api/funnel) for 30 days.
 *
 * The booking flow passes both to createHold:
 *   `c.createHold({ ...input, ...(await readBookingAttribution()) })`
 */
const CHANNEL = 'jc_channel'
const CHANNEL_HOURS = 12
const ACQUISITION = 'jc_acq'
const ACQUISITION_DAYS = 30

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const

const secure = () => process.env.NODE_ENV === 'production'

/** Cookie values and the database columns are ASCII; keep tags short and plain. */
const clean = (value: string | null | undefined, max: number) => {
  const text = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._\-~]/g, '_')
    .slice(0, max)
  return text ? text : null
}

export async function markLiffChannel(): Promise<void> {
  ;(await cookies()).set(CHANNEL, 'liff', {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: CHANNEL_HOURS * 3600,
  })
}

export async function readBookingChannel(): Promise<'web' | 'liff'> {
  return (await cookies()).get(CHANNEL)?.value === 'liff' ? 'liff' : 'web'
}

/** Remembers UTM tags from a landing URL (only when at least utm_source is present). */
export async function rememberAcquisition(params: URLSearchParams): Promise<string | null> {
  const tags = Object.fromEntries(UTM_KEYS.map((k) => [k, clean(params.get(k), 100)]))
  if (!tags.utm_source) return null
  ;(await cookies()).set(
    ACQUISITION,
    new URLSearchParams(tags as Record<string, string>).toString(),
    {
      httpOnly: true,
      secure: secure(),
      sameSite: 'lax',
      path: '/',
      maxAge: ACQUISITION_DAYS * 86_400,
    },
  )
  return tags.utm_source
}

/** `source` and `acquisition` for createHold. LIFF bookings count as acquisition source 'line'. */
export async function readBookingAttribution(): Promise<
  Pick<CreateHoldInput, 'source' | 'acquisition'>
> {
  const source = await readBookingChannel()
  const saved = new URLSearchParams((await cookies()).get(ACQUISITION)?.value ?? '')
  const utmSource = clean(saved.get('utm_source'), 64)
  return {
    source,
    acquisition: {
      source: source === 'liff' ? 'line' : (utmSource ?? undefined),
      utmSource: clean(saved.get('utm_source'), 100) ?? undefined,
      utmMedium: clean(saved.get('utm_medium'), 100) ?? undefined,
      utmCampaign: clean(saved.get('utm_campaign'), 100) ?? undefined,
      utmContent: clean(saved.get('utm_content'), 100) ?? undefined,
    },
  }
}
