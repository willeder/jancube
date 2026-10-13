import {
  assertBookable,
  type BookingRules,
  type ChangeSettlement,
  calculatePrice,
  changeSettlement,
  createTimeRange,
  DomainError,
  durationMinutes,
  evaluateCoupon,
  isDateChangeAllowed,
  type LocalDate,
  minuteOfBusinessDay,
  type PriceQuote,
  type TimeRange,
  weekdayOf,
} from '@jancube/domain'
import { assertCanBook } from '../auth/sign-in'
import {
  type BookingDeps,
  bookingRules,
  type DayContext,
  findLane,
  type Lane,
  laneLoad,
  lanePricing,
  loadDayContext,
} from '../booking/booking-context'
import { makeGetDayAvailability } from '../booking/get-day-availability'
import { makeGetEndOptions } from '../booking/get-end-options'
import type {
  BookingChangeRepository,
  BookingChangeValues,
  ChangeTarget,
} from '../ports/booking-change'
import type { CheckoutRepository, CouponRepository, PaymentGateway } from '../ports/checkout'
import type { StoreInventory } from '../ports/inventory-repository'
import type { LegalDocumentRepository, MemberRepository } from '../ports/member-repository'
import type { AuditLog } from '../ports/ops'

export interface ChangeDeps extends BookingDeps {
  readonly changes: BookingChangeRepository
  readonly members: MemberRepository
  readonly coupons: CouponRepository
  readonly checkouts: CheckoutRepository
  readonly gateway: PaymentGateway
  readonly legalDocuments: LegalDocumentRepository
  readonly audit: AuditLog
}

export interface ChangeRequest {
  readonly bookingCode: string
  readonly memberId: number
  readonly date: LocalDate
  readonly laneKey: string
  readonly start: string
  readonly end: string
}

const withoutBooking = (inventory: StoreInventory, bookingId: number): StoreInventory => ({
  ...inventory,
  bookings: inventory.bookings.filter((b) => b.bookingId !== bookingId),
})

/** Availability as if the booking being changed did not exist (it may move onto its own time). */
function excludingBooking(deps: BookingDeps, bookingId: number): BookingDeps {
  return {
    ...deps,
    inventory: {
      load: async (storeId, from, to, now) =>
        withoutBooking(await deps.inventory.load(storeId, from, to, now), bookingId),
    },
  }
}

/** The member's confirmed booking that may still be changed (free-cancellation period, F-BK-14). */
async function changeableTarget(
  deps: ChangeDeps,
  bookingCode: string,
  memberId: number,
): Promise<ChangeTarget> {
  const target = await deps.changes.changeTarget(bookingCode)
  if (!target || target.memberId !== memberId) {
    throw new DomainError('booking_not_found', 'booking not found')
  }
  if (target.status !== 'confirmed') {
    throw new DomainError('booking_not_changeable', `booking is ${target.status}`)
  }
  if (!isDateChangeAllowed(target.start, deps.clock.now())) {
    throw new DomainError(
      'change_not_allowed',
      'changes are closed once a cancellation fee applies',
    )
  }
  const member = await deps.members.findById(memberId)
  if (!member) throw new DomainError('member_not_found', 'sign in again')
  assertCanBook(member)
  return target
}

/** C-14: whether the booking can be changed now, and its current details. */
export function makeGetChangeableBooking(deps: ChangeDeps) {
  return (bookingCode: string, memberId: number) => changeableTarget(deps, bookingCode, memberId)
}

/** C-14 (C-03 reused): availability grid of a date for moving this booking. */
export function makeGetChangeAvailability(deps: ChangeDeps) {
  return async function getChangeAvailability(
    bookingCode: string,
    memberId: number,
    date: LocalDate,
  ) {
    const target = await changeableTarget(deps, bookingCode, memberId)
    return makeGetDayAvailability(excludingBooking(deps, target.id))(target.storeCode, date)
  }
}

/** C-14: end times (with prices) for a chosen new start. */
export function makeGetChangeEndOptions(deps: ChangeDeps) {
  return async function getChangeEndOptions(input: Omit<ChangeRequest, 'end'>) {
    const target = await changeableTarget(deps, input.bookingCode, input.memberId)
    return makeGetEndOptions(excludingBooking(deps, target.id))({
      storeCode: target.storeCode,
      date: input.date,
      laneKey: input.laneKey,
      start: input.start,
    })
  }
}

interface ChangePlan {
  readonly target: ChangeTarget
  readonly ctx: DayContext
  readonly lane: Lane
  readonly range: TimeRange
  readonly rules: BookingRules
  readonly priceVersionId: number
  readonly taxRatePercent: number
  readonly quote: PriceQuote
  readonly discount: number
  readonly newTotal: number
  readonly settlement: ChangeSettlement
}

