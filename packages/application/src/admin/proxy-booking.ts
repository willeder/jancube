import {
  assertCan,
  DomainError,
  maskPhone,
  normalizeJapaneseMobile,
  type StaffAccess,
  utcToLocal,
} from '@jancube/domain'
import { assertCanBook } from '../auth/sign-in'
import { requireStore } from '../booking/booking-context'
import { type HoldDeps, makeCreateHold } from '../booking/hold'
import { bookingTemplateValues } from '../notifications/booking-notifications'
import type { NotifyRequest, NotifyResult } from '../notifications/notify'
import type {
  IssuedPaymentLink,
  PaymentLinkRecord,
  PaymentLinkRepository,
} from '../ports/admin-bookings'
import type { BookingSummary } from '../ports/booking-repository'
import type {
  MemberRecord,
  MemberRepository,
  RandomSource,
  SecretHasher,
} from '../ports/member-repository'
import type { AuditLog } from '../ports/ops'
import { staffActor, storeFilter } from './access'

export interface ProxyBookingDeps extends HoldDeps {
  readonly members: MemberRepository
  readonly paymentLinks: PaymentLinkRepository
  readonly hasher: SecretHasher
  readonly random: RandomSource
  readonly notify: (request: NotifyRequest) => Promise<NotifyResult>
  readonly audit: AuditLog
  /** Public base URL used in the SMS (APP_URL). */
  readonly appUrl: string
}

/** Payment link tokens are hashed with their purpose, like other one-time tokens. */
export const paymentLinkTokenHash = (hasher: SecretHasher, token: string) =>
  hasher.hash(`payment_link:${token}`)

export interface ProxyBookingInput {
  readonly storeCode: string
  readonly date: string
  readonly laneKey: string
  readonly start: string
  readonly end: string
  readonly guestCount: number
  readonly phone: string
  /** Required when the phone number is not a member's (the member's registered name is used otherwise). */
  readonly familyName?: string | null
  readonly givenName?: string | null
}

export interface ProxyBookingResult {
  readonly bookingCode: string
  readonly paymentUrl: string
  readonly expiresAt: Date
  readonly member: { readonly memberCode: string; readonly name: string } | null
  /** `screen_only`: no SMS template is enabled; staff pass the link on themselves. */
  readonly sms: 'queued' | 'screen_only'
}

const memberName = (m: MemberRecord) => `${m.familyName ?? ''} ${m.givenName ?? ''}`.trim()

/** A-06 「電話番号で検索」: the member registered with this phone number, if any. */
export function makeLookupMemberByPhone(deps: Pick<ProxyBookingDeps, 'members'>) {
  return async function lookupMemberByPhone(access: StaffAccess, phone: string) {
    assertCan(access, 'bookings.manage')
    const member = await deps.members.findByPhone(normalizeJapaneseMobile(phone))
    if (!member) return null
    return {
      memberCode: member.memberCode,
      name: memberName(member),
      status: member.status,
      canBook: member.status !== 'suspended' && member.status !== 'withdrawn',
    }
  }
}

/**
 * A-06 代理予約作成 (F-ADM-09, F-PAY-05, F-NTF-05/11): staff hold the time for a phone customer and
 * send a payment link by SMS. The hold lasts `stores.proxy_hold_minutes`; the link expires with it
 * (CQ-23 open). The customer pays on C-18 through the normal checkout.
 */
export function makeCreateProxyBooking(deps: ProxyBookingDeps) {
  const createHold = makeCreateHold(deps)
  return async function createProxyBooking(
    access: StaffAccess,
    input: ProxyBookingInput,
  ): Promise<ProxyBookingResult> {
    const store = await requireStore(deps, input.storeCode)
    assertCan(access, 'bookings.manage', store.id)
    const phone = normalizeJapaneseMobile(input.phone)
    const member = await deps.members.findByPhone(phone)
    if (member) assertCanBook(member)
    const familyName = member?.familyName ?? input.familyName?.trim() ?? ''
    const givenName = member?.givenName ?? input.givenName?.trim() ?? ''
    if (!familyName) throw new DomainError('name_required', 'enter the customer name')
    if (familyName.length > 100 || givenName.length > 100) {
      throw new DomainError('name_too_long', 'name is too long')
    }

    const { requestKey, bookingCode } = await createHold({
      storeCode: input.storeCode,
      date: input.date,
      laneKey: input.laneKey,
      start: input.start,
      end: input.end,
      source: 'proxy',
      proxy: {
        staffId: access.staffId,
        guestCount: input.guestCount,
        contact: {
          memberId: member?.id ?? null,
          familyName,
          givenName: givenName || null,
          phone,
          email: member?.email ?? null,
        },
      },
    })
    const hold = await deps.bookings.findByRequestKey(requestKey)
    if (!hold?.holdExpiresAt) throw new Error(`proxy hold ${bookingCode} not found`)

    const token = deps.random.token()
    const linkId = await deps.paymentLinks.create({
      bookingId: hold.id,
      tokenHash: await paymentLinkTokenHash(deps.hasher, token),
      expiresAt: hold.holdExpiresAt,
      issuedBy: access.staffId,
    })
    const paymentUrl = `${deps.appUrl}/pay/${token}`
    const values = bookingTemplateValues(viewOf(hold), deps.appUrl)
    const expires = utcToLocal(hold.holdExpiresAt, hold.timezone)
    const notified = await deps.notify({
      event: 'payment_link',
      storeId: hold.storeId,
      memberId: member?.id ?? null,
      smsTo: phone,
      values: {
        ...values,
        linkExpiresAt: `${Number(expires.date.slice(5, 7))}/${Number(expires.date.slice(8))} ${clock(expires.minuteOfDay)}`,
        paymentUrl,
      },
      // The URL is the credential for paying; it is not kept in the delivery context.
      secretValueNames: ['paymentUrl'],
      deduplicationKey: `payment_link:${linkId}`,
      bookingId: hold.id,
      paymentLinkId: linkId,
    })
    await deps.audit.record({
      actor: staffActor(access),
      action: 'booking.proxy_create',
      targetType: 'booking',
      targetId: hold.id,
      targetCode: bookingCode,
      storeId: hold.storeId,
      after: {
        laneKey: input.laneKey,
        start: input.start,
        end: input.end,
        guestCount: input.guestCount,
        phone: maskPhone(phone),
        memberId: member?.id ?? null,
        paymentLinkId: linkId,
        holdExpiresAt: hold.holdExpiresAt.toISOString(),
        sms: notified.status,
      },
    })
    return {
      bookingCode,
      paymentUrl,
      expiresAt: hold.holdExpiresAt,
      member: member ? { memberCode: member.memberCode, name: memberName(member) } : null,
      sms: notified.status,
    }
  }
}

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

