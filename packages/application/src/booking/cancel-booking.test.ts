import { describe, expect, it } from 'vitest'
import type { BookingRepository, BookingSummary } from '../ports/booking-repository'
import type { CheckoutRepository, PaymentGateway } from '../ports/checkout'
import { type CancelDeps, makeCancelBooking, makeQuoteCancellation } from './cancel-booking'

const start = new Date('2026-11-10T04:00:00Z')

function world(now: string, opts: { refundFails?: boolean } = {}) {
  const summary = {
    id: 1,
    bookingCode: 'JC-2026-000001',
    status: 'confirmed',
    storeId: 1,
    roomGroupId: 10,
    businessDate: '2026-11-10',
    start,
    end: new Date('2026-11-10T08:00:00Z'),
    memberId: 5,
  } as BookingSummary
  const log = { cancel: [] as unknown[], refunds: [] as { amount: number; status: string }[] }
  const bookings = {
    findByCode: async (code: string) => (code === summary.bookingCode ? summary : null),
    withInventoryLock: async (_g: number, _d: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        cancel: async (input: unknown) => {
          log.cancel.push(input)
          return { cancellationId: 3 }
        },
      }),
  } as unknown as BookingRepository
  const checkouts = {
    refundablePayments: async () => [
      { paymentId: 9, externalPaymentId: 'pi_9', refundable: 5_300 },
    ],
    createRefund: async (input: { amount: number }) => {
      log.refunds.push({ amount: input.amount, status: 'requested' })
      return log.refunds.length
    },
    finishRefund: async (id: number, result: { error?: string }) => {
      const r = log.refunds[id - 1]
      if (r) r.status = 'error' in result ? 'failed' : 'succeeded'
    },
  } as unknown as CheckoutRepository
  const gateway = {
    refund: async () => {
      if (opts.refundFails) throw new Error('stripe down')
      return { refundId: 're_1' }
    },
  } as unknown as PaymentGateway
  const deps: CancelDeps = {
    bookings,
    checkouts,
    gateway,
    legalDocuments: {
      current: async () => [{ id: 4, type: 'cancellation_policy', version: 'v1' }],
    },
    audit: { record: async () => {} },
    clock: { now: () => new Date(now) },
  }
  return { deps, log }
}

describe('cancellation (C-15 / A-08)', () => {
  it('is free 24 hours or more before start, and returns the coupon', async () => {
    const { deps, log } = world('2026-11-09T04:00:00Z')
    const quote = await makeQuoteCancellation(deps)('JC-2026-000001')
    expect(quote).toMatchObject({
      paid: 5_300,
      feeRate: 0,
      fee: 0,
      refund: 5_300,
      changeAllowed: true,
    })
    const result = await makeCancelBooking(deps)({
      bookingCode: 'JC-2026-000001',
      actor: { type: 'member', memberId: 5 },
      memberId: 5,
    })
    expect(result).toMatchObject({ fee: 0, refund: 5_300, refundFailed: false })
    expect(log.cancel[0]).toMatchObject({ reverseCoupon: true, manualOverride: false })
    expect(log.refunds).toEqual([{ amount: 5_300, status: 'succeeded' }])
  })

  it('charges 50% within 24 hours and keeps the coupon used', async () => {
    const { deps, log } = world('2026-11-09T12:00:00Z')
    const result = await makeCancelBooking(deps)({
      bookingCode: 'JC-2026-000001',
      actor: { type: 'member', memberId: 5 },
      memberId: 5,
    })
    expect(result).toMatchObject({ feeRate: 50, fee: 2_650, refund: 2_650 })
    expect(log.cancel[0]).toMatchObject({ reverseCoupon: false })
  })

  it("does not let a member cancel someone else's booking", async () => {
    const { deps } = world('2026-11-09T04:00:00Z')
    await expect(
      makeCancelBooking(deps)({
        bookingCode: 'JC-2026-000001',
        actor: { type: 'member', memberId: 6 },
        memberId: 6,
      }),
    ).rejects.toMatchObject({ code: 'booking_not_found' })
  })

  it('lets staff override the fee with a reason, and records failed refunds for follow-up', async () => {
    const { deps, log } = world('2026-11-10T05:00:00Z', { refundFails: true })
    const cancel = makeCancelBooking(deps)
    await expect(
      cancel({
        bookingCode: 'JC-2026-000001',
        actor: { type: 'staff', staffId: 2 },
        overrideFeeRate: 0,
      }),
    ).rejects.toMatchObject({ code: 'reason_required' })
    const result = await cancel({
      bookingCode: 'JC-2026-000001',
      actor: { type: 'staff', staffId: 2 },
      overrideFeeRate: 0,
      reason: '鍵トラブルのため',
    })
    expect(result).toMatchObject({ fee: 0, refund: 5_300, refundFailed: true })
    expect(log.cancel[0]).toMatchObject({
      automaticFeeRate: 100,
      appliedFeeRate: 0,
      manualOverride: true,
    })
    expect(log.refunds[0]?.status).toBe('failed')
  })
})
