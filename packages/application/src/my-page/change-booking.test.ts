import type { CouponTerms } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { fakeBookingDeps, jst } from '../booking/test-fixtures'
import type { ChangeTarget, LockedChangeTx } from '../ports/booking-change'
import type { CheckoutRepository, CouponOffer, PaymentGateway } from '../ports/checkout'
import type { OccupyingBooking } from '../ports/inventory-repository'
import type { MemberRecord } from '../ports/member-repository'
import {
  type ChangeDeps,
  makeChangeBooking,
  makeGetChangeAvailability,
  makeQuoteBookingChange,
} from './change-booking'

const DATE = '2026-11-10' // Tuesday
const own: OccupyingBooking = {
  bookingId: 7,
  groupId: 10,
  roomId: null,
  range: { start: jst(DATE, '13:00'), end: jst(DATE, '16:00') },
}

const target: ChangeTarget = {
  id: 7,
  bookingCode: 'JC-2026-000007',
  status: 'confirmed',
  memberId: 5,
  storeId: 1,
  storeCode: 'JC001',
  timezone: 'Asia/Tokyo',
  roomGroupId: 10,
  roomTypeId: 100,
  requestedRoomId: null,
  assignedRoomId: null,
  businessDate: DATE,
  start: own.range.start,
  end: own.range.end,
  guestCount: 4,
  subtotal: 4_500,
  discount: 0,
  total: 4_500,
  couponGrantId: null,
  lockVersion: 3,
}

function world(
  options: {
    now?: string
    others?: OccupyingBooking[]
    target?: Partial<ChangeTarget>
    coupon?: Partial<CouponTerms>
  } = {},
) {
  const booking = fakeBookingDeps({
    now: options.now ?? '2026-11-01T01:00:00Z',
    bookings: [own, ...(options.others ?? [])],
  })
  const log = {
    locks: [] as unknown[],
    applied: [] as Parameters<LockedChangeTx['applyChange']>[0][],
    refunds: [] as { amount: number; key: string; status?: string }[],
    audit: [] as { action: string }[],
  }
  const t = { ...target, ...options.target }
  const offers: CouponOffer[] = options.coupon
    ? [
        {
          grantId: 44,
          couponName: '平日クーポン',
          conditionsNote: null,
          expiresAt: new Date('2027-01-01T00:00:00Z'),
          terms: {
            discountType: 'amount',
            discountValue: 500,
            maximumDiscount: null,
            minimumSpend: 0,
            validFrom: new Date('2026-01-01T00:00:00Z'),
            validTo: new Date('2027-01-01T00:00:00Z'),
            weekdayMask: 127,
            startMinute: null,
            endMinute: null,
            storeIds: [],
            roomTypeIds: [],
            ...options.coupon,
          },
        },
      ]
    : []
  const deps: ChangeDeps = {
    ...booking,
    changes: {
      changeTarget: async (code) => (code === t.bookingCode ? t : null),
      withInventoryLocks: async (locks, fn) => {
        log.locks.push(locks)
        return fn({
          loadInventory: (...args) => booking.inventory.load(...args),
          applyChange: async (input) => {
            log.applied.push(input)
            return { historyId: 31, duplicate: false }
          },
        })
      },
    },
    members: {
      findById: async (id) => ({ id, memberCode: 'JC-U-000005', status: 'active' }) as MemberRecord,
      findByPhone: async () => null,
      createPhoneMember: async () => {
        throw new Error('unused')
      },
    },
    coupons: {
      usableGrants: async () => offers,
      findClaimableByCode: async () => null,
      findByTrigger: async () => [],
      grant: async () => 0,
    },
    checkouts: {
      refundablePayments: async () => [
        { paymentId: 9, externalPaymentId: 'pi_9', refundable: t.total },
      ],
      createRefund: async (input: { amount: number; idempotencyKey: string }) => {
        log.refunds.push({ amount: input.amount, key: input.idempotencyKey })
        return log.refunds.length
      },
      finishRefund: async (id: number, result: { error?: string }) => {
        const r = log.refunds[id - 1]
        if (r) r.status = 'error' in result ? 'failed' : 'succeeded'
      },
    } as unknown as CheckoutRepository,
    gateway: { refund: async () => ({ refundId: 're_1' }) } as unknown as PaymentGateway,
    legalDocuments: {
      current: async () => [{ id: 4, type: 'cancellation_policy', version: 'v1' }],
    },
    audit: { record: async (entry) => void log.audit.push(entry) },
  }
  return { deps, log }
}

const request = (
  start: string,
  end: string,
  extra: Partial<{ date: string; laneKey: string }> = {},
) => ({
  bookingCode: 'JC-2026-000007',
  memberId: 5,
  date: extra.date ?? DATE,
  laneKey: extra.laneKey ?? 'g:4MA',
  start: jst(extra.date ?? DATE, start).toISOString(),
  end: jst(extra.date ?? DATE, end).toISOString(),
})

