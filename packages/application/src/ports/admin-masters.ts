import type {
  CalendarOverride,
  CouponGrantTrigger,
  CouponStatus,
  CouponVersionDraft,
  E164,
  LocalDate,
  NotificationChannel,
  NotificationEvent,
  PriceTimeRuleDraft,
  PriceVersionDraft,
  RoleCode,
  RoleGrant,
  StoreDraft,
  WeeklyHours,
} from '@jancube/domain'
import type { MemberStatus } from './member-repository'
import type { StaffStatus } from './staff-repository'

/*
 * Ports of the admin master screens (A-11〜A-23). Read models are shaped for the screens; writes
 * are small, explicit operations so every one can be permission-checked and audited by a use case.
 */

// ---------------------------------------------------------------- members (A-11 / A-12)

export interface MemberSearch {
  /** Free text: name, member code or email (partial match), OR-ed with `phoneDigits`. */
  readonly text: string | null
  /** Digits of a (partial) phone number, national form without the leading 0 (e.g. 9012345678). */
  readonly phoneDigits: string | null
  readonly status: MemberStatus | null
  readonly line: 'linked' | 'unlinked' | null
  /** Only members with a booking at one of these stores; null = every member. */
  readonly storeIds: readonly number[] | null
  readonly offset: number
  readonly limit: number
}

export interface MemberListRow {
  readonly id: number
  readonly memberCode: string
  readonly familyName: string | null
  readonly givenName: string | null
  readonly phone: E164 | null
  readonly email: string | null
  readonly lineLinked: boolean
  /** Confirmed or completed bookings. */
  readonly useCount: number
  readonly lastUseDate: LocalDate | null
  readonly status: MemberStatus
  readonly registeredAt: Date
}

export interface MemberProfileView extends MemberListRow {
  readonly registrationSource: string | null
  readonly lineLinkedAt: Date | null
  readonly lineFriendStatus: string | null
  readonly withdrawnAt: Date | null
}

export interface AdminMemberBookingRow {
  readonly bookingCode: string
  readonly storeCode: string
  readonly roomLabel: string
  readonly businessDate: LocalDate
  readonly start: Date
  readonly end: Date
  readonly timezone: string
  readonly total: number
  readonly status: string
}

export interface MemberCouponRow {
  readonly grantId: number
  readonly couponName: string
  readonly discountType: 'amount' | 'percent'
  readonly discountValue: number
  readonly maxUses: number
  readonly used: number
  readonly expiresAt: Date
  readonly grantedAt: Date
  readonly revokedAt: Date | null
}

export interface MemberConsentRow {
  readonly documentType: string
  readonly title: string
  readonly version: string
  readonly agreedAt: Date
  readonly channel: string
}

export interface MemberNoteRow {
  readonly id: number
  readonly occurredAt: Date
  readonly staffName: string
  readonly body: string
  readonly bookingCode: string | null
}

export interface MemberPaymentRow {
  readonly at: Date
  readonly bookingCode: string
  readonly method: string
  readonly amount: number
  readonly status: string
}

export interface MemberAdminRepository {
  search(search: MemberSearch): Promise<{ total: number; rows: MemberListRow[] }>
  findByCode(memberCode: string): Promise<MemberProfileView | null>
  /** Row-level access for store-scoped staff (CQ-45): has the member booked at one of the stores? */
  hasBookingAt(memberId: number, storeIds: readonly number[]): Promise<boolean>
  bookings(memberId: number, storeIds: readonly number[] | null): Promise<AdminMemberBookingRow[]>
  payments(memberId: number, storeIds: readonly number[] | null): Promise<MemberPaymentRow[]>
  coupons(memberId: number): Promise<MemberCouponRow[]>
  consents(memberId: number): Promise<MemberConsentRow[]>
  notes(memberId: number): Promise<MemberNoteRow[]>
  bookingIdForMember(memberId: number, bookingCode: string): Promise<number | null>
  setStatus(memberId: number, status: MemberStatus): Promise<void>
  addNote(note: {
    readonly memberId: number
    readonly staffId: number
    readonly bookingId: number | null
    readonly body: string
    readonly occurredAt: Date
  }): Promise<number>
}

// ---------------------------------------------------------------- coupons (A-13 / A-14 / A-15)

export interface CouponVersionView extends CouponVersionDraft {
  readonly id: number
  readonly versionNo: number
  readonly publishedAt: Date
}

export interface CouponSummary {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly campaignTag: string | null
  readonly status: CouponStatus
  readonly latest: CouponVersionView | null
  readonly grantCount: number
}

export interface CouponDetail {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly campaignTag: string | null
  readonly status: CouponStatus
  /** Newest first. */
  readonly versions: readonly CouponVersionView[]
}

