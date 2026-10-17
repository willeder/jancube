import type { StaffAccess } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { fakeHoldDeps, jst } from '../booking/test-fixtures'
import type { NotifyRequest } from '../notifications/notify'
import type { PaymentLinkRecord, PaymentLinkRepository } from '../ports/admin-bookings'
import type { MemberRecord } from '../ports/member-repository'
import {
  makeCreateProxyBooking,
  makeGetPaymentLink,
  makeLookupMemberByPhone,
  makeOpenPaymentLink,
  type ProxyBookingDeps,
} from './proxy-booking'

const D = '2026-11-10'
const storeStaff: StaffAccess = { staffId: 7, grants: [{ role: 'admin', storeId: 1 }] }
const otherStoreStaff: StaffAccess = { staffId: 8, grants: [{ role: 'admin', storeId: 2 }] }
const cleaning: StaffAccess = { staffId: 9, grants: [{ role: 'cleaning', storeId: 1 }] }

const member: MemberRecord = {
  id: 55,
  memberCode: 'M-000055',
  phone: '+819011112222',
  familyName: '佐藤',
  givenName: '花子',
  email: 'hanako@example.test',
  status: 'active',
}

function world(now = '2026-11-01T12:00:00+09:00') {
  const hold = fakeHoldDeps(now)
  const links: (PaymentLinkRecord & { tokenHash: string; bookingId: number })[] = []
  const notified: NotifyRequest[] = []
  const audit: { action: string; after?: unknown }[] = []
  const paymentLinks: PaymentLinkRepository = {
    create: async (link) => {
      const id = links.length + 1
      links.push({
        id,
        bookingId: link.bookingId,
        bookingCode: `JC-2026-${String(link.bookingId).padStart(6, '0')}`,
        requestKey: hold.drafts.find((d) => d.id === link.bookingId)?.requestKey ?? '',
        contactPhone: hold.drafts.find((d) => d.id === link.bookingId)?.contact?.phone ?? null,
        expiresAt: link.expiresAt,
        usedAt: null,
        revokedAt: null,
        issuedByName: '店舗 田牧',
        tokenHash: link.tokenHash,
      })
      return id
    },
    findByTokenHash: async (hash) => links.find((l) => l.tokenHash === hash) ?? null,
    listIssued: async () => [],
  }
  const deps: ProxyBookingDeps = {
    ...hold.deps,
    members: {
      findById: async (id) => (id === member.id ? member : null),
      findByPhone: async (phone) => (phone === member.phone ? member : null),
      createPhoneMember: async () => member,
    },
    paymentLinks,
    // Stand-in for HMAC: reversible but never equal to the token itself.
    hasher: { hash: async (s) => `h(${[...s].reverse().join('')})` },
    random: { digits: () => '000000', token: () => 'ab'.repeat(24) },
    notify: async (request) => {
      notified.push(request)
      return { status: 'queued', channel: 'sms' }
    },
    audit: { record: async (e) => void audit.push(e) },
    appUrl: 'https://jancube.test',
  }
  return { deps, drafts: hold.drafts, links, notified, audit }
}

const input = (phone = '090-3333-4444') => ({
  storeCode: 'JC001',
  date: D,
  laneKey: 'g:4MA',
  start: jst(D, '19:00').toISOString(),
  end: jst(D, '22:00').toISOString(),
  guestCount: 3,
  phone,
  familyName: '山田',
  givenName: '太郎',
})