function viewOf(b: BookingSummary) {
  return {
    bookingId: b.id,
    bookingCode: b.bookingCode,
    memberId: b.memberId,
    storeId: b.storeId,
    storeName: b.storeName,
    storeAddress: null,
    timezone: b.timezone,
    businessDate: b.businessDate,
    start: b.start,
    end: b.end,
    roomTypeName: b.roomGroupName,
    roomName: b.requestedRoomName,
    guestCount: b.guestCount,
    total: b.total,
  }
}

/** A-06 「発行済みリンク」 */
export function makeListPaymentLinks(deps: Pick<ProxyBookingDeps, 'paymentLinks'>) {
  return async function listPaymentLinks(
    access: StaffAccess,
    selectedStoreId: number | null,
    since: Date,
  ): Promise<IssuedPaymentLink[]> {
    return deps.paymentLinks.listIssued(
      storeFilter(access, 'bookings.manage', selectedStoreId),
      since,
    )
  }
}

// ---------------------------------------------------------------- C-18 決済リンク着地

export type PaymentLinkView =
  | {
      readonly state: 'open'
      readonly booking: BookingSummary
      readonly issuedByName: string | null
      readonly expiresAt: Date
    }
  | { readonly state: 'paid'; readonly booking: BookingSummary }

interface LandingDeps {
  readonly paymentLinks: PaymentLinkRepository
  readonly hasher: SecretHasher
  readonly bookings: HoldDeps['bookings']
  readonly members: MemberRepository
  readonly clock: HoldDeps['clock']
}

async function resolveLink(
  deps: LandingDeps,
  token: string,
): Promise<{ link: PaymentLinkRecord; booking: BookingSummary }> {
  const link = /^[0-9a-f]{32,128}$/.test(token)
    ? await deps.paymentLinks.findByTokenHash(await paymentLinkTokenHash(deps.hasher, token))
    : null
  const booking = link ? await deps.bookings.findByCode(link.bookingCode) : null
  if (!link || !booking || link.revokedAt) {
    throw new DomainError('payment_link_invalid', 'this payment link is not valid')
  }
  return { link, booking }
}

/** C-18: what the payment link is for, or why it can no longer be used. */
export function makeGetPaymentLink(deps: LandingDeps) {
  return async function getPaymentLink(token: string): Promise<PaymentLinkView> {
    const { link, booking } = await resolveLink(deps, token)
    if (link.usedAt || booking.status === 'confirmed' || booking.status === 'completed') {
      return { state: 'paid', booking }
    }
    const now = deps.clock.now()
    if (
      link.expiresAt <= now ||
      booking.status !== 'draft' ||
      !booking.holdExpiresAt ||
      booking.holdExpiresAt <= now
    ) {
      throw new DomainError('payment_link_expired', 'this payment link has expired')
    }
    return { state: 'open', booking, issuedByName: link.issuedByName, expiresAt: link.expiresAt }
  }
}

/**
 * C-18 「お支払いに進む」: continue with the booking's hold in the normal flow. A signed-in member who
 * is the booking's member (or whose phone number is the one the booking was taken for) goes straight
 * to C-09; everyone else verifies their phone number first (C-05〜C-07), which links the booking to
 * that member. The link is marked used when the booking is confirmed.
 */
export function makeOpenPaymentLink(deps: LandingDeps) {
  const getPaymentLink = makeGetPaymentLink(deps)
  return async function openPaymentLink(
    token: string,
    sessionMemberId: number | null,
  ): Promise<{ requestKey: string; next: 'payment' | 'sign_in' | 'paid' }> {
    const { link } = await resolveLink(deps, token)
    const view = await getPaymentLink(token)
    if (view.state === 'paid') return { requestKey: link.requestKey, next: 'paid' }
    const booking = view.booking
    if (sessionMemberId === null) return { requestKey: link.requestKey, next: 'sign_in' }
    if (booking.memberId !== null && booking.memberId !== sessionMemberId) {
      return { requestKey: link.requestKey, next: 'sign_in' }
    }
    const member = await deps.members.findById(sessionMemberId)
    if (!member) return { requestKey: link.requestKey, next: 'sign_in' }
    // A session for another phone number (e.g. a shared device) must verify the number first.
    if (booking.memberId === null && member.phone !== link.contactPhone) {
      return { requestKey: link.requestKey, next: 'sign_in' }
    }
    assertCanBook(member)
    if (booking.memberId === null) {
      await deps.bookings.assignMember(link.requestKey, {
        memberId: member.id,
        familyName: member.familyName,
        givenName: member.givenName,
        phone: member.phone,
        email: member.email,
      })
    }
    return { requestKey: link.requestKey, next: 'payment' }
  }
}