describe('booking change (C-14)', () => {
  it('refunds the difference when the new booking is cheaper', async () => {
    const { deps, log } = world()
    const result = await makeChangeBooking(deps)({
      ...request('13:00', '15:00'),
      requestKey: 'req-1',
    })
    expect(result).toEqual({ historyId: 31, refund: 1_500, refundFailed: false })
    expect(log.locks[0]).toEqual([
      { roomGroupId: 10, businessDate: DATE },
      { roomGroupId: 10, businessDate: DATE },
    ])
    expect(log.applied[0]).toMatchObject({
      bookingId: 7,
      expectedLockVersion: 3,
      roomGroupId: 10,
      requestedRoomId: null,
      discount: 0,
      requestKey: 'req-1',
      before: { total: 4_500 },
      after: { total: 3_000, assignedRoomId: null },
    })
    expect(log.refunds).toEqual([{ amount: 1_500, key: 'change:31:9', status: 'succeeded' }])
    expect(log.audit.map((a) => a.action)).toEqual(['booking.change'])
  })

  it('lets the booking move onto its own current time', async () => {
    // Room1 is taken all afternoon by someone else; Room2 is only blocked by this booking itself.
    const other: OccupyingBooking = {
      groupId: 10,
      roomId: 1,
      range: { start: jst(DATE, '12:00'), end: jst(DATE, '20:00') },
      bookingId: 8,
    }
    const { deps } = world({ others: [other] })
    const grid = await makeGetChangeAvailability(deps)('JC-2026-000007', 5, DATE)
    const lane = grid.lanes.find((l) => l.key === 'g:4MA')
    expect(lane?.slots.find((s) => s.start === jst(DATE, '14:00').toISOString())?.available).toBe(
      true,
    )
    const quote = await makeQuoteBookingChange(deps)(request('14:00', '17:00'))
    expect(quote.settlement).toEqual({ kind: 'none' })
  })

  it('refuses a more expensive change (no additional payment in Phase 1)', async () => {
    const { deps, log } = world()
    const quote = await makeQuoteBookingChange(deps)(request('13:00', '17:00'))
    expect(quote.after.total).toBe(5_800)
    expect(quote.settlement).toEqual({ kind: 'increase_not_allowed', amount: 1_300 })
    await expect(
      makeChangeBooking(deps)({ ...request('13:00', '17:00'), requestKey: 'r' }),
    ).rejects.toThrow('costs more')
    expect(log.applied).toHaveLength(0)
  })

  it('is closed once a cancellation fee would apply', async () => {
    const { deps } = world({ now: '2026-11-09T05:00:00Z' })
    await expect(makeQuoteBookingChange(deps)(request('13:00', '15:00'))).rejects.toMatchObject({
      code: 'change_not_allowed',
    })
  })

  it("does not reveal or change another member's booking", async () => {
    const { deps } = world({ target: { memberId: 6 } })
    await expect(makeQuoteBookingChange(deps)(request('13:00', '15:00'))).rejects.toMatchObject({
      code: 'booking_not_found',
    })
  })

  it('rejects a time that is taken by other bookings', async () => {
    const busy = [1, 2].map((roomId) => ({
      groupId: 10,
      roomId,
      range: { start: jst('2026-11-11', '10:00'), end: jst('2026-11-11', '23:00') },
      bookingId: 100 + roomId,
    }))
    const { deps } = world({ others: busy })
    await expect(
      makeQuoteBookingChange(deps)(request('13:00', '15:00', { date: '2026-11-11' })),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('locks both the old and the new room group when moving to a named room', async () => {
    const { deps, log } = world({ target: { guestCount: 2 } })
    const quote = await makeQuoteBookingChange(deps)(
      request('13:00', '14:00', { laneKey: 'r:Room12' }),
    )
    expect(quote.after).toMatchObject({ laneLabel: 'Room12', total: 2_500 })
    await makeChangeBooking(deps)({
      ...request('13:00', '14:00', { laneKey: 'r:Room12' }),
      requestKey: 'k',
    })
    expect(log.locks[0]).toEqual([
      { roomGroupId: 10, businessDate: DATE },
      { roomGroupId: 20, businessDate: DATE },
    ])
    expect(log.applied[0]).toMatchObject({ roomGroupId: 20, requestedRoomId: 12 })
  })

  it('re-checks the applied coupon against the new date', async () => {
    const tuesdayOnly = { weekdayMask: 1 << 2 }
    const { deps } = world({
      target: { couponGrantId: 44, discount: 500, total: 4_000 },
      coupon: tuesdayOnly,
    })
    const same = await makeQuoteBookingChange(deps)(request('14:00', '17:00'))
    expect(same.after).toMatchObject({ subtotal: 4_500, discount: 500, total: 4_000 })
    await expect(
      makeQuoteBookingChange(deps)(request('13:00', '16:00', { date: '2026-11-11' })),
    ).rejects.toMatchObject({ code: 'change_coupon_not_applicable' })
  })

  it('refuses a "change" that changes nothing', async () => {
    const { deps } = world()
    await expect(makeQuoteBookingChange(deps)(request('13:00', '16:00'))).rejects.toMatchObject({
      code: 'change_same_as_current',
    })
  })
})
