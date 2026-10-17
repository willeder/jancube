import type { StaffAccess } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { jst } from '../booking/test-fixtures'
import type {
  AdminBookingQueries,
  BookingSearchFilter,
  NotificationResendRepository,
  TimelineRoom,
} from '../ports/admin-bookings'
import { storeFilter } from './access'
import { buildTimelineRows, makeResendNotification, makeSearchBookings, packRows } from './bookings'

const D = '2026-11-10'
const owner: StaffAccess = { staffId: 1, grants: [{ role: 'owner', storeId: null }] }
const storeStaff: StaffAccess = { staffId: 7, grants: [{ role: 'admin', storeId: 1 }] }
const cleaning: StaffAccess = { staffId: 9, grants: [{ role: 'cleaning', storeId: 1 }] }

describe('storeFilter (F-ADM-02 / F-ADM-04)', () => {
  it('limits lists to the selected store or the stores the staff member may see', () => {
    expect(storeFilter(owner, 'bookings.view', null)).toBeNull()
    expect(storeFilter(owner, 'bookings.view', 3)).toEqual([3])
    expect(storeFilter(storeStaff, 'bookings.view', null)).toEqual([1])
    expect(() => storeFilter(storeStaff, 'bookings.view', 2)).toThrow('missing permission')
    expect(() => storeFilter(cleaning, 'bookings.view', null)).toThrow('missing permission')
  })
})

describe('searchBookings (A-04)', () => {
  it('passes the scope, page and normalized phone digits to the query', async () => {
    let seen: BookingSearchFilter | null = null
    const queries = {
      search: async (f: BookingSearchFilter) => {
        seen = f
        return { rows: [], total: 45 }
      },
    } as unknown as AdminBookingQueries
    const result = await makeSearchBookings({ queries })(storeStaff, null, {
      phone: '０９０-1234-5678',
      name: '山田 太郎',
      status: 'confirmed',
      page: 3,
    })
    expect(seen).toMatchObject({
      stores: [1],
      phoneDigits: '9012345678',
      name: '山田太郎',
      statuses: ['confirmed'],
      offset: 40,
      limit: 20,
    })
    expect(result.pages).toBe(3)
    await expect(
      makeSearchBookings({ queries })(storeStaff, null, { dateFrom: '2026-13-01' }),
    ).rejects.toMatchObject({ code: 'invalid_date' })
  })
})

describe('buildTimelineRows (A-03)', () => {
  const rooms: TimelineRoom[] = [
    {
      id: 1,
      groupId: 10,
      groupName: '4麻ルーム',
      bookingMode: 'group',
      code: 'Room1',
      name: 'Room1',
      operatingStatus: 'active',
      cleaningStatus: 'clean',
    },
    {
      id: 7,
      groupId: 10,
      groupName: '4麻ルーム',
      bookingMode: 'group',
      code: 'Room7',
      name: 'Room7',
      operatingStatus: 'paused',
      cleaningStatus: 'dirty',
    },
  ]
  const base = {
    status: 'confirmed' as const,
    groupId: 10,
    assignmentStatus: null,
    customerName: '山田',
    guestCount: 4,
    holdExpiresAt: null,
  }

  it('places assigned bookings on their room and stacks waiting ones', () => {
    const rows = buildTimelineRows({
      date: D,
      timezone: 'Asia/Tokyo',
      now: jst(D, '09:00'),
      rooms,
      bookings: [
        {
          ...base,
          bookingCode: 'A',
          roomId: 1,
          assignmentStatus: 'provisional',
          start: jst(D, '12:00'),
          end: jst(D, '15:00'),
        },
        { ...base, bookingCode: 'B', roomId: null, start: jst(D, '13:00'), end: jst(D, '16:00') },
        { ...base, bookingCode: 'C', roomId: null, start: jst(D, '14:00'), end: jst(D, '17:00') },
        {
          ...base,
          bookingCode: 'H',
          status: 'draft',
          roomId: null,
          holdExpiresAt: jst(D, '08:00'), // lapsed hold: not shown
          start: jst(D, '18:00'),
          end: jst(D, '19:00'),
        },
      ],
      blocks: [{ id: 1, roomId: 7, start: jst(D, '10:00'), end: jst(D, '24:00'), reason: '休止' }],
    })
    expect(rows.map((r) => r.key)).toEqual([
      'room:1',
      'room:7',
      'unassigned:10:0',
      'unassigned:10:1',
    ])
    expect(rows[0]?.items[0]).toMatchObject({
      bookingCode: 'A',
      startMinute: 720,
      endMinute: 900,
      provisional: true,
    })
    expect(rows[1]).toMatchObject({ inactive: true, dirty: true, items: [{ kind: 'block' }] })
    expect(rows[2]?.items.map((i) => i.bookingCode)).toEqual(['B'])
    expect(rows[3]?.items.map((i) => i.bookingCode)).toEqual(['C'])
  })

  it('packs non-overlapping items on one row', () => {
    const rows = packRows([
      { startMinute: 600, endMinute: 660 },
      { startMinute: 660, endMinute: 720 },
      { startMinute: 630, endMinute: 700 },
    ])
    expect(rows.map((r) => r.length)).toEqual([2, 1])
  })
})

describe('resendNotification (A-05)', () => {
  function world(storeId: number | null = 1) {
    const requeued: { id: number; key: string }[] = []
    const audit: string[] = []
    const deliveries: NotificationResendRepository = {
      findDelivery: async (id) =>
        id === 5 ? { id, bookingId: 9, storeId, deduplicationKey: 'room_assigned:9' } : null,
      requeueCopy: async (id, key) => void requeued.push({ id, key }),
    }
    const deps = {
      deliveries,
      audit: { record: async (e: { action: string }) => void audit.push(e.action) },
      clock: { now: () => new Date('2026-11-09T10:00:00Z') },
    }
    return { deps, requeued, audit }
  }

  it('queues a copy under a new key and records it', async () => {
    const { deps, requeued, audit } = world()
    await makeResendNotification(deps)(storeStaff, 5)
    expect(requeued).toEqual([
      { id: 5, key: `room_assigned:9:resend:${Date.parse('2026-11-09T10:00:00Z')}` },
    ])
    expect(audit).toEqual(['notification.resend'])
  })

  it('refuses deliveries of other stores and unknown ones', async () => {
    const { deps, requeued } = world(2)
    await expect(makeResendNotification(deps)(storeStaff, 5)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(makeResendNotification(deps)(storeStaff, 6)).rejects.toMatchObject({
      code: 'notification_not_found',
    })
    expect(requeued).toEqual([])
  })
})
