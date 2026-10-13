import { describe, expect, it } from 'vitest'
import type {
  MemberAccount,
  MemberBookingDetail,
  MemberBookingRow,
  MemberCouponGrant,
  MyPageRepository,
} from '../ports/my-page'
import type { ReceiptRepository, ReceiptSource } from '../ports/receipts'
import {
  type MyPageDeps,
  makeGetMyBookingDetail,
  makeGetMyPage,
  makeListMyCoupons,
  makeUpdateMyEmail,
  makeWithdrawMember,
} from './my-page'
import { makeGetMyReceipt, makeIssueMyReceipt, type ReceiptDeps } from './receipt'

const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0))

const account: MemberAccount = {
  id: 5,
  memberCode: 'JC-U-000005',
  phone: '+819012345678',
  familyName: '山田',
  givenName: '太郎',
  email: 'taro@example.com',
  status: 'active',
  line: null,
}

const row = (code: string, over: Partial<MemberBookingRow>): MemberBookingRow => ({
  bookingCode: code,
  status: 'confirmed',
  storeCode: 'JC001',
  storeName: '大阪本町店',
  timezone: 'Asia/Tokyo',
  businessDate: '2026-11-10',
  start: new Date('2026-11-10T04:00:00Z'),
  end: new Date('2026-11-10T07:00:00Z'),
  roomGroupName: '4麻',
  roomName: 'Room6',
  assignment: 'provisional',
  total: 6_100,
  ...over,
})

const detail = (over: Partial<MemberBookingDetail> = {}): MemberBookingDetail => ({
  id: 1,
  bookingCode: 'JC-2026-000001',
  status: 'confirmed',
  memberId: 5,
  store: {
    id: 1,
    code: 'JC001',
    name: '大阪本町店',
    address: '大阪市',
    phone: null,
    accessText: null,
    mapUrl: null,
    entryGuideText: null,
    timezone: 'Asia/Tokyo',
  },
  businessDate: '2026-11-10',
  start: new Date('2026-11-10T04:00:00Z'),
  end: new Date('2026-11-10T07:00:00Z'),
  guestCount: 4,
  acquisitionSource: null,
  roomGroupId: 10,
  roomTypeId: 100,
  roomGroupName: '4麻',
  capacity: 4,
  requestedRoom: null,
  assignedRoom: { name: 'Room6', code: 'Room6', status: 'provisional' },
  price: {
    durationMinutes: 180,
    regularPrice: 6_600,
    packageDiscount: 0,
    subtotal: 6_600,
    discount: 500,
    total: 6_100,
    taxRatePercent: 10,
  },
  coupon: { grantId: 3, name: '初回500円OFF', discount: 500 },
  payments: [{ id: 9, method: 'card', amount: 6_100, paidAt: new Date('2026-11-01T00:00:00Z') }],
  refunds: [],
  cancellation: null,
  accessKey: {
    status: 'issued',
    validFrom: new Date('2026-11-10T03:45:00Z'),
    validTo: new Date('2026-11-10T07:15:00Z'),
    codeCiphertext: bytes('enc:4821'),
  },
  changeCount: 0,
  ...over,
})

function world(now: string, over: Partial<MyPageRepository> = {}) {
  const log = { audit: [] as { action: string; after?: unknown }[], withdrawn: [] as number[] }
  const myPage: MyPageRepository = {
    memberBookings: async () => [],
    bookingDetail: async (code) => (code === 'JC-2026-000001' ? detail() : null),
    couponGrants: async () => [],
    account: async (id) => (id === 5 ? account : null),
    updateEmail: async () => {},
    upcomingBookingCount: async () => 0,
    withdraw: async (id) => void log.withdrawn.push(id),
    ...over,
  }
  const deps: MyPageDeps = {
    myPage,
    secrets: {
      encrypt: async () => new Uint8Array(),
      decrypt: async (c) => String.fromCharCode(...c).replace('enc:', ''),
    },
    audit: { record: async (entry) => void log.audit.push(entry) },
    clock: { now: () => new Date(now) },
  }
  return { deps, log }
}