/** Latest version of an active coupon that can still be granted. */
export interface GrantableVersion {
  readonly couponId: number
  readonly couponVersionId: number
  readonly code: string
  readonly name: string
  readonly versionNo: number
  readonly maxUses: number
  readonly validFrom: Date
  readonly validTo: Date
  readonly grantTrigger: CouponGrantTrigger
  readonly discountType: 'amount' | 'percent'
  readonly discountValue: number
}

export interface CouponAdminRepository {
  list(): Promise<CouponSummary[]>
  find(couponId: number): Promise<CouponDetail | null>
  codeTaken(code: string): Promise<boolean>
  /** Coupon and its first version in one transaction. */
  create(
    coupon: {
      readonly code: string
      readonly name: string
      readonly campaignTag: string | null
      readonly status: CouponStatus
      readonly createdBy: number
    },
    version: CouponVersionDraft,
  ): Promise<{ couponId: number; versionId: number }>
  /** Next version number of the coupon; earlier versions are left untouched. */
  addVersion(
    couponId: number,
    version: CouponVersionDraft,
    publishedBy: number,
  ): Promise<{ versionId: number; versionNo: number }>
  update(
    couponId: number,
    values: { readonly name: string; readonly campaignTag: string | null },
  ): Promise<void>
  setStatus(couponId: number, status: CouponStatus): Promise<void>
  grantables(at: Date): Promise<GrantableVersion[]>
  /** Idempotent on `issuanceKey`; `created` is false when the key was used before. */
  grant(grant: {
    readonly memberId: number
    readonly couponVersionId: number
    readonly campaignId: number | null
    readonly issuanceKey: string
    readonly maxUses: number
    readonly validFrom: Date
    readonly expiresAt: Date
    readonly grantedAt: Date
    readonly grantedBy: number | null
    readonly internalNote: string | null
  }): Promise<{ grantId: number; created: boolean }>
}

/** Fixed segments of A-15, resolved to absolute times by the use case. */
export type SegmentQuery =
  | { readonly kind: 'all_active' }
  | { readonly kind: 'no_use_since'; readonly since: Date }
  | { readonly kind: 'registered_between'; readonly from: Date; readonly to: Date }
  | { readonly kind: 'single_use' }
  | { readonly kind: 'store_users'; readonly storeId: number }

export interface SegmentCount {
  readonly total: number
  /** Reachable by LINE (linked, not blocked). */
  readonly line: number
  /** No LINE but an email address. */
  readonly email: number
  /** Neither: the coupon is only visible on My Page. */
  readonly none: number
}

export type CampaignStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed'

export interface CampaignRow {
  readonly id: number
  readonly campaignKey: string
  readonly name: string
  readonly couponVersionId: number
  readonly couponName: string
  readonly segmentCode: string
  readonly segmentConditions: Readonly<Record<string, unknown>>
  readonly previewCount: number
  readonly targetCount: number
  readonly grantedCount: number
  readonly status: CampaignStatus
  readonly issuedByName: string
  readonly startedAt: Date | null
  readonly finishedAt: Date | null
  readonly createdAt: Date
}

export interface CouponCampaignRepository {
  countSegment(segment: SegmentQuery): Promise<SegmentCount>
  /** Member ids of the segment in id order, after `afterId` (keyset paging for batches). */
  segmentMemberIds(segment: SegmentQuery, afterId: number, limit: number): Promise<number[]>
  findCampaign(campaignKey: string): Promise<CampaignRow | null>
  createCampaign(campaign: {
    readonly campaignKey: string
    readonly couponVersionId: number
    readonly name: string
    readonly segmentCode: string
    readonly segmentConditions: Readonly<Record<string, unknown>>
    readonly previewCount: number
    readonly targetCount: number
    readonly issuedBy: number
  }): Promise<number>
  updateCampaign(
    id: number,
    values: {
      readonly status: CampaignStatus
      readonly startedAt?: Date
      readonly finishedAt?: Date
    },
  ): Promise<void>
  listCampaigns(limit: number): Promise<CampaignRow[]>
}

// ---------------------------------------------------------------- prices (A-16 / A-17)

export interface PriceVersionView {
  readonly id: number
  readonly profileId: number
  readonly versionNo: number
  readonly status: 'draft' | 'published' | 'retired'
  readonly hourlyRate: number
  readonly minimumMinutes: number
  readonly taxRatePercent: number
  readonly validFrom: Date
  readonly validTo: Date | null
  readonly publishedAt: Date | null
  readonly packages: readonly { readonly minutes: number; readonly price: number }[]
  readonly timeRules: readonly PriceTimeRuleDraft[]
}

