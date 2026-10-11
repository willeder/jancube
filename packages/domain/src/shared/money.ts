import { DomainError } from './errors'

/** Japanese yen, tax included, always a whole number. */
export type Yen = number

export function assertYen(value: number, label = 'amount'): Yen {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError('invalid_amount', `${label} must be a non-negative integer yen value`)
  }
  return value
}

/** Rounds a yen amount down (切り捨て). The project-wide rounding rule is still open (Q-12). */
export function floorYen(value: number): Yen {
  return Math.floor(value)
}
