import type { LocalDate } from '../time/zoned-time'

export type StoreStatus = 'preparing' | 'open' | 'closed'

export interface Store {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly address: string
  readonly accessText: string | null
  readonly mapUrl: string | null
  readonly timezone: string
  readonly status: StoreStatus
  readonly isActive: boolean
  readonly booking: StoreBookingSettings
}

/** Per-store booking settings (stores table). Values are configurable; several are still open questions. */
export interface StoreBookingSettings {
  /** First usage date taken by the new system (cutover; earlier dates stay on the old system). */
  readonly openDate: LocalDate
  /** How many days ahead customers can book (Q20). */
  readonly horizonDays: number
  /** How long a slot is held while the customer pays (Q21). */
  readonly holdMinutes: number
  /** Payment-link hold for phone bookings (Q22). */
  readonly proxyHoldMinutes: number
  /** Cleaning time kept free after every booking (Q19). */
  readonly cleaningBufferMinutes: number
}