async function planChange(deps: ChangeDeps, request: ChangeRequest): Promise<ChangePlan> {
  const target = await changeableTarget(deps, request.bookingCode, request.memberId)
  const ctx = await loadDayContext(
    excludingBooking(deps, target.id),
    target.storeCode,
    request.date,
  )
  const lane = findLane(ctx, request.laneKey)
  const start = new Date(request.start)
  const end = new Date(request.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new DomainError('invalid_time', 'invalid time')
  }
  const range = createTimeRange(start, end)
  const sameRoom =
    lane.group.id === target.roomGroupId && (lane.room?.id ?? null) === target.requestedRoomId
  if (
    sameRoom &&
    range.start.getTime() === target.start.getTime() &&
    range.end.getTime() === target.end.getTime()
  ) {
    throw new DomainError('change_same_as_current', 'nothing would change')
  }
  if (target.guestCount > lane.group.capacity) {
    throw new DomainError('guest_count_exceeds_capacity', 'too many guests for this room')
  }
  const priced = await lanePricing(deps, lane, range.start)
  const rules = bookingRules(priced)
  assertBookable(
    ctx.window,
    laneLoad(ctx.inventory, lane, ctx.store.booking.cleaningBufferMinutes),
    range,
    ctx.now,
    rules,
  )
  const quote = calculatePrice(durationMinutes(range), priced.profile)
  const discount = await couponDiscount(deps, target, lane, request.date, range, quote.price, ctx)
  const newTotal = quote.price - discount
  return {
    target,
    ctx,
    lane,
    range,
    rules,
    priceVersionId: priced.priceVersionId,
    taxRatePercent: priced.taxRatePercent,
    quote,
    discount,
    newTotal,
    settlement: changeSettlement(target.total, newTotal),
  }
}

/**
 * The applied coupon is re-checked against the new date, time and room (so a weekday-only coupon
 * cannot be moved to a weekend); the discount is recalculated for the new price.
 */
async function couponDiscount(
  deps: ChangeDeps,
  target: ChangeTarget,
  lane: Lane,
  date: LocalDate,
  range: TimeRange,
  subtotal: number,
  ctx: DayContext,
): Promise<number> {
  if (target.couponGrantId === null) return 0
  const offers = await deps.coupons.usableGrants(target.memberId ?? 0, ctx.now, target.id)
  const offer = offers.find((o) => o.grantId === target.couponGrantId)
  const roomTypeId =
    lane.group.roomTypeId ?? (lane.group.id === target.roomGroupId ? target.roomTypeId : -1)
  const result = offer
    ? evaluateCoupon(offer.terms, {
        at: ctx.now,
        storeId: target.storeId,
        roomTypeId,
        startWeekday: weekdayOf(date),
        startMinute: minuteOfBusinessDay(date, range.start, target.timezone),
        subtotal,
      })
    : null
  if (!result?.ok) {
    throw new DomainError(
      'change_coupon_not_applicable',
      'the applied coupon does not cover the new booking',
    )
  }
  return result.discount
}

function valuesOf(
  booking: Pick<ChangeTarget, 'businessDate' | 'start' | 'end' | 'roomGroupId' | 'requestedRoomId'>,
  extra: Pick<
    BookingChangeValues,
    'assignedRoomId' | 'guestCount' | 'subtotal' | 'discount' | 'total'
  >,
): BookingChangeValues {
  return {
    businessDate: booking.businessDate,
    start: booking.start.toISOString(),
    end: booking.end.toISOString(),
    roomGroupId: booking.roomGroupId,
    requestedRoomId: booking.requestedRoomId,
    ...extra,
  }
}

/** C-14: before/after and the price difference for the chosen new time (nothing is changed yet). */
export function makeQuoteBookingChange(deps: ChangeDeps) {
  return async function quoteBookingChange(request: ChangeRequest) {
    const plan = await planChange(deps, request)
    return {
      before: {
        businessDate: plan.target.businessDate,
        start: plan.target.start,
        end: plan.target.end,
        total: plan.target.total,
      },
      after: {
        businessDate: request.date,
        start: plan.range.start,
        end: plan.range.end,
        laneLabel: plan.lane.room ? plan.lane.room.name : plan.lane.group.name,
        groupName: plan.lane.group.name,
        regularPrice: plan.quote.regularPrice,
        subtotal: plan.quote.price,
        discount: plan.discount,
        total: plan.newTotal,
      },
      settlement: plan.settlement,
    }
  }
}

