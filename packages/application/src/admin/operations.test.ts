import type { StaffAccess } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import type { AlertWorkRepository, RefundRecord } from '../ports/admin-bookings'
import type { BookingRepository, BookingSummary } from '../ports/booking-repository'
import type { CheckoutRepository, PaymentGateway } from '../ports/checkout'
import { makeAssignAlert, makeResolveAlert } from './alerts'
import { makeRetryRefund, type PaymentHistoryDeps } from './payments'
import { makeStaffCancelBooking } from './staff-cancel'

const owner: StaffAccess = { staffId: 1, grants: [{ role: 'owner', storeId: null }] }
const storeStaff: StaffAccess = { staffId: 7, grants: [{ role: 'admin', storeId: 1 }] }
const otherStore: StaffAccess = { staffId: 8, grants: [{ role: 'admin', storeId: 2 }] }
const now = new Date('2026-11-09T10:00:00Z')

describe('retryRefund (A-26)', () => {
  function world(fails: boolean, status = 'failed') {
    const refund: RefundRecord = {
      id: 4,
      bookingId: 9,
      bookingCode: 'JC-2026-000009',
      storeId: 1,
      paymentId: 3,
      externalPaymentId: 'pi_3',
      amount: 2_650,
      idempotencyKey: 'cancel:2:3',
      status,
    }
    const log = {
      gateway: [] as { idempotencyKey: string; amount: number }[],
      finished: [] as unknown[],
      raised: [] as string[],
      resolved: [] as string[],
      audit: [] as string[],
    }
    const deps: PaymentHistoryDeps = {
      history: {
        list: async () => [],
        totals: async () => ({ paid: 0, refunded: 0, pending: 0 }),
        findRefund: async (id) => (id === 4 ? refund : null),
      },
      checkouts: {
        finishRefund: async (_id: number, result: unknown) => void log.finished.push(result),
      } as unknown as CheckoutRepository,
      gateway: {
        refund: async (input: { idempotencyKey: string; amount: number }) => {
          log.gateway.push(input)
          if (fails) throw new Error('card_declined')
          return { refundId: 're_4' }
        },
      } as unknown as PaymentGateway,
      alerts: {
        raise: async (a) => void log.raised.push(a.alertKey),
        resolve: async (key) => void log.resolved.push(key),
      },
      audit: { record: async (e) => void log.audit.push(e.action) },
      clock: { now: () => now },
    }
    return { deps, log }
  }

  it('retries with the original idempotency key', async () => {
    const { deps, log } = world(false)
    expect(await makeRetryRefund(deps)(storeStaff, 4)).toEqual({ ok: true, error: null })
    expect(log.gateway).toEqual([
      { externalPaymentId: 'pi_3', amount: 2_650, idempotencyKey: 'cancel:2:3' },
    ])
    expect(log.finished[0]).toMatchObject({ externalRefundId: 're_4' })
    expect(log.resolved).toEqual(['refund_failed:4'])
    expect(log.audit).toEqual(['refund.retry'])
  })

  it('keeps the refund failed and raises an alert when it fails again', async () => {
    const { deps, log } = world(true)
    expect(await makeRetryRefund(deps)(storeStaff, 4)).toEqual({
      ok: false,
      error: 'card_declined',
    })
    expect(log.finished[0]).toEqual({ error: 'card_declined' })
    expect(log.raised).toEqual(['refund_failed:4'])
  })

  it('refuses refunds that succeeded or belong to another store', async () => {
    await expect(makeRetryRefund(world(false, 'succeeded').deps)(owner, 4)).rejects.toMatchObject({
      code: 'refund_not_retryable',
    })
    await expect(makeRetryRefund(world(false).deps)(otherStore, 4)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('alerts (A-25)', () => {
  function world(storeId: number | null, status: 'open' | 'resolved' = 'open') {
    const log = { assigned: [] as number[], resolved: [] as number[], audit: [] as string[] }
    const alerts = {
      find: async (id: number) => ({ id, storeId, status }),
      assign: async (_id: number, staffId: number) => void log.assigned.push(staffId),
      resolveById: async (id: number) => void log.resolved.push(id),
    } as unknown as AlertWorkRepository
    const deps = {
      alerts,
      audit: { record: async (e: { action: string }) => void log.audit.push(e.action) },
      clock: { now: () => now },
    }
    return { deps, log }
  }

  it('assigns to the current staff member and resolves', async () => {
    const { deps, log } = world(1)
    await makeAssignAlert(deps)(storeStaff, 11)
    await makeResolveAlert(deps)(storeStaff, 11, '電話でご案内済み')
    expect(log).toEqual({
      assigned: [7],
      resolved: [11],
      audit: ['alert.assign', 'alert.resolve'],
    })
  })

  it('keeps alerts without a store for all-store staff', async () => {
    const { deps } = world(null)
    await expect(makeAssignAlert(deps)(storeStaff, 11)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await makeAssignAlert(deps)(owner, 11)
  })

  it('does not reopen a resolved alert', async () => {
    const { deps } = world(1, 'resolved')
    await expect(makeAssignAlert(deps)(storeStaff, 11)).rejects.toMatchObject({
      code: 'alert_resolved',
    })
  })
})

describe('staffCancelBooking (A-08)', () => {
  it('checks the store of the booking before cancelling', async () => {
    const bookings = {
      findByCode: async () => ({ id: 1, storeId: 1, status: 'confirmed' }) as BookingSummary,
    } as unknown as BookingRepository
    const deps = {
      bookings,
      checkouts: {} as CheckoutRepository,
      gateway: {} as PaymentGateway,
      legalDocuments: { current: async () => [] },
      audit: { record: async () => {} },
      clock: { now: () => now },
    }
    await expect(
      makeStaffCancelBooking(deps)(otherStore, {
        bookingCode: 'JC-2026-000001',
        overrideFeeRate: null,
        reason: null,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
