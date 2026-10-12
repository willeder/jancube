import { rememberAcquisition } from '@/server/booking-attribution'
import { trackFunnel } from '@/server/funnel'

/** Steps the browser may report; later steps are counted from bookings and payments. */
const PAGE_STEPS = new Set(['store_selected', 'slots_viewed'])

/**
 * F-RPT-01: page-view beacon from booking pages (<FunnelBeacon>). Same-origin only; always answers
 * 204 so analytics never affect the page. UTM tags in the page URL are kept for the booking
 * (see server/booking-attribution.ts).
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) {
    return new Response(null, { status: 204 })
  }
  try {
    const data = (await request.json()) as { step?: unknown; store?: unknown; search?: unknown }
    const step = typeof data.step === 'string' ? data.step : ''
    if (!PAGE_STEPS.has(step)) return new Response(null, { status: 204 })
    const params = new URLSearchParams(typeof data.search === 'string' ? data.search : '')
    const utmSource = await rememberAcquisition(params)
    await trackFunnel(step, {
      storeCode: typeof data.store === 'string' ? data.store.slice(0, 32) : null,
      utmSource,
    })
  } catch {
    // Malformed beacons are ignored.
  }
  return new Response(null, { status: 204 })
}
