import type { LocalDate } from '@jancube/domain'
import type { BookingStatus } from './booking-repository'
import type { PaymentMethod } from './checkout'
import type { StoreInventory } from './inventory-repository'
import type { AlertSeverity } from './ops'

/** Stores a staff query may read; null = every store (all-store roles only). */
export type StoreFilter = readonly number[] | null

// ---------------------------------------------------------------- bookings (A-02〜A-05)

/** One booking as listed on the admin screens. */
export interface AdminBookingRow {
  readonly id: number
  readonly bookingCode: string
  readonly status: BookingStatus
  readonly source: string
  readonly storeId: number
  readonly storeCode: string
  readonly timezone: string
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly roomGroupName: string
  /** Assigned room, otherwise the requested (named) room; null while waiting for assignment. */
  readonly roomName: string | null
  readonly assignmentStatus: 'provisional' | 'final' | null
  readonly customerName: string | null
  readonly phone: string | null
  readonly guestCount: number
  readonly total: number
  readonly holdExpiresAt: Date | null
  readonly memberId: number | null
}

export interface BookingSearchFilter {
  readonly stores: StoreFilter
  readonly dateFrom?: LocalDate | null
  readonly dateTo?: LocalDate | null
  readonly statuses?: readonly BookingStatus[] | null
  /** Part of the booking code. */
  readonly code?: string | null
  /** Part of the customer's name (contact snapshot or member). */
  readonly name?: string | null
  /** Digits of the phone number (any part). */
  readonly phoneDigits?: string | null
  readonly source?: string | null
  readonly offset: number
  readonly limit: number
}

export interface DailySales {
  readonly date: LocalDate
  readonly amount: number
  readonly count: number
}

export interface SourceBreakdown {
  /** acquisition_source, or the booking channel (web / liff / line / proxy) when none was recorded. */
  readonly source: string
  readonly count: number
  readonly amount: number
}

export interface TimelineRoom {
  readonly id: number
  readonly groupId: number
  readonly groupName: string
  readonly bookingMode: 'group' | 'named'
  readonly code: string
  readonly name: string
  readonly operatingStatus: 'active' | 'paused' | 'broken'
  readonly cleaningStatus: 'clean' | 'dirty'
}

export interface TimelineBooking {
  readonly bookingCode: string
  readonly status: BookingStatus
  readonly groupId: number
  /** Assigned room, otherwise requested room; null = group booking waiting for assignment. */
  readonly roomId: number | null
  readonly assignmentStatus: 'provisional' | 'final' | null
  readonly start: Date
  readonly end: Date
  readonly customerName: string | null
  readonly guestCount: number
  readonly holdExpiresAt: Date | null
}

export interface TimelineBlock {
  readonly id: number
  readonly roomId: number
  readonly start: Date
  readonly end: Date
  readonly reason: string
}

export interface BookingDetail {
  readonly booking: AdminBookingRow & {
    readonly storeName: string
    readonly roomGroupId: number
    readonly requestedRoomName: string | null
    readonly createdAt: Date
    readonly confirmedAt: Date | null
    readonly createdByStaffName: string | null
    readonly acquisitionSource: string | null
    readonly utm: string | null
    readonly contactEmail: string | null
    readonly subtotal: number
    readonly discount: number
  }
  readonly member: {
    readonly id: number
    readonly memberCode: string
    readonly name: string | null
    readonly phone: string | null
    readonly email: string | null
    readonly status: string
    readonly lineLinked: boolean
  } | null
  readonly cancellation: {
    readonly requestedAt: Date
    readonly automaticFeeRate: number
    readonly appliedFeeRate: number
    readonly paidAmount: number
    readonly feeAmount: number
    readonly refundAmount: number
    readonly reason: string | null
    readonly staffName: string | null
    readonly manualOverride: boolean
  } | null
  readonly priceCalculations: readonly {
    readonly revisionNo: number
    readonly durationMinutes: number
    readonly baseAmount: number
    readonly packageDiscount: number
    readonly timeDiscount: number
    readonly couponDiscount: number
    readonly total: number
    readonly taxRate: number
    readonly createdAt: Date
  }[]
  readonly payments: readonly {
    readonly id: number
    readonly method: string
    readonly status: string
    readonly amount: number
    readonly provider: string
    readonly paidAt: Date | null
    readonly createdAt: Date
    readonly failureMessage: string | null
  }[]
  readonly refunds: readonly {
    readonly id: number
    readonly status: string
    readonly amount: number
    readonly reason: string
    readonly createdAt: Date
    readonly refundedAt: Date | null
    readonly failureMessage: string | null
  }[]
  readonly coupons: readonly {
    readonly couponName: string
    readonly discount: number
    readonly status: string
  }[]
  readonly assignments: readonly {
    readonly roomName: string
    readonly status: string
    readonly source: string
    readonly assignedAt: Date
    readonly releasedAt: Date | null
    readonly reason: string | null
    readonly staffName: string | null
  }[]
  readonly keys: readonly {
    readonly id: number
    readonly deviceName: string
    readonly status: string
    readonly validFrom: Date
    readonly validTo: Date
    readonly issuedAt: Date | null
    readonly revokedAt: Date | null
  }[]
  readonly keyEvents: readonly {
    readonly occurredAt: Date
    readonly eventType: string
    readonly result: string
    readonly errorCode: string | null
    readonly deviceName: string
  }[]
  readonly notifications: readonly {
    readonly id: number
    readonly event: string
    readonly channel: string
    readonly status: string
    readonly scheduledAt: Date
    readonly sentAt: Date | null
    readonly attempts: readonly {
      readonly attemptNo: number
      readonly result: string
      readonly error: string | null
      readonly at: Date
    }[]
  }[]
  readonly changes: readonly {
    readonly changedAt: Date
    readonly actor: string
    readonly before: unknown
    readonly after: unknown
    readonly reason: string | null
  }[]
  readonly audit: readonly {
    readonly occurredAt: Date
    readonly actor: string
    readonly action: string
    readonly before: unknown
    readonly after: unknown
    readonly reason: string | null
  }[]
  readonly paymentLinks: readonly {
    readonly createdAt: Date
    readonly expiresAt: Date
    readonly usedAt: Date | null
    readonly revokedAt: Date | null
    readonly issuedByName: string | null
  }[]
}

