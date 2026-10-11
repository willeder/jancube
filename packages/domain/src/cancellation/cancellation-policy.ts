import { assertYen, floorYen, type Yen } from '../shared/money'

/**
 * Cancellation fee tiers (FR-2.9, confirmed 2026-09-26):
 *   - 24 hours or more before start: 0% (exactly 24 hours counts as free)
 *   - less than 24 hours before start: 50%
 *   - at or after start: 100%
 * Kept as data so a new policy version can be introduced without code changes.
 */
export interface CancellationPolicy {
  readonly freeUntilMinutesBefore: number
  readonly beforeStartPercent: number
  readonly afterStartPercent: number
}

export const STANDARD_CANCELLATION_POLICY: CancellationPolicy = {
  freeUntilMinutesBefore: 24 * 60,
  beforeStartPercent: 50,
  afterStartPercent: 100,
}

export interface CancellationFee {
  readonly percent: number
  readonly fee: Yen
  readonly refund: Yen
}

export function calculateCancellationFee(input: {
  readonly startAt: Date
  readonly cancelledAt: Date
  readonly paidAmount: Yen
  readonly policy?: CancellationPolicy
}): CancellationFee {
  const policy = input.policy ?? STANDARD_CANCELLATION_POLICY
  const paid = assertYen(input.paidAmount, 'paidAmount')
  const percent = feePercent(input.startAt, input.cancelledAt, policy)
  const fee = floorYen((paid * percent) / 100)
  return { percent, fee, refund: paid - fee }
}

function feePercent(startAt: Date, at: Date, policy: CancellationPolicy): number {
  const minutesBefore = (startAt.getTime() - at.getTime()) / 60_000
  if (minutesBefore <= 0) return policy.afterStartPercent
  if (minutesBefore >= policy.freeUntilMinutesBefore) return 0
  return policy.beforeStartPercent
}

/**
 * Date changes are not allowed while a cancellation fee would apply (2026-10-01 minutes), so a
 * customer cannot avoid the fee by moving the booking. The boundary values follow the fee tiers.
 */
export function isDateChangeAllowed(
  startAt: Date,
  at: Date,
  policy: CancellationPolicy = STANDARD_CANCELLATION_POLICY,
): boolean {
  return feePercent(startAt, at, policy) === 0
}
