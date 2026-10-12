import { assertYen, type Yen } from '../shared/money'

/**
 * How the price difference of a booking change (C-14, F-BK-14 provisional) is settled:
 * - same price: nothing to do
 * - cheaper: the difference is refunded to the original payment
 * - more expensive: not accepted online in Phase 1 (collecting an additional payment is not built);
 *   the customer can cancel free of charge and book again, or ask the store.
 */
export type ChangeSettlement =
  | { readonly kind: 'none' }
  | { readonly kind: 'refund'; readonly amount: Yen }
  | { readonly kind: 'increase_not_allowed'; readonly amount: Yen }

export function changeSettlement(currentTotal: Yen, newTotal: Yen): ChangeSettlement {
  assertYen(currentTotal, 'currentTotal')
  assertYen(newTotal, 'newTotal')
  if (newTotal === currentTotal) return { kind: 'none' }
  if (newTotal < currentTotal) return { kind: 'refund', amount: currentTotal - newTotal }
  return { kind: 'increase_not_allowed', amount: newTotal - currentTotal }
}
