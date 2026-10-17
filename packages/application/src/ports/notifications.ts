import type { NotificationChannel, NotificationEvent } from '@jancube/domain'

export interface PublishedTemplate {
  readonly templateId: number
  readonly versionId: number
  readonly channel: NotificationChannel
  readonly priority: number
  readonly subject: string | null
  readonly body: string
}

/** Contact points of a member for notifications. */
export interface MemberContact {
  readonly notificationChannel?: 'email' | 'line'
  readonly memberId: number
  readonly email: string | null
  readonly phone: string | null
  /** LINE user id when linked and not blocked. */
  readonly lineUserId: string | null
}

export interface DueDelivery {
  readonly id: number
  readonly channel: NotificationChannel
  readonly destinationCiphertext: Uint8Array
  /** Encrypted JSON `{ subject, body }` rendered when queued. */
  readonly messageCiphertext: Uint8Array
  readonly attemptCount: number
  readonly bookingId: number | null
  readonly storeId: number | null
}

export interface NotificationRepository {
  /** Enabled templates for the event, store-specific overriding all-store ones, by priority. */
  templates(event: NotificationEvent, storeId: number | null): Promise<PublishedTemplate[]>
  memberContact(memberId: number): Promise<MemberContact | null>
  /** Idempotent on `deduplicationKey`. Rendered text is stored so retries send the same message. */
  enqueue(delivery: {
    readonly deduplicationKey: string
    readonly memberId: number | null
    readonly bookingId: number | null
    readonly couponGrantId: number | null
    readonly paymentLinkId: number | null
    readonly templateVersionId: number
    readonly channel: NotificationChannel
    readonly destinationCiphertext: Uint8Array
    readonly messageCiphertext: Uint8Array
    readonly contextRedacted: Readonly<Record<string, string>>
    readonly scheduledAt: Date
  }): Promise<void>
  /** Leases due deliveries (status queued, scheduled or retry time reached). */
  claimDue(now: Date, limit: number): Promise<DueDelivery[]>
  recordAttempt(
    deliveryId: number,
    attempt: {
      readonly attemptNo: number
      readonly result: 'accepted' | 'failed'
      readonly providerMessageId?: string | null
      readonly error?: string | null
      readonly at: Date
    },
    next:
      | { readonly status: 'sent' }
      | { readonly status: 'queued'; readonly retryAt: Date }
      | {
          readonly status: 'failed'
        },
  ): Promise<void>
}

/** LINE Messaging API push (F-LINE-05). */
export interface LineSender {
  push(message: { to: string; text: string }): Promise<{ providerMessageId: string }>
}

/** What booking notifications show (read model). */
export interface BookingNotificationView {
  readonly bookingId: number
  readonly bookingCode: string
  readonly memberId: number | null
  readonly storeId: number
  readonly storeName: string
  readonly storeAddress: string | null
  readonly timezone: string
  readonly businessDate: string
  readonly start: Date
  readonly end: Date
  readonly roomTypeName: string
  /** Assigned room (after the day-before assignment) or the named room; null before assignment. */
  readonly roomName: string | null
  readonly customerName?: string | null
  readonly roomLocation?: string | null
  readonly roomPhotoUrl?: string | null
  readonly entryGuideText?: string | null
  readonly guestCount: number
  readonly total: number
}

export interface BookingNotificationQuery {
  bookingView(bookingId: number): Promise<BookingNotificationView | null>
}