describe('my page (C-12)', () => {
  it('splits upcoming and past bookings with status badges', async () => {
    const { deps } = world('2026-11-05T00:00:00Z', {
      memberBookings: async () => [
        row('A', { assignment: 'final' }),
        row('B', {
          start: new Date('2026-11-20T10:00:00Z'),
          end: new Date('2026-11-20T13:00:00Z'),
          businessDate: '2026-11-20',
        }),
        row('C', {
          status: 'completed',
          start: new Date('2026-10-20T04:00:00Z'),
          end: new Date('2026-10-20T07:00:00Z'),
        }),
        row('D', { status: 'canceled', start: new Date('2026-10-25T04:00:00Z') }),
        row('E', {
          start: new Date('2026-11-01T04:00:00Z'),
          end: new Date('2026-11-01T07:00:00Z'),
        }),
      ],
    })
    const page = await makeGetMyPage(deps)(5)
    expect(page.upcoming.map((b) => [b.bookingCode, b.badge, b.displayRoom])).toEqual([
      ['A', 'confirmed', 'Room6'],
      ['B', 'provisional', null],
    ])
    expect(page.past.map((b) => [b.bookingCode, b.badge])).toEqual([
      ['E', 'used'],
      ['D', 'canceled'],
      ['C', 'used'],
    ])
  })

  it('treats a withdrawn member as signed out', async () => {
    const { deps } = world('2026-11-05T00:00:00Z', {
      account: async () => ({ ...account, status: 'withdrawn' }),
    })
    await expect(makeGetMyPage(deps)(5)).rejects.toMatchObject({ code: 'member_not_found' })
  })
})

describe('booking detail (C-13)', () => {
  it('hides room number and entry code until the day-before notice', async () => {
    const { deps } = world('2026-11-09T10:00:00Z')
    const view = await makeGetMyBookingDetail(deps)('JC-2026-000001', 5)
    expect(view.room).toBeNull()
    expect(view.entry).toBeNull()
    expect(view).toMatchObject({ canChange: false, canCancel: true, paid: 6_100 })
    expect(view.receipt).toEqual({ ok: false, reason: 'not_used_yet' })
  })

  it('shows them to the owner from the day-before notice', async () => {
    const { deps } = world('2026-11-09T11:00:00Z')
    const view = await makeGetMyBookingDetail(deps)('JC-2026-000001', 5)
    expect(view.room).toEqual({ name: 'Room6', announced: true })
    expect(view.entry).toMatchObject({ code: '4821' })
  })

  it('never shows a revoked key, and treats other members as not found', async () => {
    const { deps } = world('2026-11-09T12:00:00Z', {
      bookingDetail: async () =>
        detail({
          accessKey: {
            status: 'revoked',
            validFrom: new Date(),
            validTo: new Date(),
            codeCiphertext: new Uint8Array([1]),
          },
        }),
    })
    expect((await makeGetMyBookingDetail(deps)('JC-2026-000001', 5)).entry).toBeNull()
    await expect(makeGetMyBookingDetail(deps)('JC-2026-000001', 6)).rejects.toMatchObject({
      code: 'booking_not_found',
    })
  })

  it('allows changes only in the free-cancellation period', async () => {
    const { deps } = world('2026-11-08T00:00:00Z')
    expect((await makeGetMyBookingDetail(deps)('JC-2026-000001', 5)).canChange).toBe(true)
  })
})

describe('coupons (C-16)', () => {
  const grant = (over: Partial<MemberCouponGrant>): MemberCouponGrant => ({
    grantId: 1,
    couponName: '初回500円OFF',
    couponActive: true,
    conditionsNote: null,
    discountType: 'amount',
    discountValue: 500,
    maximumDiscount: null,
    minimumSpend: 0,
    maxUses: 1,
    used: 0,
    lastUsedAt: null,
    validFrom: new Date('2026-10-01T00:00:00Z'),
    expiresAt: new Date('2026-12-31T00:00:00Z'),
    revokedAt: null,
    weekdayMask: 127,
    startMinute: null,
    endMinute: null,
    storeCodes: [],
    ...over,
  })

  it('separates usable from used, expired and revoked coupons', async () => {
    const { deps } = world('2026-11-05T00:00:00Z', {
      couponGrants: async () => [
        grant({ grantId: 1, maxUses: 3, used: 1 }),
        grant({ grantId: 2, used: 1, lastUsedAt: new Date('2026-10-20T00:00:00Z') }),
        grant({ grantId: 3, expiresAt: new Date('2026-11-01T00:00:00Z') }),
        grant({ grantId: 4, revokedAt: new Date('2026-10-10T00:00:00Z') }),
      ],
    })
    const list = await makeListMyCoupons(deps)(5)
    expect(list.usable.map((c) => [c.grantId, c.remaining])).toEqual([[1, 2]])
    expect(list.inactive.map((c) => [c.grantId, c.state])).toEqual([
      [3, 'expired'],
      [2, 'used'],
      [4, 'revoked'],
    ])
  })
})