export interface PriceProfileSummary {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly isActive: boolean
  readonly latest: PriceVersionView | null
  /** Rooms whose assignment in effect now points at a version of this profile. */
  readonly roomCount: number
}

export interface PriceProfileDetail {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly isActive: boolean
  /** Newest first. */
  readonly versions: readonly PriceVersionView[]
}

export interface PriceAssignmentView {
  readonly id: number
  readonly roomId: number
  readonly roomCode: string
  readonly storeId: number
  readonly storeCode: string
  readonly profileId: number
  readonly profileName: string
  readonly versionId: number
  readonly versionNo: number
  readonly validFrom: Date
  readonly validTo: Date | null
}

export interface PriceRoomOption {
  readonly id: number
  readonly storeId: number
  readonly storeCode: string
  readonly code: string
  readonly name: string
  readonly roomTypeId: number
  readonly roomTypeName: string
  readonly timezone: string
}

export interface PriceAdminRepository {
  listProfiles(at: Date): Promise<PriceProfileSummary[]>
  findProfile(profileId: number): Promise<PriceProfileDetail | null>
  findVersion(versionId: number): Promise<(PriceVersionView & { profileName: string }) | null>
  codeTaken(code: string): Promise<boolean>
  createProfile(profile: { readonly code: string; readonly name: string }): Promise<number>
  updateProfile(
    profileId: number,
    values: { readonly name: string; readonly isActive: boolean },
  ): Promise<void>
  /** Inserts a published version with its packages and time rules (one transaction). */
  publishVersion(
    profileId: number,
    draft: PriceVersionDraft,
    publishedBy: number,
    publishedAt: Date,
  ): Promise<{ versionId: number; versionNo: number }>
  /** Assignments in effect at `at` or starting later, optionally for one profile / some stores. */
  assignments(filter: {
    readonly at: Date
    readonly profileId?: number
    readonly storeIds?: readonly number[] | null
  }): Promise<PriceAssignmentView[]>
  /** Rooms whose assignment in effect at `at` uses a version of the profile. */
  roomsOnProfile(profileId: number, at: Date): Promise<number[]>
  /**
   * From `validFrom` the rooms use `versionId`: assignments running past `validFrom` are ended
   * there and assignments that would only start later are removed (one transaction).
   */
  assign(input: {
    readonly roomIds: readonly number[]
    readonly versionId: number
    readonly validFrom: Date
  }): Promise<{ ended: number; removed: number; created: number }>
  rooms(storeIds: readonly number[] | null): Promise<PriceRoomOption[]>
  room(roomId: number): Promise<PriceRoomOption | null>
}

// ---------------------------------------------------------------- stores & rooms (A-18 / A-19)

export interface StoreAdminView extends StoreDraft {
  readonly id: number
  readonly code: string
  readonly timezone: string
  readonly weekly: readonly WeeklyHours[]
}

export interface CalendarDayView extends CalendarOverride {
  readonly isHoliday: boolean
  readonly reason: string | null
}

export interface StoreAdminRepository {
  list(): Promise<StoreAdminView[]>
  find(storeId: number): Promise<StoreAdminView | null>
  codeTaken(code: string): Promise<boolean>
  create(
    store: StoreDraft & { readonly code: string; readonly timezone: string },
    weekly: readonly WeeklyHours[],
  ): Promise<number>
  update(storeId: number, store: StoreDraft): Promise<void>
  setWeeklyHours(storeId: number, weekly: readonly WeeklyHours[]): Promise<void>
  calendarDays(storeId: number, from: LocalDate): Promise<CalendarDayView[]>
  upsertCalendarDay(storeId: number, day: CalendarDayView): Promise<void>
  deleteCalendarDay(storeId: number, date: LocalDate): Promise<void>
}

export type RoomStatus = 'active' | 'paused' | 'broken'
export type BookingMode = 'group' | 'named'

export interface RoomTypeView {
  readonly id: number
  readonly code: string
  readonly name: string
  readonly capacity: number
  readonly isActive: boolean
}

export interface RoomGroupView {
  readonly id: number
  readonly storeId: number
  readonly roomTypeId: number
  readonly roomTypeName: string
  readonly code: string
  readonly name: string
  readonly bookingMode: BookingMode
  readonly sortOrder: number
  readonly isActive: boolean
  readonly roomCount: number
}

export interface RoomPhoto {
  readonly url: string
  readonly alt: string | null
}

export interface RoomDraft {
  readonly locationText?: string | null
  readonly name: string
  readonly description: string | null
  readonly operatingStatus: RoomStatus
  readonly isNamedBooking: boolean
  readonly isVipCandidate: boolean
  readonly sortOrder: number
}

