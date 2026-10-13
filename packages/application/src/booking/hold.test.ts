import { DomainError } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import { makeCreateHold, makeGetActiveHold, makeSetGuestCount } from './hold'
import { fakeHoldDeps as holdDeps, jst } from './test-fixtures'

const D = '2026-11-10'

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

describe('createHold for a phone booking (A-06, source = proxy)', () => {
  const proxy = {
    staffId: 7,
    guestCount: 3,
    contact: {
      memberId: null,
      familyName: '山田',
      givenName: '太郎',
      phone: '+819012345678',
      email: null,
    },
  }

  it('holds for the proxy hold time and records the staff member and customer', async () => {
    const { deps, drafts } = holdDeps()
    await makeCreateHold(deps)({ ...request(), source: 'proxy', proxy })
    expect(drafts[0]).toMatchObject({
      source: 'proxy',
      createdByStaffId: 7,
      guestCount: 3,
      contact: { familyName: '山田', phone: '+819012345678' },
    })
    expect(drafts[0]?.holdExpiresAt.toISOString()).toBe(
      new Date('2026-11-01T12:30:00+09:00').toISOString(),
    )
  })

  it('refuses more guests than the room holds', async () => {
    const { deps } = holdDeps()
    await expect(
      makeCreateHold(deps)({ ...request(), source: 'proxy', proxy: { ...proxy, guestCount: 5 } }),
    ).rejects.toMatchObject({ code: 'invalid_guest_count' })
  })

  it('needs the staff member and customer for a proxy hold, and only then', async () => {
    const { deps } = holdDeps()
    await expect(makeCreateHold(deps)({ ...request(), source: 'proxy' })).rejects.toThrow()
    await expect(makeCreateHold(deps)({ ...request(), proxy })).rejects.toThrow()
  })
})
