import {
  assertCanWithdraw,
  DomainError,
  isDateChangeAllowed,
  isEntryInfoDisclosed,
  normalizeOptionalEmail,
  receiptAvailability,
} from '@jancube/domain'
import { type CancelDeps, makeQuoteCancellation } from '../booking/cancel-booking'
import type { Clock } from '../ports/clock'
import type { LegalDocumentType } from '../ports/member-repository'
import type {
  LegalTextRepository,
  MemberBookingDetail,
  MemberBookingRow,
  MemberCouponGrant,
  MyPageRepository,
} from '../ports/my-page'
import type { AuditLog, SecretBox } from '../ports/ops'

export interface MyPageDeps {
  readonly myPage: MyPageRepository
  readonly secrets: SecretBox
  readonly audit: AuditLog
  readonly clock: Clock
}

/** C-12 status badge: 確定 / 仮割当 / 利用済 / キャンセル済. */
export type BookingBadge = 'confirmed' | 'provisional' | 'used' | 'canceled'

export interface MyBookingItem extends MemberBookingRow {
  readonly badge: BookingBadge
  /** Room shown to the customer (named room, or the assigned room once announced). */
  readonly displayRoom: string | null
}

const KEY_USABLE = new Set(['issued', 'active'])

function badgeOf(row: MemberBookingRow, now: Date): BookingBadge {
  if (row.status === 'canceled') return 'canceled'
  if (row.status === 'completed' || row.end <= now) return 'used'
  return row.assignment === 'named' || row.assignment === 'final' ? 'confirmed' : 'provisional'
}

function displayRoom(
  assignment: MemberBookingRow['assignment'],
  roomName: string | null,
  disclosed: boolean,
): string | null {
  if (assignment === 'named') return roomName
  if (assignment === 'final' || (assignment === 'provisional' && disclosed)) return roomName
  return null
}

/** C-12 マイページ: the member and their bookings across all stores (F-BK-16). */
export function makeGetMyPage(deps: Pick<MyPageDeps, 'myPage' | 'clock'>) {
  return async function getMyPage(memberId: number) {
    const account = await deps.myPage.account(memberId)
    if (!account || account.status === 'withdrawn') {
      throw new DomainError('member_not_found', 'sign in again')
    }
    const now = deps.clock.now()
    const rows = await deps.myPage.memberBookings(memberId)
    const items: MyBookingItem[] = rows.map((row) => ({
      ...row,
      badge: badgeOf(row, now),
      displayRoom: displayRoom(
        row.assignment,
        row.roomName,
        isEntryInfoDisclosed(row.businessDate, row.timezone, now),
      ),
    }))
    const upcoming = items
      .filter((i) => i.badge === 'confirmed' || i.badge === 'provisional')
      .sort((a, b) => a.start.getTime() - b.start.getTime())
    const past = items
      .filter((i) => i.badge === 'used' || i.badge === 'canceled')
      .sort((a, b) => b.start.getTime() - a.start.getTime())
    return { account, upcoming, past }
  }
}

async function ownedDetail(
  deps: Pick<MyPageDeps, 'myPage'>,
  bookingCode: string,
  memberId: number,
): Promise<MemberBookingDetail> {
  const detail = await deps.myPage.bookingDetail(bookingCode)
  // Someone else's booking looks exactly like a missing one.
  if (!detail || detail.memberId !== memberId || detail.status === 'draft') {
    throw new DomainError('booking_not_found', 'booking not found')
  }
  if (detail.status === 'expired') throw new DomainError('booking_not_found', 'booking not found')
  return detail
}

/**
 * C-13 予約詳細. The entry code is decrypted only for the booking owner, only once the key is issued,
 * and only from the day-before notice onwards; a group booking's room number likewise.
 */
export function makeGetMyBookingDetail(deps: MyPageDeps) {
  return async function getMyBookingDetail(bookingCode: string, memberId: number) {
    const detail = await ownedDetail(deps, bookingCode, memberId)
    const now = deps.clock.now()
    const disclosed = isEntryInfoDisclosed(detail.businessDate, detail.store.timezone, now)
    const active = detail.status === 'confirmed'

    let room: { name: string; announced: boolean } | null = null
    if (detail.requestedRoom) room = { name: detail.requestedRoom.name, announced: true }
    else if (detail.assignedRoom && (disclosed || detail.assignedRoom.status === 'final')) {
      room = { name: detail.assignedRoom.name, announced: true }
    }

    let entry: { code: string; validFrom: Date; validTo: Date } | null = null
    const key = detail.accessKey
    if (active && disclosed && key?.codeCiphertext && KEY_USABLE.has(key.status)) {
      entry = {
        code: await deps.secrets.decrypt(key.codeCiphertext),
        validFrom: key.validFrom,
        validTo: key.validTo,
      }
    }

    const paid = detail.payments.reduce((sum, p) => sum + p.amount, 0)
    const refunded = detail.refunds
      .filter((r) => r.status !== 'failed')
      .reduce((sum, r) => sum + r.amount, 0)
    const upcoming = active && detail.end > now
    return {
      booking: detail,
      room,
      entry,
      entryDisclosed: disclosed,
      paid,
      refunded,
      upcoming,
      canChange: upcoming && isDateChangeAllowed(detail.start, now),
      canCancel: upcoming,
      receipt: receiptAvailability({
        status: detail.status,
        end: detail.end,
        now,
        netPaid: paid - refunded,
      }),
    }
  }
}

