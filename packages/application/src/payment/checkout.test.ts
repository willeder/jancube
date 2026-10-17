import type { CouponTerms } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { fakeBookingDeps, jst } from '../booking/test-fixtures'
import type { BookingRepository, BookingSummary } from '../ports/booking-repository'
import type {
  CheckoutRepository,
  CouponOffer,
  PaymentEvent,
  PaymentGateway,
  PaymentStatus,
} from '../ports/checkout'
import type { OccupyingBooking } from '../ports/inventory-repository'
import {
  type CheckoutDeps,
  makeConfirmCheckout,
  makeGetPaymentOptions,
  makeHandlePaymentWebhook,
  makeStartCheckout,
} from './checkout'

const D = '2026-11-10'

const anyTime: CouponTerms = {
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
}

const offer = (grantId: number, terms: Partial<CouponTerms>): CouponOffer => ({
  grantId,
  couponName: `coupon ${grantId}`,
  conditionsNote: null,
  expiresAt: new Date('2027-01-01T00:00:00Z'),
  terms: { ...anyTime, ...terms },
})

function world(
  options: {
    now?: string
    offers?: CouponOffer[]
    others?: OccupyingBooking[]
    email?: string | null
    suspended?: boolean
  } = {},
) {
  const base = fakeBookingDeps({ now: options.now ?? '2026-11-01T12:00:00+09:00' })
  const state = {
    booking: 'draft' as string,
    holdExpiresAt: new Date('2026-11-01T03:10:00Z') as Date | null,
    payment: 'pending' as PaymentStatus,
    total: 5_800,
  }
  const log = {
    prepared: [] as Parameters<CheckoutRepository['prepare']>[0][],
    confirmed: [] as { paymentId: number | null }[],
    refundsRequested: 0,
    refunded: [] as string[],
    checkouts: [] as Parameters<PaymentGateway['createCheckout']>[0][],
  }

  const summary = (): BookingSummary => ({
    id: 1,
    bookingCode: 'JC-2026-000001',
    status: state.booking as BookingSummary['status'],
    storeId: 1,
    storeCode: 'JC001',
    storeName: '大阪本町店',
    timezone: 'Asia/Tokyo',
    businessDate: D,
    roomGroupId: 10,
    roomTypeId: 1,
    roomGroupName: '4麻ルーム',
    requestedRoomId: null,
    requestedRoomName: null,
    capacity: 4,
    start: jst(D, '13:00'),
    end: jst(D, '17:00'),
    guestCount: 4,
    holdExpiresAt: state.holdExpiresAt,
    memberId: 1,
    regularPrice: 6_000,
    subtotal: 5_800,
    discount: 0,
    total: state.total,
  })

  const bookings = {
    findByRequestKey: async () => summary(),
    withInventoryLock: async (_g: number, _d: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        loadInventory: async (storeId: number, from: Date, to: Date, at: Date) => {
          const inv = await base.inventory.load(storeId, from, to, at)
          return { ...inv, bookings: [...inv.bookings, ...(options.others ?? [])] }
        },
        bookingState: async () => ({ status: state.booking, holdExpiresAt: state.holdExpiresAt }),
        confirm: async (input: { paymentId: number | null }) => {
          state.booking = 'confirmed'
          if (input.paymentId) state.payment = 'succeeded'
          log.confirmed.push({ paymentId: input.paymentId })
        },
        recordUnconfirmablePayment: async () => {
          state.payment = 'succeeded'
          log.refundsRequested++
          return { refundId: 9, idempotencyKey: 'refund-key' }
        },
      }),
  } as unknown as BookingRepository

  const checkouts: CheckoutRepository = {
    pendingCheckoutIds: async () => [],
    prepare: async (input) => {
      log.prepared.push(input)
      state.total = 5_800 - (input.coupon?.discount ?? 0)
      return { paymentId: input.payment ? 1 : null, total: state.total }
    },
    attachCheckout: async () => {},
    findByCheckout: async (id) =>
      id === 'cs_1'
        ? {
            paymentId: 1,
            status: state.payment,
            amount: state.total,
            method: 'card',
            bookingId: 1,
            bookingStatus: state.booking,
            storeCode: 'JC001',
            roomGroupId: 10,
            requestedRoomId: null,
            businessDate: D,
            start: jst(D, '13:00'),
            end: jst(D, '17:00'),
            holdExpiresAt: state.holdExpiresAt,
          }
        : null,
    cancelPayment: async () => {},
    succeededPayment: async () => null,
    refundablePayments: async () => [],
    createRefund: async () => 0,
    finishRefund: async () => {},
  }

  const gateway: PaymentGateway = {
    provider: 'fake',
    environment: 'test',
    accountId: 'acct',
    createCheckout: async (input) => {
      log.checkouts.push(input)
      return { checkoutId: 'cs_1', url: 'https://pay.example/cs_1' }
    },
    getCheckout: async () => ({
      status: 'complete',
      paid: true,
      externalPaymentId: 'pi_1',
      amount: 0,
    }),
    expireCheckout: async () => {},
    refund: async (input) => {
      log.refunded.push(input.externalPaymentId)
      return { refundId: 're_1' }
    },
    parseWebhook: async (raw) => ({
      ...(JSON.parse(raw) as PaymentEvent),
      payloadSha256: 'x',
      eventType: 'checkout.session.completed',
    }),
  }

  const seenEvents = new Map<string, boolean>()
  const deps: CheckoutDeps = {
    bookings,
    checkouts,
    coupons: {
      usableGrants: async () => options.offers ?? [],
      findClaimableByCode: async () => null,
      findByTrigger: async () => [],
      grant: async () => 1,
    },
    members: {
      findById: async () => ({
        id: 1,
        memberCode: 'JC-U-000001',
        phone: '+819012345678',
        familyName: '山田',
        givenName: '太郎',
        email: options.email === undefined ? 'taro@example.com' : options.email,
        status: options.suspended ? 'suspended' : 'active',
      }),
      findByPhone: async () => null,
      createPhoneMember: async () => {
        throw new Error('unused')
      },
    },
    stores: base.stores,
    legalDocuments: {
      current: async (types) => types.map((type, i) => ({ id: i + 1, type, version: 'v1' })),
    },
    gateway,
    webhooks: {
      record: async (e) => {
        const processed = seenEvents.get(e.eventId)
        seenEvents.set(e.eventId, processed ?? false)
        return { id: 1, duplicate: processed !== undefined, processed: processed === true }
      },
      finish: async () => {
        for (const key of seenEvents.keys()) seenEvents.set(key, true)
      },
    },
    clock: base.clock,
    newKey: () => 'idem-1',
  }
  return { deps, state, log }
}

