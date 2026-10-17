import type { LocalDate } from '@jancube/domain'
import type { BookingStatus } from './booking-repository'
import type { PaymentMethod } from './checkout'
import type { LegalDocumentType, MemberStatus } from './member-repository'

/** How far the room of a booking is fixed. */
export type RoomAssignmentState = 'named' | 'final' | 'provisional' | 'none'

/** C-12: one booking of the member (any store). Drafts and lapsed holds are not listed. */
export interface MemberBookingRow {
  readonly bookingCode: string
  readonly status: BookingStatus
  readonly storeCode: string
  readonly storeName: string
  readonly timezone: string
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly roomGroupName: string
  /** Requested (named) room, else the currently assigned room. */
  readonly roomName: string | null
  readonly assignment: RoomAssignmentState
  readonly total: number
}

export interface BookingStoreInfo {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly address: string
  readonly phone: string | null
  readonly accessText: string | null
  readonly mapUrl: string | null
  readonly entryGuideText: string | null
  readonly timezone: string
}

/** C-13 予約詳細 (read model; secrets stay encrypted until the use case decides to show them). */
export interface MemberBookingDetail {
  readonly bookingName?: string
  readonly roomGuide?: { photoUrl: string | null; location: string | null }
  readonly id: number
  readonly bookingCode: string
  readonly status: BookingStatus
  readonly memberId: number | null
  readonly store: BookingStoreInfo
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly guestCount: number
  readonly acquisitionSource: string | null
  readonly roomGroupId: number
  readonly roomTypeId: number
  readonly roomGroupName: string
  readonly capacity: number
  readonly requestedRoom: { readonly name: string; readonly code: string } | null
  readonly assignedRoom: {
    readonly name: string
    readonly code: string
    readonly status: 'provisional' | 'final'
  } | null
  readonly price: {
    readonly durationMinutes: number
    /** Hourly price before package/time discounts. */
    readonly regularPrice: number
    readonly packageDiscount: number
    readonly subtotal: number
    readonly discount: number
    readonly total: number
    readonly taxRatePercent: number
  }
  readonly coupon: {
    readonly grantId: number
    readonly name: string
    readonly discount: number
  } | null
  /** Succeeded payments, newest first. */
  readonly payments: readonly {
    readonly id: number
    readonly method: PaymentMethod | 'other'
    readonly amount: number
    readonly paidAt: Date
  }[]
  /** Refunds requested, in progress or done. */
  readonly refunds: readonly {
    readonly amount: number
    readonly status: 'requested' | 'processing' | 'succeeded' | 'failed'
    readonly reason: string
  }[]
  readonly cancellation: {
    readonly requestedAt: Date
    readonly feeRate: number
    readonly fee: number
    readonly refund: number
  } | null
  /** The current entry key of the booking, if one has been created. */
  readonly accessKey: {
    readonly status: string
    readonly validFrom: Date
    readonly validTo: Date
    readonly codeCiphertext: Uint8Array | null
  } | null
  readonly changeCount: number
}

/** C-16: a coupon granted to the member, with its conditions and usage. */
export interface MemberCouponGrant {
  readonly grantId: number
  readonly couponName: string
  readonly couponActive: boolean
  readonly conditionsNote: string | null
  readonly discountType: 'amount' | 'percent'
  readonly discountValue: number
  readonly maximumDiscount: number | null
  readonly minimumSpend: number
  readonly maxUses: number
  /** Redemptions reserved or applied. */
  readonly used: number
  readonly lastUsedAt: Date | null
  readonly validFrom: Date
  readonly expiresAt: Date
  readonly revokedAt: Date | null
  readonly weekdayMask: number
  readonly startMinute: number | null
  readonly endMinute: number | null
  /** Empty = all stores. */
  readonly storeCodes: readonly string[]
}

/** C-17 会員情報. */
export interface MemberAccount {
  readonly notificationChannel?: 'email' | 'line'
  readonly id: number
  readonly memberCode: string
  readonly phone: string | null
  readonly familyName: string | null
  readonly givenName: string | null
  readonly email: string | null
  readonly status: MemberStatus
  readonly line: {
    readonly friendStatus: 'unknown' | 'friend' | 'blocked'
    readonly linkedAt: Date
  } | null
}

export interface MyPageRepository {
  memberBookings(memberId: number): Promise<MemberBookingRow[]>
  bookingDetail(bookingCode: string): Promise<MemberBookingDetail | null>
  couponGrants(memberId: number): Promise<MemberCouponGrant[]>
  account(memberId: number): Promise<MemberAccount | null>
  updateEmail(memberId: number, email: string | null): Promise<void>
  updateNotificationChannel(memberId: number, channel: 'email' | 'line'): Promise<void>
  /** Confirmed bookings that have not ended yet. */
  upcomingBookingCount(memberId: number, now: Date): Promise<number>
  /**
   * F-AUTH-07: status withdrawn and personal data removed from the member (name, phone, email),
   * the LINE link deleted and contact phone/email cleared from the member's bookings. Booking,
   * payment and receipt records stay (accounting).
   */
  withdraw(memberId: number, at: Date): Promise<void>
}

/** C-20: a published version of a legal document. */
export interface LegalDocumentView {
  readonly type: LegalDocumentType
  readonly version: string
  readonly title: string
  readonly publishedAt: Date
  readonly effectiveAt: Date
}

export interface LegalTextRepository {
  currentDocument(type: LegalDocumentType, at: Date): Promise<LegalDocumentView | null>
}
