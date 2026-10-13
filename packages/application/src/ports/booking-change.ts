import type { LocalDate, PriceQuote } from '@jancube/domain'
import type { StoreInventory } from './inventory-repository'

/** What a booking change (C-14) starts from. */
export interface ChangeTarget {
  readonly id: number
  readonly bookingCode: string
  readonly status: string
  readonly memberId: number | null
  readonly storeId: number
  readonly storeCode: string
  readonly timezone: string
  readonly roomGroupId: number
  readonly roomTypeId: number
  readonly requestedRoomId: number | null
  readonly assignedRoomId: number | null
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly guestCount: number
  readonly subtotal: number
  readonly discount: number
  readonly total: number
  /** Applied coupon (one per booking). */
  readonly couponGrantId: number | null
  /** bookings.lock_version (optimistic check when the change is written). */
  readonly lockVersion: number
}

/** booking_change_history before/after values. */
export interface BookingChangeValues {
  readonly businessDate: LocalDate
  readonly start: string
  readonly end: string
  readonly roomGroupId: number
  readonly requestedRoomId: number | null
  readonly assignedRoomId: number | null
  readonly guestCount: number
  readonly subtotal: number
  readonly discount: number
  readonly total: number
}

export interface LockedChangeTx {
  /** Inventory re-read inside the locks. */
  loadInventory(storeId: number, from: Date, to: Date, now: Date): Promise<StoreInventory>
  /**
   * One transaction: move the booking (optimistic on lock_version), store a new price calculation,
   * update the coupon discount, release the room assignment (re-assigned by the batch), record
   * booking_change_history and queue a `booking.changed` outbox event.
   * Idempotent on `requestKey`: a repeated request returns the first change.
   */
  applyChange(input: {
    readonly bookingId: number
    readonly expectedLockVersion: number
    readonly memberId: number
    readonly policyDocumentId: number
    readonly policyCheckedAt: Date
    readonly changedAt: Date
    readonly requestKey: string
    readonly roomGroupId: number
    readonly requestedRoomId: number | null
    readonly businessDate: LocalDate
    readonly start: Date
    readonly end: Date
    readonly priceVersionId: number
    readonly taxRatePercent: number
    readonly quote: PriceQuote
    readonly discount: number
    readonly before: BookingChangeValues
    readonly after: BookingChangeValues
  }): Promise<{ historyId: number; duplicate: boolean }>
}

export interface BookingChangeRepository {
  changeTarget(bookingCode: string): Promise<ChangeTarget | null>
  /**
   * Runs `fn` in one transaction holding the inventory_day_locks rows of every (group, date) given,
   * taken in a fixed order so two changes cannot deadlock each other.
   */
  withInventoryLocks<T>(
    locks: readonly { readonly roomGroupId: number; readonly businessDate: LocalDate }[],
    fn: (tx: LockedChangeTx) => Promise<T>,
  ): Promise<T>
}