const startInput = {
  requestKey: 'key',
  memberId: 1,
  method: 'card' as const,
  successUrl: 'https://app/done',
  cancelUrl: 'https://app/pay',
}

describe('getPaymentOptions (C-09)', () => {
  it('lists applicable coupons first, largest discount first', async () => {
    const { deps } = world({
      offers: [
        offer(1, {}),
        offer(2, { storeIds: [99] }),
        offer(3, { discountType: 'percent', discountValue: 10 }),
      ],
    })
    const options = await makeGetPaymentOptions(deps)('key', 1)
    expect(options.coupons.map((c) => [c.grantId, c.discount, c.rejection])).toEqual([
      [3, 580, null],
      [1, 500, null],
      [2, null, 'store_not_eligible'],
    ])
    expect(options.bestGrantId).toBe(3)
  })

  it("refuses another member's hold", async () => {
    const { deps } = world()
    await expect(makeGetPaymentOptions(deps)('key', 2)).rejects.toMatchObject({
      code: 'verification_required',
    })
  })
})

describe('startCheckout (C-09 → C-10)', () => {
  it('rejects suspended accounts and missing required email before preparing payment', async () => {
    for (const [options, code] of [
      [{ suspended: true }, 'member_cannot_book'],
      [{ email: null }, 'email_required'],
    ] as const) {
      const w = world(options)
      await expect(
        makeStartCheckout(w.deps)({ ...startInput, grantId: null }),
      ).rejects.toMatchObject({ code })
      expect(w.log.prepared).toHaveLength(0)
      expect(w.log.checkouts).toHaveLength(0)
    }
  })
  it('reserves the coupon, records the policy and opens checkout for the discounted total', async () => {
    const { deps, log } = world({ offers: [offer(1, {})] })
    const result = await makeStartCheckout(deps)({ ...startInput, grantId: 1 })
    expect(result).toEqual({ kind: 'redirect', url: 'https://pay.example/cs_1' })
    expect(log.prepared[0]).toMatchObject({
      coupon: { grantId: 1, discount: 500 },
      policyDocumentId: 1,
      payment: { method: 'card', idempotencyKey: 'idem-1' },
    })
    expect(log.checkouts[0]).toMatchObject({ amount: 5_300, idempotencyKey: 'idem-1' })
  })

  it('confirms immediately when the coupon covers the whole price', async () => {
    const { deps, log, state } = world({ offers: [offer(1, { discountValue: 10_000 })] })
    expect(await makeStartCheckout(deps)({ ...startInput, grantId: 1 })).toEqual({
      kind: 'confirmed',
    })
    expect(log.checkouts).toHaveLength(0)
    expect(log.confirmed).toEqual([{ paymentId: null }])
    expect(state.booking).toBe('confirmed')
  })

  it('rejects a coupon that does not apply', async () => {
    const { deps } = world({ offers: [offer(1, { minimumSpend: 10_000 })] })
    await expect(makeStartCheckout(deps)({ ...startInput, grantId: 1 })).rejects.toMatchObject({
      code: 'coupon_not_applicable',
    })
  })
})

