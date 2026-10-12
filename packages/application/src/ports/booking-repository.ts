import type { LocalDate, PriceQuote } from '@jancube/domain'
import type { LockedConfirmationTx } from './checkout'
import type { StoreInventory } from './inventory-repository'

export interface NewDraftBooking {
  readonly storeId: number
  readonly roomGroupId: number
  readonly requestedRoomId: number | null
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly guestCount: number
  readonly source: 'web' | 'liff' | 'proxy'
  /** Staff member who took a phone booking (source = proxy, A-06). */
  readonly createdByStaffId: number | null
  /** Customer of a proxy booking (member when the phone number is registered). */
  readonly contact: DraftContact | null
  /** Random key identifying this hold (kept in an httpOnly cookie). Also the idempotency key. */
  readonly requestKey: string
  readonly holdExpiresAt: Date
  readonly priceVersionId: number
  readonly taxRatePercent: number
  readonly quote: PriceQuote
  readonly acquisition: {
    readonly source: string | null
    readonly utmSource: string | null
    readonly utmMedium: string | null
    readonly utmCampaign: string | null
    readonly utmContent: string | null
  }
}

export type BookingStatus = 'draft' | 'confirmed' | 'completed' | 'canceled' | 'expired'

/** What the booking screens show about a booking in progress. */
export interface BookingSummary {
  readonly id: number
  readonly bookingCode: string
  readonly status: BookingStatus
  readonly storeId: number
  readonly storeCode: string
  readonly storeName: string
  readonly timezone: string
  readonly businessDate: LocalDate
  readonly roomGroupId: number
  readonly roomTypeId: number
  readonly roomGroupName: string
  readonly requestedRoomId: number | null
  readonly requestedRoomName: string | null
  readonly capacity: number
  readonly start: Date
  readonly end: Date
  readonly guestCount: number
  readonly holdExpiresAt: Date | null
  readonly memberId: number | null
  readonly regularPrice: number
  readonly subtotal: number
  readonly discount: number
  readonly total: number
}

/** Operations that run while holding the inventory lock for one room group and business date. */
export interface LockedBookingTx extends LockedConfirmationTx {
  /** Inventory re-read inside the lock (sees holds created by concurrent requests). */
  loadInventory(storeId: number, from: Date, to: Date, now: Date): Promise<StoreInventory>
  createDraft(draft: NewDraftBooking): Promise<{ id: number; bookingCode: string }>
}

export interface BookingRepository {
  /**
   * Runs `fn` in a transaction holding the inventory_day_locks row for (roomGroupId, businessDate).
   * Every path that changes inventory must take this lock (design rule 在庫排他).
   */
  withInventoryLock<T>(
    roomGroupId: number,
    businessDate: LocalDate,
    fn: (tx: LockedBookingTx) => Promise<T>,
  ): Promise<T>
  findByRequestKey(requestKey: string): Promise<BookingSummary | null>
  findByCode(bookingCode: string): Promise<BookingSummary | null>
  /** Ends a draft early (customer changed their selection). No-op unless it is still a draft. */
  expireDraft(requestKey: string, now: Date): Promise<void>
  setGuestCount(requestKey: string, guestCount: number): Promise<void>
  /** Links the signed-in member to the draft and snapshots their contact details. */
  assignMember(requestKey: string, member: BookingContact): Promise<void>
}

/** Contact snapshot of a booking; `memberId` is null for a phone booking of a non-member. */
export interface DraftContact {
  readonly memberId: number | null
  readonly familyName: string | null
  readonly givenName: string | null
  readonly phone: string | null
  readonly email: string | null
}

export interface BookingContact {
  readonly memberId: number
  readonly familyName: string | null
  readonly givenName: string | null
  readonly phone: string | null
  readonly email: string | null
}
