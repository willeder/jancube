import { DomainError } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import type {
  BookingRepository,
  BookingSummary,
  NewDraftBooking,
} from '../ports/booking-repository'
import { type HoldDeps, makeCreateHold, makeGetActiveHold, makeSetGuestCount } from './hold'
import { fakeBookingDeps, jst } from './test-fixtures'

const D = '2026-11-10'

function holdDeps(now = '2026-11-01T12:00:00+09:00') {
  const base = fakeBookingDeps({ now })
  const drafts: (NewDraftBooking & { id: number; status: BookingSummary['status'] })[] = []
  let seq = 0
  const bookings: BookingRepository = {
    withInventoryLock: async (_g, _d, fn) =>
      fn({
        loadInventory: async (storeId, from, to, at) => {
          const inv = await base.inventory.load(storeId, from, to, at)
          const live = drafts.filter((d) => d.status === 'draft' && d.holdExpiresAt > at)
          return {
            ...inv,
            bookings: [
              ...inv.bookings,
              ...live.map((d) => ({
                groupId: d.roomGroupId,
                roomId: d.requestedRoomId,
                range: { start: d.start, end: d.end },
              })),
            ],
          }
        },
        createDraft: async (draft) => {
          seq++
          drafts.push({ ...draft, id: seq, status: 'draft' })
          return { id: seq, bookingCode: `JC-2026-${String(seq).padStart(6, '0')}` }
        },
      }),
    findByRequestKey: async (key) => {
      const d = drafts.find((x) => x.requestKey === key)
      if (!d) return null
      return {
        id: d.id,
        bookingCode: `JC-2026-${String(d.id).padStart(6, '0')}`,
        status: d.status,
        storeId: d.storeId,
        storeCode: 'JC001',
        storeName: '大阪本町店',
        timezone: 'Asia/Tokyo',
        businessDate: d.businessDate,
        roomGroupName: '4麻ルーム',
        requestedRoomName: null,
        capacity: 4,
        start: d.start,
        end: d.end,
        guestCount: d.guestCount,
        holdExpiresAt: d.holdExpiresAt,
        memberId: null,
        regularPrice: d.quote.regularPrice,
        subtotal: d.quote.price,
        discount: 0,
        total: d.quote.price,
      }
    },
    expireDraft: async (key) => {
      for (const d of drafts) if (d.requestKey === key && d.status === 'draft') d.status = 'expired'
    },
    setGuestCount: async (key, n) => {
      const d = drafts.find((x) => x.requestKey === key)
      if (d) Object.assign(d, { guestCount: n })
    },
  }
  let keys = 0
  const deps: HoldDeps = { ...base, bookings, newRequestKey: () => `key-${++keys}` }
  return { deps, drafts }
}

const request = (start = '13:00', end = '17:00', laneKey = 'g:4MA') => ({
  storeCode: 'JC001',
  date: D,
  laneKey,
  start: jst(D, start).toISOString(),
  end: jst(D, end).toISOString(),
  source: 'web' as const,
})

describe('createHold (C-03 → C-04)', () => {
  it('creates a 10-minute draft with the quoted price', async () => {
    const { deps, drafts } = holdDeps()
    const hold = await makeCreateHold(deps)(request())
    expect(hold.bookingCode).toBe('JC-2026-000001')
    expect(drafts[0]?.quote.price).toBe(5_800)
    expect(drafts[0]?.holdExpiresAt.toISOString()).toBe(
      new Date('2026-11-01T12:10:00+09:00').toISOString(),
    )
    expect(drafts[0]?.guestCount).toBe(4)
  })

  it('refuses a hold once every room of the type is held for that time', async () => {
    const { deps } = holdDeps()
    const createHold = makeCreateHold(deps)
    await createHold(request())
    await createHold(request()) // the fixture's 4麻 group has 2 rooms
    await expect(createHold(request('14:00', '15:00'))).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('replacing a selection releases the previous hold', async () => {
    const { deps, drafts } = holdDeps()
    const createHold = makeCreateHold(deps)
    const first = await createHold(request())
    await createHold({ ...request('18:00', '20:00'), previousRequestKey: first.requestKey })
    expect(drafts[0]?.status).toBe('expired')
  })

  it('books a named room (VIP) as a requested room', async () => {
    const { deps, drafts } = holdDeps()
    await makeCreateHold(deps)(request('13:00', '15:00', 'r:Room12'))
    expect(drafts[0]?.requestedRoomId).toBe(12)
    expect(drafts[0]?.quote.price).toBe(5_000)
  })
})

describe('getActiveHold / setGuestCount (C-04)', () => {
  it('reports an expired hold', async () => {
    const { deps } = holdDeps()
    const hold = await makeCreateHold(deps)(request())
    const later = { ...deps, clock: { now: () => new Date('2026-11-01T12:11:00+09:00') } }
    await expect(makeGetActiveHold(later)(hold.requestKey)).rejects.toMatchObject({
      code: 'hold_expired',
    })
  })

  it('accepts 1…capacity guests', async () => {
    const { deps, drafts } = holdDeps()
    const hold = await makeCreateHold(deps)(request())
    await makeSetGuestCount(deps)(hold.requestKey, 3)
    expect(drafts[0]?.guestCount).toBe(3)
    await expect(makeSetGuestCount(deps)(hold.requestKey, 5)).rejects.toBeInstanceOf(DomainError)
  })
})
