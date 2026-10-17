import { describe, expect, it } from 'vitest'
import type { MemberAdminRepository, MemberProfileView } from '../ports/admin-masters'
import type { StaffActor } from './admin-actor'
import {
  makeAddMemberNote,
  makeChangeMemberStatus,
  makeGetMemberDetail,
  makeSearchMembers,
  phoneDigits,
} from './members'

const owner: StaffActor = {
  staffId: 1,
  access: { staffId: 1, grants: [{ role: 'owner', storeId: null }] },
}
const storeStaff: StaffActor = {
  staffId: 2,
  access: { staffId: 2, grants: [{ role: 'admin', storeId: 10 }] },
}

function world() {
  const member: MemberProfileView = {
    id: 7,
    memberCode: 'JC-U-000007',
    familyName: '山田',
    givenName: '太郎',
    phone: '+819012345678',
    email: null,
    lineLinked: false,
    useCount: 1,
    lastUseDate: '2026-10-01',
    status: 'active',
    registeredAt: new Date('2026-09-01T00:00:00Z'),
    registrationSource: null,
    lineLinkedAt: null,
    lineFriendStatus: null,
    withdrawnAt: null,
  }
  const bookedAt = [20]
  const audits: { action: string; before?: unknown; after?: unknown; reason?: string | null }[] = []
  const searches: unknown[] = []
  const notes: { body: string; bookingId: number | null }[] = []
  const members: MemberAdminRepository = {
    search: async (s) => {
      searches.push(s)
      return { total: 1, rows: [member] }
    },
    findByCode: async (code) => (code === member.memberCode ? member : null),
    hasBookingAt: async (_id, stores) => stores.some((s) => bookedAt.includes(s)),
    bookings: async () => [],
    payments: async () => [],
    coupons: async () => [],
    consents: async () => [],
    notes: async () => [],
    bookingIdForMember: async (_id, code) => (code === 'B-1' ? 99 : null),
    setStatus: async (_id, status) => {
      Object.assign(member, { status })
    },
    addNote: async (n) => {
      notes.push(n)
      return notes.length
    },
  }
  const deps = {
    members,
    audit: { record: async (e: (typeof audits)[number]) => void audits.push(e) },
    clock: { now: () => new Date('2026-10-12T00:00:00Z') },
  }
  return { deps, member, audits, searches, notes, bookedAt }
}

describe('member search (A-11)', () => {
  it('limits store staff to members who booked at their stores and parses phone input', async () => {
    const { deps, searches } = world()
    await makeSearchMembers(deps)(storeStaff, { query: '090-1234', status: 'caution', page: 2 })
    expect(searches[0]).toMatchObject({
      text: '090-1234',
      phoneDigits: '901234',
      status: 'caution',
      storeIds: [10],
      offset: 50,
    })
    await makeSearchMembers(deps)(owner, { query: '山田' })
    expect(searches[1]).toMatchObject({ phoneDigits: null, storeIds: null })
  })

  it('reads phone fragments', () => {
    expect(phoneDigits('+81 90-1234')).toBe('901234')
    expect(phoneDigits('JC-U-0001')).toBeNull()
    expect(phoneDigits('12')).toBeNull()
  })
})

describe('member detail (A-12)', () => {
  it('hides members of other stores from store staff', async () => {
    const { deps } = world()
    await expect(makeGetMemberDetail(deps)(storeStaff, 'JC-U-000007')).rejects.toMatchObject({
      code: 'member_not_found',
    })
    const detail = await makeGetMemberDetail(deps)(owner, 'JC-U-000007')
    expect(detail.canManage).toBe(true)
  })

  it('changes status with a reason and audits before/after', async () => {
    const { deps, audits, member } = world()
    const change = makeChangeMemberStatus(deps)
    await expect(
      change(owner, { memberCode: member.memberCode, status: 'suspended', reason: ' ' }),
    ).rejects.toMatchObject({ code: 'reason_required' })
    await change(owner, { memberCode: member.memberCode, status: 'suspended', reason: '無断利用' })
    expect(member.status).toBe('suspended')
    expect(audits[0]).toMatchObject({
      action: 'member.status_change',
      before: { status: 'active' },
      after: { status: 'suspended' },
      reason: '無断利用',
    })
  })

  it('rejects withdrawn members and status changes without members.manage', async () => {
    const { deps, member } = world()
    const change = makeChangeMemberStatus(deps)
    await expect(
      change(
        { staffId: 3, access: { staffId: 3, grants: [{ role: 'cleaning', storeId: 10 }] } },
        { memberCode: member.memberCode, status: 'caution', reason: 'x' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    Object.assign(member, { status: 'withdrawn' })
    await expect(
      change(owner, { memberCode: member.memberCode, status: 'active', reason: 'x' }),
    ).rejects.toMatchObject({ code: 'member_withdrawn' })
  })

  it('adds a CS note linked to one of the member bookings', async () => {
    const { deps, notes, member } = world()
    const add = makeAddMemberNote(deps)
    await add(owner, { memberCode: member.memberCode, body: '鍵の問い合わせ', bookingCode: 'B-1' })
    expect(notes[0]).toMatchObject({ body: '鍵の問い合わせ', bookingId: 99 })
    await expect(
      add(owner, { memberCode: member.memberCode, body: 'x', bookingCode: 'OTHER' }),
    ).rejects.toMatchObject({ code: 'booking_not_found' })
  })
})