describe('account (C-17)', () => {
  it('updates the email without copying it into the audit log', async () => {
    const updates: (string | null)[] = []
    const { deps, log } = world('2026-11-05T00:00:00Z', {
      updateEmail: async (_id, email) => void updates.push(email),
    })
    await makeUpdateMyEmail(deps)(5, ' New@Example.com ')
    expect(updates).toEqual(['new@example.com'])
    expect(JSON.stringify(log.audit)).not.toContain('example.com')
    await expect(makeUpdateMyEmail(deps)(5, 'broken')).rejects.toMatchObject({
      code: 'invalid_email',
    })
  })

  it('blocks withdrawal while upcoming bookings exist', async () => {
    const { deps, log } = world('2026-11-05T00:00:00Z', { upcomingBookingCount: async () => 1 })
    await expect(makeWithdrawMember(deps)(5)).rejects.toMatchObject({ code: 'withdrawal_blocked' })
    expect(log.withdrawn).toEqual([])
  })

  it('withdraws and audits', async () => {
    const { deps, log } = world('2026-11-05T00:00:00Z')
    await makeWithdrawMember(deps)(5)
    expect(log.withdrawn).toEqual([5])
    expect(log.audit.map((a) => a.action)).toEqual(['member.withdraw'])
  })
})

describe('receipt (C-19)', () => {
  function receiptWorld(now: string, source: Partial<ReceiptSource> = {}) {
    const issued: Parameters<ReceiptRepository['issue']>[0][] = []
    const receipts: ReceiptRepository = {
      source: async () => ({
        bookingId: 1,
        bookingCode: 'JC-2026-000001',
        memberId: 5,
        status: 'confirmed',
        end: new Date('2026-11-10T07:00:00Z'),
        storeName: '大阪本町店',
        paymentId: 9,
        method: 'card',
        paidAt: new Date('2026-11-01T00:00:00Z'),
        paid: 6_100,
        refunded: 0,
        taxRatePercent: 10,
        ...source,
      }),
      current: async () => null,
      issue: async (input) => {
        issued.push(input)
        return {
          id: 1,
          receiptNumber: 'JC-2026-000001-R1',
          sequence: 1,
          recipientName: input.recipientName,
          issuerName: input.issuer.name,
          issuerAddress: input.issuer.address,
          invoiceRegistrationNo: input.issuer.invoiceRegistrationNo,
          total: input.lines[0]?.gross ?? 0,
          tax: input.lines[0]?.tax ?? 0,
          issuedAt: input.issuedAt,
          lines: input.lines,
        }
      },
    }
    const deps: ReceiptDeps = {
      receipts,
      issuer: (store) => ({ name: `会社 ${store}`, address: '大阪', invoiceRegistrationNo: null }),
      audit: { record: async () => {} },
      clock: { now: () => new Date(now) },
    }
    return { deps, issued }
  }

  it('cannot be issued before use', async () => {
    const { deps } = receiptWorld('2026-11-10T06:00:00Z')
    expect((await makeGetMyReceipt(deps)('JC-2026-000001', 5)).availability.ok).toBe(false)
    await expect(
      makeIssueMyReceipt(deps)({ bookingCode: 'JC-2026-000001', memberId: 5, recipientName: 'A' }),
    ).rejects.toMatchObject({ code: 'receipt_not_available' })
  })

  it('is issued after use for the amount kept, with the 10% breakdown', async () => {
    const { deps, issued } = receiptWorld('2026-11-10T08:00:00Z', { refunded: 1_000 })
    const receipt = await makeIssueMyReceipt(deps)({
      bookingCode: 'JC-2026-000001',
      memberId: 5,
      recipientName: ' 山田 太郎 ',
    })
    expect(issued[0]).toMatchObject({ paymentId: 9, recipientName: '山田 太郎' })
    expect(receipt.lines).toEqual([{ ratePercent: 10, taxable: 4_637, tax: 463, gross: 5_100 }])
    expect(receipt.issuerName).toBe('会社 大阪本町店')
  })

  it('is issued for the fee of a cancelled booking, and only for the owner', async () => {
    const { deps } = receiptWorld('2026-11-10T00:00:00Z', {
      status: 'canceled',
      refunded: 3_050,
    })
    const view = await makeGetMyReceipt(deps)('JC-2026-000001', 5)
    expect(view).toMatchObject({ amount: 3_050, availability: { ok: true } })
    await expect(makeGetMyReceipt(deps)('JC-2026-000001', 6)).rejects.toMatchObject({
      code: 'booking_not_found',
    })
  })
})