export interface RoomView extends RoomDraft {
  readonly id: number
  readonly storeId: number
  readonly groupId: number
  readonly groupName: string
  readonly roomTypeName: string
  readonly code: string
  readonly cleaningStatus: string
  readonly photoCount: number
  /** Profile of the price assignment in effect now. */
  readonly priceProfileName: string | null
}

export interface RoomAdminRepository {
  roomTypes(): Promise<RoomTypeView[]>
  roomTypeCodeTaken(code: string): Promise<boolean>
  createRoomType(type: Omit<RoomTypeView, 'id'>): Promise<number>
  updateRoomType(id: number, values: Omit<RoomTypeView, 'id' | 'code'>): Promise<void>
  groups(storeId: number): Promise<RoomGroupView[]>
  findGroup(groupId: number): Promise<RoomGroupView | null>
  groupCodeTaken(storeId: number, code: string): Promise<boolean>
  createGroup(group: {
    readonly storeId: number
    readonly roomTypeId: number
    readonly code: string
    readonly name: string
    readonly bookingMode: BookingMode
    readonly sortOrder: number
  }): Promise<number>
  updateGroup(
    groupId: number,
    values: {
      readonly name: string
      readonly bookingMode: BookingMode
      readonly sortOrder: number
      readonly isActive: boolean
    },
  ): Promise<void>
  rooms(storeId: number, at: Date): Promise<RoomView[]>
  findRoom(roomId: number, at: Date): Promise<(RoomView & { photos: RoomPhoto[] }) | null>
  roomCodeTaken(storeId: number, code: string): Promise<boolean>
  /** The room's type follows its group. */
  createRoom(room: RoomDraft & { readonly groupId: number; readonly code: string }): Promise<number>
  updateRoom(roomId: number, values: RoomDraft): Promise<void>
  setPhotos(roomId: number, photos: readonly RoomPhoto[]): Promise<void>
}

// ---------------------------------------------------------------- notification templates (A-21)

export interface TemplateRow {
  readonly id: number
  readonly event: NotificationEvent
  readonly channel: NotificationChannel
  readonly storeId: number | null
  readonly storeCode: string | null
  readonly isEnabled: boolean
  readonly priority: number
  readonly latestVersionNo: number | null
  readonly latestPublishedAt: Date | null
}

export interface TemplateVersionView {
  readonly id: number
  readonly versionNo: number
  readonly subject: string | null
  readonly body: string
  readonly entryGuideUrl: string | null
  readonly publishedAt: Date
  readonly publishedByName: string
}

export interface TemplateDetail extends TemplateRow {
  /** Newest first; the newest is the one in use. */
  readonly versions: readonly TemplateVersionView[]
}

export interface TemplateAdminRepository {
  list(): Promise<TemplateRow[]>
  find(templateId: number): Promise<TemplateDetail | null>
  exists(
    event: NotificationEvent,
    channel: NotificationChannel,
    storeId: number | null,
  ): Promise<boolean>
  create(template: {
    readonly event: NotificationEvent
    readonly channel: NotificationChannel
    readonly storeId: number | null
    readonly isEnabled: boolean
    readonly priority: number
  }): Promise<number>
  update(
    templateId: number,
    values: { readonly isEnabled: boolean; readonly priority: number },
  ): Promise<void>
  publishVersion(
    templateId: number,
    version: {
      readonly subject: string | null
      readonly body: string
      readonly variables: readonly string[]
      readonly entryGuideUrl: string | null
    },
    publishedBy: number,
    publishedAt: Date,
  ): Promise<number>
}

// ---------------------------------------------------------------- staff (A-23)

export interface StaffGrantView {
  readonly role: RoleCode
  readonly storeId: number | null
  readonly storeCode: string | null
}

export interface StaffAdminRow {
  readonly id: number
  readonly email: string
  readonly name: string
  readonly status: StaffStatus
  /** False until the invitation has been accepted. */
  readonly hasPassword: boolean
  readonly lastLoginAt: Date | null
  readonly grants: readonly StaffGrantView[]
}

export interface StaffAdminRepository {
  list(): Promise<StaffAdminRow[]>
  find(staffId: number): Promise<StaffAdminRow | null>
  emailTaken(email: string): Promise<boolean>
  /** New account in status `invited`, with its grants. */
  create(staff: {
    readonly email: string
    readonly name: string
    readonly grants: readonly RoleGrant[]
    readonly grantedBy: number
  }): Promise<number>
  updateName(staffId: number, name: string): Promise<void>
  replaceGrants(staffId: number, grants: readonly RoleGrant[], grantedBy: number): Promise<void>
  setStatus(staffId: number, status: StaffStatus): Promise<void>
  /** Active staff holding the owner role. */
  activeOwnerIds(): Promise<number[]>
}