/** C-15: the cancellation quote for the member's own booking. */
export function makeQuoteMyCancellation(deps: CancelDeps) {
  const quote = makeQuoteCancellation(deps)
  return async function quoteMyCancellation(bookingCode: string, memberId: number) {
    const result = await quote(bookingCode)
    if (result.booking.memberId !== memberId) {
      throw new DomainError('booking_not_found', 'booking not found')
    }
    return result
  }
}

export type CouponState = 'usable' | 'used' | 'expired' | 'revoked' | 'not_started' | 'disabled'

export interface MyCoupon extends MemberCouponGrant {
  readonly remaining: number
  readonly state: CouponState
}

function couponState(grant: MemberCouponGrant, now: Date): CouponState {
  if (grant.revokedAt) return 'revoked'
  if (grant.used >= grant.maxUses) return 'used'
  if (grant.expiresAt <= now) return 'expired'
  if (!grant.couponActive) return 'disabled'
  if (grant.validFrom > now) return 'not_started'
  return 'usable'
}

/** When a coupon stopped being usable (newest first in the 利用済・失効 tab). */
function endedAt(coupon: MyCoupon): Date {
  if (coupon.revokedAt) return coupon.revokedAt
  if (coupon.state === 'used' && coupon.lastUsedAt) return coupon.lastUsedAt
  return coupon.expiresAt
}

/** C-16 クーポン一覧: usable coupons (soonest expiry first) and used/expired ones. */
export function makeListMyCoupons(deps: Pick<MyPageDeps, 'myPage' | 'clock'>) {
  return async function listMyCoupons(memberId: number) {
    const now = deps.clock.now()
    const coupons: MyCoupon[] = (await deps.myPage.couponGrants(memberId)).map((grant) => ({
      ...grant,
      remaining: Math.max(0, grant.maxUses - grant.used),
      state: couponState(grant, now),
    }))
    const usable = coupons
      .filter((c) => c.state === 'usable' || c.state === 'not_started')
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
    const inactive = coupons
      .filter((c) => !(c.state === 'usable' || c.state === 'not_started'))
      .sort((a, b) => endedAt(b).getTime() - endedAt(a).getTime())
    return { usable, inactive }
  }
}

/** C-17 会員情報. */
export function makeGetMyAccount(deps: Pick<MyPageDeps, 'myPage'>) {
  return async function getMyAccount(memberId: number) {
    const account = await deps.myPage.account(memberId)
    if (!account || account.status === 'withdrawn') {
      throw new DomainError('member_not_found', 'sign in again')
    }
    return account
  }
}

/** C-17: customers may change only their email; names are changed by staff (tracker #22). */
export function makeUpdateMyEmail(deps: Pick<MyPageDeps, 'myPage' | 'audit'>) {
  const getMyAccount = makeGetMyAccount(deps)
  return async function updateMyEmail(memberId: number, input: string): Promise<void> {
    const account = await getMyAccount(memberId)
    const email = normalizeOptionalEmail(input)
    if (email === account.email) return
    await deps.myPage.updateEmail(memberId, email)
    await deps.audit.record({
      actor: { type: 'member', memberId },
      action: 'member.update_email',
      targetType: 'member',
      targetId: memberId,
      targetCode: account.memberCode,
      // Personal data is not copied into the audit log; only whether it was set.
      before: { email: account.email ? 'set' : 'none' },
      after: { email: email ? 'set' : 'none' },
    })
  }
}

/** C-17 退会 (F-AUTH-07): blocked while upcoming bookings exist; personal data is anonymized. */
export function makeWithdrawMember(deps: Pick<MyPageDeps, 'myPage' | 'audit' | 'clock'>) {
  const getMyAccount = makeGetMyAccount(deps)
  return async function withdrawMember(memberId: number): Promise<void> {
    const account = await getMyAccount(memberId)
    const now = deps.clock.now()
    assertCanWithdraw(await deps.myPage.upcomingBookingCount(memberId, now))
    await deps.myPage.withdraw(memberId, now)
    await deps.audit.record({
      actor: { type: 'member', memberId },
      action: 'member.withdraw',
      targetType: 'member',
      targetId: memberId,
      targetCode: account.memberCode,
      after: { status: 'withdrawn', anonymized: true },
    })
  }
}

/** C-20 利用規約 / プライバシーポリシー / キャンセルポリシー: the version in effect now. */
export function makeGetLegalDocument(deps: {
  readonly legalTexts: LegalTextRepository
  readonly clock: Clock
}) {
  return async function getLegalDocument(type: LegalDocumentType) {
    const document = await deps.legalTexts.currentDocument(type, deps.clock.now())
    if (!document) throw new DomainError('legal_document_not_found', 'document not published')
    return document
  }
}