/** Read models of the admin booking screens (store scoping is applied by the caller's filter). */
export interface AdminBookingQueries {
  search(filter: BookingSearchFilter): Promise<{ rows: AdminBookingRow[]; total: number }>
  detail(bookingCode: string): Promise<BookingDetail | null>
  /** Confirmed/completed bookings per business date in [from, to]. */
  dailySales(stores: StoreFilter, from: LocalDate, to: LocalDate): Promise<DailySales[]>
  /** Booked room-minutes of confirmed/completed bookings with business date in [from, to]. */
  bookedMinutes(stores: StoreFilter, from: LocalDate, to: LocalDate): Promise<number>
  sources(stores: StoreFilter, from: LocalDate, to: LocalDate): Promise<SourceBreakdown[]>
  /** Confirmed group bookings from `from` onward that have no room yet. */
  unassignedCount(stores: StoreFilter, from: LocalDate): Promise<number>
  /** Rooms in service whose current cleaning status is dirty. */
  dirtyRoomCount(stores: StoreFilter): Promise<number>
  /** Rooms in service per store (capacity of the utilization rate). */
  activeRoomCounts(stores: StoreFilter): Promise<{ storeId: number; rooms: number }[]>
  timeline(
    storeId: number,
    from: Date,
    to: Date,
    now: Date,
  ): Promise<{ rooms: TimelineRoom[]; bookings: TimelineBooking[]; blocks: TimelineBlock[] }>
}

// ---------------------------------------------------------------- payment links (A-06 / C-18)

export interface PaymentLinkRecord {
  readonly id: number
  readonly bookingId: number
  readonly bookingCode: string
  /** Booking's client_request_key: the hold the customer continues with. */
  readonly requestKey: string
  /** Phone number the staff member took the booking for (E.164). */
  readonly contactPhone: string | null
  readonly expiresAt: Date
  readonly usedAt: Date | null
  readonly revokedAt: Date | null
  readonly issuedByName: string | null
}

export interface IssuedPaymentLink {
  readonly id: number
  readonly issuedAt: Date
  readonly bookingCode: string
  readonly bookingStatus: BookingStatus
  readonly customerName: string | null
  readonly total: number
  readonly expiresAt: Date
  readonly usedAt: Date | null
  readonly revokedAt: Date | null
}

export interface PaymentLinkRepository {
  /** Only the hash of the token is stored (payment_links.token_hash). */
  create(link: {
    readonly bookingId: number
    readonly tokenHash: string
    readonly expiresAt: Date
    readonly issuedBy: number
  }): Promise<number>
  findByTokenHash(tokenHash: string): Promise<PaymentLinkRecord | null>
  listIssued(stores: StoreFilter, since: Date): Promise<IssuedPaymentLink[]>
}

// ---------------------------------------------------------------- room blocks (A-22)

/** A booking that occupies inventory, with what staff need to identify it. */
export interface OccupyingBookingRef {
  readonly bookingCode: string
  readonly status: BookingStatus
  readonly groupId: number
  readonly roomId: number | null
  readonly start: Date
  readonly end: Date
}

