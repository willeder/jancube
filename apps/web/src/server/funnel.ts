import 'server-only'
import type { FunnelStep } from '@jancube/application'
import { cookies } from 'next/headers'
import { readBookingChannel } from './booking-attribution'
import { withContainer } from './container'
import { readSessionMemberId } from './session'

/**
 * F-RPT-01 funnel events. A random first-party visitor key (`jc_vid`) lets the report count
 * distinct visitors per step; it identifies nothing else. Usable from server actions and route
 * handlers (they may set cookies), never from page rendering.
 */
const VISITOR = 'jc_vid'
const VISITOR_DAYS = 90

async function visitorKey(): Promise<string> {
  const jar = await cookies()
  const existing = jar.get(VISITOR)?.value
  if (existing && /^[A-Za-z0-9-]{16,64}$/.test(existing)) return existing
  const key = crypto.randomUUID()
  jar.set(VISITOR, key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: VISITOR_DAYS * 86_400,
  })
  return key
}

/** Records a funnel step. Analytics never break the customer flow: failures are only logged. */
export async function trackFunnel(
  step: FunnelStep | string,
  context: {
    storeCode?: string | null
    utmSource?: string | null
    /** Overrides the session (e.g. right after sign-in, before the cookie is sent back). */
    memberId?: number | null
  } = {},
): Promise<void> {
  try {
    const [key, channel, sessionMemberId] = await Promise.all([
      visitorKey(),
      readBookingChannel(),
      readSessionMemberId(),
    ])
    const memberId = context.memberId !== undefined ? context.memberId : sessionMemberId
    await withContainer((c) =>
      c.recordFunnelEvent({
        visitorKey: key,
        step,
        channel,
        storeCode: context.storeCode ?? null,
        memberId,
        utmSource: context.utmSource ?? null,
      }),
    )
  } catch (error) {
    console.warn('[funnel] event not recorded:', error instanceof Error ? error.message : error)
  }
}
