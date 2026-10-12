import type { Clock } from '../ports/clock'
import { FUNNEL_STEPS, type FunnelEventRepository, type FunnelStep } from '../ports/reports'
import type { StoreRepository } from '../ports/store-repository'

export interface FunnelDeps {
  readonly funnel: FunnelEventRepository
  readonly stores: Pick<StoreRepository, 'findActiveByCode'>
  readonly clock: Clock
}

const VISITOR_KEY = /^[A-Za-z0-9-]{16,64}$/

export function isFunnelStep(value: string): value is FunnelStep {
  return (FUNNEL_STEPS as readonly string[]).includes(value)
}

/**
 * F-RPT-01: record one booking-funnel step for an anonymous visitor. Analytics must never break the
 * booking flow, so invalid input is ignored (returns false) instead of raising errors.
 */
export function makeRecordFunnelEvent(deps: FunnelDeps) {
  return async function recordFunnelEvent(input: {
    visitorKey: string
    step: string
    channel: 'web' | 'liff'
    storeCode?: string | null
    memberId?: number | null
    utmSource?: string | null
  }): Promise<boolean> {
    if (!VISITOR_KEY.test(input.visitorKey) || !isFunnelStep(input.step)) return false
    const store = input.storeCode ? await deps.stores.findActiveByCode(input.storeCode) : null
    if (input.storeCode && !store) return false
    await deps.funnel.record({
      visitorKey: input.visitorKey,
      step: input.step,
      channel: input.channel,
      storeId: store?.id ?? null,
      memberId: input.memberId ?? null,
      utmSource: input.utmSource?.slice(0, 191) || null,
      occurredAt: deps.clock.now(),
    })
    return true
  }
}
