import type { PaymentGateway } from '../ports/checkout'
import type { Clock } from '../ports/clock'
import type { HoldExpiryRepository } from '../ports/operations'

/**
 * Minute job: holds whose time ran out (C-04 仮押さえ) become expired. Their open checkout sessions
 * are expired at the payment provider first; a session that was paid in the meantime is left to the
 * payment webhook (which confirms or refunds it), so money is never orphaned.
 */
export function makeExpireHolds(deps: {
  readonly holds: HoldExpiryRepository
  readonly gateway: PaymentGateway
  readonly clock: Clock
}) {
  return async function expireHolds(limit = 100) {
    const now = deps.clock.now()
    let expired = 0
    let skipped = 0
    for (const hold of await deps.holds.expiredHolds(now, limit)) {
      let paid = false
      for (const checkoutId of hold.checkoutIds) {
        try {
          await deps.gateway.expireCheckout(checkoutId)
        } catch {
          // Already completed or expired at the provider: find out which.
          const state = await deps.gateway.getCheckout(checkoutId).catch(() => null)
          if (!state || state.paid || state.status === 'complete') paid = true
        }
      }
      if (paid) {
        skipped++
        continue
      }
      if (await deps.holds.expireHold(hold.bookingId, now)) expired++
    }
    return { expired, skipped }
  }
}
