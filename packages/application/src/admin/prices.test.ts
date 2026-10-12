import type { PriceVersionDraft } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import type {
  CouponAdminRepository,
  PriceAdminRepository,
  PriceRoomOption,
  PriceVersionView,
} from '../ports/admin-masters'
import type { StaffActor } from './admin-actor'
import {
  makeAssignPriceVersion,
  makeCreatePriceProfile,
  makePublishPriceVersion,
  makeSimulatePrice,
} from './prices'

const owner: StaffActor = {
  staffId: 1,
  access: { staffId: 1, grants: [{ role: 'owner', storeId: null }] },
}
const NOW = new Date('2026-10-12T03:00:00Z')

const draft = (over: Partial<PriceVersionDraft> = {}): PriceVersionDraft => ({
  hourlyRate: 1500,
  minimumMinutes: 60,
  taxRatePercent: 10,
  validFrom: new Date('2026-11-01T00:00:00Z'),
  packages: [{ minutes: 240, price: 5800 }],
  timeRules: [],
  ...over,
})

function world() {
  const versions: (PriceVersionView & { profileName: string })[] = []
  const assignCalls: { roomIds: readonly number[]; versionId: number; validFrom: Date }[] = []
  const room: PriceRoomOption = {
    id: 9,
    storeId: 1,
    storeCode: 'JC001',
    code: 'Room6',
    name: 'Room6',
    roomTypeId: 2,
    roomTypeName: '4麻',
    timezone: 'Asia/Tokyo',
  }
  const audits: { action: string }[] = []
  const prices: PriceAdminRepository = {
    listProfiles: async () => [],
    findProfile: async (id) =>
      id === 1 ? { id: 1, code: 'STD', name: '標準', isActive: true, versions } : null,
    findVersion: async (id) => versions.find((v) => v.id === id) ?? null,
    codeTaken: async (code) => code === 'STD',
    createProfile: async () => 1,
    updateProfile: async () => {},
    publishVersion: async (profileId, d) => {
      const versionNo = versions.length + 1
      versions.unshift({
        ...d,
        id: 100 + versionNo,
        profileId,
        profileName: '標準',
        versionNo,
        status: 'published',
        validTo: null,
        publishedAt: NOW,
      })
      return { versionId: 100 + versionNo, versionNo }
    },
    assignments: async () => [],
    roomsOnProfile: async () => [9, 10],
    assign: async (input) => {
      assignCalls.push(input)
      return { ended: input.roomIds.length, removed: 0, created: input.roomIds.length }
    },
    rooms: async () => [room],
    room: async (id) => (id === 9 ? room : null),
  }
  const deps = {
    prices,
    pricing: {
      forRoom: async () => ({
        priceVersionId: versions[0]?.id ?? 0,
        minimumMinutes: 60,
        taxRatePercent: 10,
        profile: {
          hourlyRate: 1500,
          packages: [],
          combinationRule: 'cheapest-combination' as const,
        },
      }),
    },
    coupons: {
      find: async () => ({
        id: 3,
        code: 'HALF',
        name: '半額',
        campaignTag: null,
        status: 'active' as const,
        versions: [
          {
            id: 30,
            versionNo: 1,
            publishedAt: NOW,
            discountType: 'percent' as const,
            discountValue: 50,
            maximumDiscount: null,
            minimumSpend: 0,
            maxUses: 3,
            validFrom: new Date('2026-01-01T00:00:00Z'),
            validTo: new Date('2027-01-01T00:00:00Z'),
            weekdayMask: 127,
            startMinute: null,
            endMinute: null,
            grantTrigger: 'registration' as const,
            stackable: false,
            conditionsNote: null,
            storeIds: [],
            roomTypeIds: [],
          },
        ],
      }),
    } as unknown as CouponAdminRepository,
    audit: { record: async (e: { action: string }) => void audits.push(e) },
    clock: { now: () => NOW },
    combinationRule: 'cheapest-combination' as const,
  }
  return { deps, versions, assignCalls, audits }
}

describe('price profiles (A-16)', () => {
  it('creates a profile with version 1 effective now when the date is in the past', async () => {
    const { deps, versions } = world()
    await makeCreatePriceProfile(deps)(owner, {
      code: 'new',
      name: '新料金',
      version: draft({ validFrom: new Date('2026-01-01T00:00:00Z') }),
    })
    expect(versions[0]?.validFrom).toEqual(NOW)
    await expect(
      makeCreatePriceProfile(deps)(owner, { code: 'std', name: 'x', version: draft() }),
    ).rejects.toMatchObject({ code: 'price_code_taken' })
  })

  it('publishes a new version and moves the rooms on the profile at its start', async () => {
    const { deps, assignCalls, audits } = world()
    const result = await makePublishPriceVersion(deps)(owner, 1, {
      version: draft({ hourlyRate: 1600 }),
      moveRooms: true,
    })
    expect(result).toMatchObject({ versionNo: 1, movedRooms: 2 })
    expect(assignCalls[0]).toEqual({
      roomIds: [9, 10],
      versionId: result.versionId,
      validFrom: new Date('2026-11-01T00:00:00Z'),
    })
    expect(audits.map((a) => a.action)).toEqual(['price.version_publish'])
  })

  it('rejects invalid versions (30-minute units)', async () => {
    const { deps } = world()
    await expect(
      makePublishPriceVersion(deps)(owner, 1, {
        version: draft({ packages: [{ minutes: 45, price: 100 }] }),
        moveRooms: false,
      }),
    ).rejects.toMatchObject({ code: 'invalid_price' })
  })

  it('assigns only published versions to existing rooms', async () => {
    const { deps } = world()
    await expect(
      makeAssignPriceVersion(deps)(owner, { versionId: 999, roomIds: [9], validFrom: NOW }),
    ).rejects.toMatchObject({ code: 'price_version_not_found' })
  })
})

describe('price simulation (A-17)', () => {
  it('quotes a version with packages and the included tax', async () => {
    const { deps } = world()
    await makePublishPriceVersion(deps)(owner, 1, { version: draft(), moveRooms: false })
    const result = await makeSimulatePrice(deps)(owner, {
      mode: 'version',
      versionId: 101,
      minutes: 270,
    })
    // 4h package (5,800) + 30 min (750)
    expect(result.quote.price).toBe(6550)
    expect(result.total).toBe(6550)
    expect(result.tax).toBe(595)
    expect(result.belowMinimum).toBe(false)
  })

  it('quotes a room at a time and applies a coupon', async () => {
    const { deps } = world()
    await makePublishPriceVersion(deps)(owner, 1, { version: draft(), moveRooms: false })
    const result = await makeSimulatePrice(deps)(owner, {
      mode: 'room',
      roomId: 9,
      date: '2026-11-08',
      startMinute: 780,
      endMinute: 960,
      couponId: 3,
    })
    expect(result.quote.price).toBe(4500)
    expect(result.coupon?.evaluation).toEqual({ ok: true, discount: 2250 })
    expect(result.total).toBe(2250)
  })
})