/**
 * C-14 予約変更 (F-BK-14, conditions provisional): re-checked under the inventory locks of the old and
 * new (room group, date), price recomputed, history recorded, `booking.changed` queued so room
 * assignment, keys and notifications follow. A cheaper change refunds the difference; a more
 * expensive one is refused (no additional payment in Phase 1).
 */
export function makeChangeBooking(deps: ChangeDeps) {
  return async function changeBooking(request: ChangeRequest & { readonly requestKey: string }) {
    const plan = await planChange(deps, request)
    const { target, ctx, lane, range } = plan
    if (plan.settlement.kind === 'increase_not_allowed') {
      throw new DomainError('change_price_increase', 'the new booking costs more')
    }
    const now = ctx.now
    const [policy] = await deps.legalDocuments.current(['cancellation_policy'], now)
    if (!policy) throw new DomainError('legal_documents_missing', 'cancellation policy missing')

    const before = valuesOf(target, {
      assignedRoomId: target.assignedRoomId,
      guestCount: target.guestCount,
      subtotal: target.subtotal,
      discount: target.discount,
      total: target.total,
    })
    const requestedRoomId = lane.room?.id ?? null
    const after = valuesOf(
      {
        businessDate: request.date,
        start: range.start,
        end: range.end,
        roomGroupId: lane.group.id,
        requestedRoomId,
      },
      {
        assignedRoomId: null,
        guestCount: target.guestCount,
        subtotal: plan.quote.price,
        discount: plan.discount,
        total: plan.newTotal,
      },
    )

    const locks = [
      { roomGroupId: target.roomGroupId, businessDate: target.businessDate },
      { roomGroupId: lane.group.id, businessDate: request.date },
    ]
    const { historyId, duplicate } = await deps.changes.withInventoryLocks(locks, async (tx) => {
      const inventory = withoutBooking(
        await tx.loadInventory(ctx.store.id, ctx.window.opensAt, ctx.window.closesAt, now),
        target.id,
      )
      const lockedLane = {
        ...lane,
        rooms: lane.rooms.filter((r) => inventory.rooms.some((x) => x.id === r.id)),
      }
      assertBookable(
        ctx.window,
        laneLoad(inventory, lockedLane, ctx.store.booking.cleaningBufferMinutes),
        range,
        now,
        plan.rules,
      )
      return tx.applyChange({
        bookingId: target.id,
        expectedLockVersion: target.lockVersion,
        memberId: request.memberId,
        policyDocumentId: policy.id,
        policyCheckedAt: now,
        changedAt: deps.clock.now(),
        requestKey: request.requestKey,
        roomGroupId: lane.group.id,
        requestedRoomId,
        businessDate: request.date,
        start: range.start,
        end: range.end,
        priceVersionId: plan.priceVersionId,
        taxRatePercent: plan.taxRatePercent,
        quote: plan.quote,
        discount: plan.discount,
        before,
        after,
      })
    })
    if (duplicate) return { historyId, refund: 0, refundFailed: false }

    await deps.audit.record({
      actor: { type: 'member', memberId: request.memberId },
      action: 'booking.change',
      targetType: 'booking',
      targetId: target.id,
      targetCode: target.bookingCode,
      storeId: target.storeId,
      before,
      after,
    })

    const refund = plan.settlement.kind === 'refund' ? plan.settlement.amount : 0
    const refundFailed =
      refund > 0 ? await refundDifference(deps, target.id, historyId, refund) : false
    return { historyId, refund, refundFailed }
  }
}

/** Refunds a cheaper change to the original payment(s), newest first. Failures stay visible on A-26. */
async function refundDifference(
  deps: ChangeDeps,
  bookingId: number,
  historyId: number,
  amount: number,
): Promise<boolean> {
  let remaining = amount
  let failed = false
  for (const payment of await deps.checkouts.refundablePayments(bookingId)) {
    if (remaining <= 0) break
    const part = Math.min(remaining, payment.refundable)
    if (part <= 0) continue
    remaining -= part
    const idempotencyKey = `change:${historyId}:${payment.paymentId}`
    const refundId = await deps.checkouts.createRefund({
      paymentId: payment.paymentId,
      bookingId,
      cancellationId: null,
      amount: part,
      reason: 'booking change (price difference)',
      idempotencyKey,
      requestedBy: null,
    })
    try {
      if (!payment.externalPaymentId) throw new Error('payment has no provider reference')
      const result = await deps.gateway.refund({
        externalPaymentId: payment.externalPaymentId,
        amount: part,
        idempotencyKey,
      })
      await deps.checkouts.finishRefund(refundId, {
        externalRefundId: result.refundId,
        at: deps.clock.now(),
      })
    } catch (error) {
      failed = true
      await deps.checkouts.finishRefund(refundId, { error: String(error) })
    }
  }
  return failed || remaining > 0
}