describe('confirmCheckout (C-10 → C-11)', () => {
  it('confirms within the hold, and is idempotent', async () => {
    const { deps, log } = world()
    const confirm = makeConfirmCheckout(deps)
    expect(await confirm('cs_1', { externalPaymentId: 'pi_1', amount: 5_800 })).toBe('confirmed')
    expect(await confirm('cs_1', { externalPaymentId: 'pi_1', amount: 5_800 })).toBe(
      'already_confirmed',
    )
    expect(log.confirmed).toHaveLength(1)
  })

  it('confirms a late payment when the time is still free', async () => {
    const { deps, state } = world({ now: '2026-11-01T12:20:00+09:00' })
    state.booking = 'expired'
    expect(
      await makeConfirmCheckout(deps)('cs_1', { externalPaymentId: 'pi_1', amount: 5_800 }),
    ).toBe('confirmed')
  })

  it('refunds a late payment when the time was taken meanwhile', async () => {
    const taken = (roomId: number): OccupyingBooking => ({
      groupId: 10,
      roomId,
      range: { start: jst(D, '12:00'), end: jst(D, '18:00') },
    })
    const { deps, state, log } = world({
      now: '2026-11-01T12:20:00+09:00',
      others: [taken(1), taken(2)],
    })
    state.booking = 'expired'
    expect(
      await makeConfirmCheckout(deps)('cs_1', { externalPaymentId: 'pi_1', amount: 5_800 }),
    ).toBe('refunded')
    expect(log.refundsRequested).toBe(1)
    expect(log.refunded).toEqual(['pi_1'])
    expect(state.booking).toBe('expired')
  })

  it('rejects an amount that does not match the payment', async () => {
    const { deps } = world()
    await expect(
      makeConfirmCheckout(deps)('cs_1', { externalPaymentId: 'pi_1', amount: 100 }),
    ).rejects.toThrow(/expected 5800/)
  })
})

describe('handlePaymentWebhook', () => {
  it('processes an event once', async () => {
    const { deps, log } = world()
    const handle = makeHandlePaymentWebhook(deps)
    const body = JSON.stringify({
      kind: 'checkout_paid',
      eventId: 'evt_1',
      checkoutId: 'cs_1',
      externalPaymentId: 'pi_1',
      amount: 5_800,
    })
    expect(await handle(body, 'sig')).toEqual({ status: 'processed' })
    expect(await handle(body, 'sig')).toEqual({ status: 'duplicate' })
    expect(log.confirmed).toHaveLength(1)
  })
})