describe('A-06 代理予約作成', () => {
  it('holds the time for 30 minutes and sends a payment link by SMS', async () => {
    const { deps, drafts, links, notified, audit } = world()
    const result = await makeCreateProxyBooking(deps)(storeStaff, input())

    expect(drafts[0]).toMatchObject({
      source: 'proxy',
      createdByStaffId: 7,
      guestCount: 3,
      contact: { memberId: null, familyName: '山田', phone: '+819033334444' },
    })
    const token = 'ab'.repeat(24)
    expect(result.paymentUrl).toBe(`https://jancube.test/pay/${token}`)
    expect(result.expiresAt.toISOString()).toBe(new Date('2026-11-01T12:30:00+09:00').toISOString())
    // Only the hash of the token is stored; the link expires with the hold (CQ-23).
    expect(links[0]?.tokenHash).not.toContain(token)
    expect(links[0]?.expiresAt).toEqual(result.expiresAt)
    expect(notified[0]).toMatchObject({
      event: 'payment_link',
      smsTo: '+819033334444',
      memberId: null,
      paymentLinkId: 1,
      secretValueNames: ['paymentUrl'],
      deduplicationKey: 'payment_link:1',
    })
    expect(notified[0]?.values.paymentUrl).toBe(result.paymentUrl)
    expect(notified[0]?.values.linkExpiresAt).toBe('11/1 12:30')
    expect(audit[0]?.action).toBe('booking.proxy_create')
    expect(JSON.stringify(audit)).not.toContain(token)
  })

  it('books for the member registered with the phone number', async () => {
    const { deps, drafts } = world()
    const result = await makeCreateProxyBooking(deps)(storeStaff, {
      ...input('090-1111-2222'),
      familyName: '',
    })
    expect(result.member).toEqual({ memberCode: 'M-000055', name: '佐藤 花子' })
    expect(drafts[0]?.contact).toMatchObject({ memberId: 55, familyName: '佐藤' })
  })

  it('needs a name for a non-member and a store the staff member works at', async () => {
    const { deps } = world()
    const create = makeCreateProxyBooking(deps)
    await expect(create(storeStaff, { ...input(), familyName: ' ' })).rejects.toMatchObject({
      code: 'name_required',
    })
    await expect(create(otherStoreStaff, input())).rejects.toMatchObject({ code: 'forbidden' })
    await expect(create(cleaning, input())).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('looks up a member by phone for staff who may take bookings', async () => {
    const { deps } = world()
    const lookup = makeLookupMemberByPhone(deps)
    expect(await lookup(storeStaff, '090-1111-2222')).toMatchObject({ canBook: true })
    expect(await lookup(storeStaff, '090-9999-9999')).toBeNull()
    await expect(lookup(cleaning, '090-1111-2222')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('C-18 決済リンク着地', () => {
  const token = 'ab'.repeat(24)

  async function issued(now?: string) {
    const w = world()
    await makeCreateProxyBooking(w.deps)(storeStaff, input())
    const later = now ? { ...w.deps, clock: { now: () => new Date(now) } } : w.deps
    return { ...w, deps: later }
  }

  it('shows the booking while the link is valid', async () => {
    const { deps } = await issued()
    const view = await makeGetPaymentLink(deps)(token)
    expect(view).toMatchObject({ state: 'open', issuedByName: '店舗 田牧' })
  })

  it('rejects unknown tokens and expired links', async () => {
    const { deps } = await issued('2026-11-01T12:31:00+09:00')
    await expect(makeGetPaymentLink(deps)('cd'.repeat(24))).rejects.toMatchObject({
      code: 'payment_link_invalid',
    })
    await expect(makeGetPaymentLink(deps)('../x')).rejects.toMatchObject({
      code: 'payment_link_invalid',
    })
    await expect(makeGetPaymentLink(deps)(token)).rejects.toMatchObject({
      code: 'payment_link_expired',
    })
  })

  it('reports a link that was already paid', async () => {
    const { deps, links } = await issued()
    Object.assign(links[0] as object, { usedAt: new Date() })
    expect((await makeGetPaymentLink(deps)(token)).state).toBe('paid')
  })

  it('sends a customer who is not signed in to SMS sign-in with the hold', async () => {
    const { deps, drafts } = await issued()
    const opened = await makeOpenPaymentLink(deps)(token, null)
    expect(opened).toEqual({ requestKey: drafts[0]?.requestKey, next: 'sign_in' })
  })

  it('links a signed-in member with the booking phone number and goes to payment', async () => {
    const { deps, drafts, links } = await issued()
    // The booking was taken for the number this member signed in with.
    Object.assign(links[0] ?? {}, { contactPhone: member.phone })
    const opened = await makeOpenPaymentLink(deps)(token, member.id)
    expect(opened.next).toBe('payment')
    expect(drafts[0]?.contact).toMatchObject({ memberId: 55 })
  })

  it('asks a member signed in with another phone number to verify the booking number', async () => {
    const { deps, drafts } = await issued()
    expect((await makeOpenPaymentLink(deps)(token, member.id)).next).toBe('sign_in')
    expect(drafts[0]?.contact?.memberId).toBeNull()
  })

  it('asks a different signed-in member to sign in as the booking member', async () => {
    const w = world()
    await makeCreateProxyBooking(w.deps)(storeStaff, { ...input('090-1111-2222') })
    const opened = await makeOpenPaymentLink(w.deps)(token, 99)
    expect(opened.next).toBe('sign_in')
    expect(w.drafts[0]?.contact?.memberId).toBe(55)
  })
})