export interface LockedBlockTx {
  loadInventory(storeId: number, from: Date, to: Date, now: Date): Promise<StoreInventory>
  occupyingBookings(
    storeId: number,
    from: Date,
    to: Date,
    now: Date,
  ): Promise<OccupyingBookingRef[]>
  createBlock(block: {
    readonly roomId: number
    readonly start: Date
    readonly end: Date
    readonly reason: string
    readonly createdBy: number
  }): Promise<number>
}

export interface BlockRoom {
  readonly id: number
  readonly groupId: number
  readonly code: string
  readonly name: string
}

export interface RoomBlockRow {
  readonly id: number
  readonly storeId: number
  readonly storeCode: string
  readonly roomId: number
  readonly roomName: string
  readonly start: Date
  readonly end: Date
  readonly reason: string
  readonly createdByName: string | null
}

export interface RoomBlockRepository {
  /** Same inventory_day_locks row as BookingRepository.withInventoryLock (design rule 在庫排他). */
  withInventoryLock<T>(
    roomGroupId: number,
    businessDate: LocalDate,
    fn: (tx: LockedBlockTx) => Promise<T>,
  ): Promise<T>
  rooms(storeId: number): Promise<BlockRoom[]>
  /** Blocks not released that end after `from`. */
  list(stores: StoreFilter, from: Date): Promise<RoomBlockRow[]>
  find(id: number): Promise<{ id: number; storeId: number; releasedAt: Date | null } | null>
  release(id: number, staffId: number, at: Date): Promise<void>
}

// ---------------------------------------------------------------- alerts (A-25)

export type AlertStatus = 'open' | 'in_progress' | 'resolved'

export interface AlertRow {
  readonly id: number
  readonly alertType: string
  readonly severity: AlertSeverity
  readonly status: AlertStatus
  readonly failureReason: string
  readonly recoverySteps: string
  readonly detectedAt: Date
  readonly resolvedAt: Date | null
  readonly storeId: number | null
  readonly storeCode: string | null
  readonly bookingCode: string | null
  readonly assignedStaffId: number | null
  readonly assignedStaffName: string | null
}

export interface AlertWorkRepository {
  list(filter: {
    readonly stores: StoreFilter
    readonly statuses: readonly AlertStatus[]
    readonly severity?: AlertSeverity | null
    readonly alertType?: string | null
    readonly limit: number
  }): Promise<AlertRow[]>
  counts(
    stores: StoreFilter,
    resolvedSince: Date,
  ): Promise<{ open: number; inProgress: number; resolvedSince: number }>
  find(id: number): Promise<{ id: number; storeId: number | null; status: AlertStatus } | null>
  assign(id: number, staffId: number): Promise<void>
  resolveById(id: number, at: Date): Promise<void>
}

// ---------------------------------------------------------------- payments (A-26)

export interface MoneyMovementRow {
  readonly kind: 'payment' | 'refund'
  readonly id: number
  readonly at: Date
  readonly bookingCode: string
  readonly storeCode: string
  readonly customerName: string | null
  readonly method: string
  readonly amount: number
  readonly status: string
  readonly failureMessage: string | null
}

export interface PaymentHistoryFilter {
  readonly stores: StoreFilter
  readonly from: Date
  readonly to: Date
  readonly kind?: 'payment' | 'refund' | null
  readonly method?: PaymentMethod | null
  readonly status?: string | null
  readonly limit: number
}

export interface RefundRecord {
  readonly id: number
  readonly bookingId: number
  readonly bookingCode: string
  readonly storeId: number
  readonly paymentId: number
  readonly externalPaymentId: string | null
  readonly amount: number
  readonly idempotencyKey: string
  readonly status: string
}

export interface PaymentHistoryRepository {
  list(filter: PaymentHistoryFilter): Promise<MoneyMovementRow[]>
  /** Succeeded payments and refunds in [from, to), and payments still pending. */
  totals(
    stores: StoreFilter,
    from: Date,
    to: Date,
  ): Promise<{ paid: number; refunded: number; pending: number }>
  findRefund(id: number): Promise<RefundRecord | null>
}

// ---------------------------------------------------------------- notifications (A-05 再送)

export interface NotificationResendRepository {
  findDelivery(id: number): Promise<{
    readonly id: number
    readonly bookingId: number | null
    readonly storeId: number | null
    readonly deduplicationKey: string
  } | null>
  /** Queues a copy of a delivery (same rendered message and destination) under a new key. */
  requeueCopy(deliveryId: number, deduplicationKey: string, scheduledAt: Date): Promise<void>
}
