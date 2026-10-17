import type { CouponVersionDraft } from '@jancube/domain'
import { describe, expect, it } from 'vitest'
import type { NotifyRequest } from '../notifications/notify'
import type {
  CampaignRow,
  CouponAdminRepository,
  CouponCampaignRepository,
  CouponDetail,
  GrantableVersion,
  MemberAdminRepository,
  SegmentQuery,
} from '../ports/admin-masters'
import type { StaffActor } from './admin-actor'
import { makeGrantCouponToMember, makeRunCampaign, resolveSegment } from './coupon-grants'
import { COUPON_PRESETS, makeCreateCoupon, makePublishCouponVersion } from './coupons'

const owner: StaffActor = {
  staffId: 1,
  access: { staffId: 1, grants: [{ role: 'owner', storeId: null }] },
}
const NOW = new Date('2026-10-12T03:00:00Z')

const draft = (over: Partial<CouponVersionDraft> = {}): CouponVersionDraft => ({
  discountType: 'percent',
  discountValue: 50,
  maximumDiscount: null,
  minimumSpend: 0,
  maxUses: 3,
  validFrom: new Date('2026-10-01T00:00:00Z'),
  validTo: new Date('2027-10-01T00:00:00Z'),
  weekdayMask: 127,
  startMinute: null,
  endMinute: null,
  grantTrigger: 'registration',
  stackable: false,
  conditionsNote: null,
  storeIds: [],
  roomTypeIds: [],
  ...over,
})

function world() {
  const coupons: CouponDetail[] = []
  const grants = new Map<
    string,
    { id: number; memberId: number; expiresAt: Date; maxUses: number }
  >()
  const audits: { action: string; after?: unknown }[] = []
  const notifications: NotifyRequest[] = []
  const campaigns: CampaignRow[] = []
  const version: GrantableVersion = {
    couponId: 5,
    couponVersionId: 50,
    code: 'THANKS',
    name: '口コミ御礼 1,000円OFF',
    versionNo: 1,
    maxUses: 1,
    validFrom: new Date('2026-10-01T00:00:00Z'),
    validTo: new Date('2026-12-31T15:00:00Z'),
    grantTrigger: 'manual',
    discountType: 'amount',
    discountValue: 1000,
  }
  const couponRepo: CouponAdminRepository = {
    list: async () => [],
    find: async (id) => coupons.find((c) => c.id === id) ?? null,
    codeTaken: async (code) => coupons.some((c) => c.code === code),
    create: async (c, v) => {
      const id = coupons.length + 1
      coupons.push({
        id,
        code: c.code,
        name: c.name,
        campaignTag: c.campaignTag,
        status: c.status,
        versions: [{ ...v, id: id * 10, versionNo: 1, publishedAt: NOW }],
      })
      return { couponId: id, versionId: id * 10 }
    },
    addVersion: async (id, v) => {
      const coupon = coupons.find((c) => c.id === id)
      if (!coupon) throw new Error('missing')
      const versionNo = coupon.versions.length + 1
      ;(coupon.versions as unknown[]).unshift({
        ...v,
        id: 100 + versionNo,
        versionNo,
        publishedAt: NOW,
      })
      return { versionId: 100 + versionNo, versionNo }
    },
    update: async () => {},
    setStatus: async () => {},
    grantables: async () => [version],
    grant: async (g) => {
      const existing = grants.get(g.issuanceKey)
      if (existing) return { grantId: existing.id, created: false }
      const id = grants.size + 1
      grants.set(g.issuanceKey, {
        id,
        memberId: g.memberId,
        expiresAt: g.expiresAt,
        maxUses: g.maxUses,
      })
      return { grantId: id, created: true }
    },
  }
  const segmentMembers = [3, 4, 8]
  let failAfter: number | null = null
  const campaignRepo: CouponCampaignRepository = {
    countSegment: async () => ({ total: segmentMembers.length, line: 1, email: 1, none: 1 }),
    segmentMemberIds: async (_q: SegmentQuery, afterId, limit) =>
      segmentMembers.filter((id) => id > afterId).slice(0, limit),
    findCampaign: async (key) => campaigns.find((c) => c.campaignKey === key) ?? null,
    createCampaign: async (c) => {
      const id = campaigns.length + 1
      campaigns.push({
        ...c,
        id,
        couponName: version.name,
        grantedCount: 0,
        status: 'draft',
        issuedByName: 'owner',
        startedAt: null,
        finishedAt: null,
        createdAt: NOW,
      })
      return id
    },
    updateCampaign: async (id, values) => {
      const c = campaigns.find((x) => x.id === id)
      if (c) Object.assign(c, values, { grantedCount: grants.size })
    },
    listCampaigns: async () => campaigns,
  }
  const members: Pick<MemberAdminRepository, 'findByCode' | 'hasBookingAt'> = {
    findByCode: async (code) =>
      code === 'JC-U-000007'
        ? {
            id: 7,
            memberCode: code,
            familyName: '山田',
            givenName: '太郎',
            phone: null,
            email: 'a@example.com',
            lineLinked: false,
            useCount: 0,
            lastUseDate: null,
            status: 'active',
            registeredAt: NOW,
            registrationSource: null,
            lineLinkedAt: null,
            lineFriendStatus: null,
            withdrawnAt: null,
          }
        : null,
    hasBookingAt: async () => true,
  }
  const deps = {
    coupons: couponRepo,
    campaigns: campaignRepo,
    members: members as MemberAdminRepository,
    notify: async (r: NotifyRequest) => {
      if (failAfter !== null && notifications.length >= failAfter) throw new Error('db down')
      notifications.push(r)
      return { status: 'queued' as const, channel: 'email' as const }
    },
    audit: { record: async (e: (typeof audits)[number]) => void audits.push(e) },
    clock: { now: () => NOW },
  }
  return {
    deps,
    coupons,
    grants,
    audits,
    notifications,
    campaigns,
    failAfter: (n: number | null) => {
      failAfter = n
    },
  }
}

describe('coupon master (A-14)', () => {
  it('creates a coupon with its first version and rejects duplicate codes', async () => {
    const { deps, coupons, audits } = world()
    const create = makeCreateCoupon(deps)
    const id = await create(owner, {
      code: ' first3half ',
      name: '初回3回半額',
      activate: true,
      version: draft(),
    })
    expect(coupons[0]).toMatchObject({ id, code: 'FIRST3HALF', status: 'active' })
    expect(audits[0]?.action).toBe('coupon.create')
    await expect(
      create(owner, { code: 'FIRST3HALF', name: 'x', activate: false, version: draft() }),
    ).rejects.toMatchObject({ code: 'coupon_code_taken' })
  })

  it('validates conditions before saving', async () => {
    const { deps } = world()
    await expect(
      makeCreateCoupon(deps)(owner, {
        code: 'BAD1',
        name: 'x',
        activate: false,
        version: draft({ discountValue: 120 }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_coupon' })
    await expect(
      makeCreateCoupon(deps)(owner, {
        code: 'BAD2',
        name: 'x',
        activate: false,
        version: draft({ startMinute: 600, endMinute: null }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_coupon' })
  })

  it('publishes edits as a new version and keeps the old one', async () => {
    const { deps, coupons } = world()
    const id = await makeCreateCoupon(deps)(owner, {
      code: 'C01',
      name: 'x',
      activate: true,
      version: draft(),
    })
    const result = await makePublishCouponVersion(deps)(owner, id, draft({ discountValue: 30 }))
    expect(result.versionNo).toBe(2)
    expect(coupons[0]?.versions.map((v) => v.discountValue)).toEqual([30, 50])
  })

  it('offers the F-CPN-02 preset (registration, 50%, 3 uses)', () => {
    expect(COUPON_PRESETS.find((p) => p.key === 'first3half')).toMatchObject({
      grantTrigger: 'registration',
      discountType: 'percent',
      discountValue: 50,
      maxUses: 3,
    })
  })
})

describe('individual coupon grant (A-13)', () => {
  it('grants once per request key, caps expiry at the coupon end and notifies', async () => {
    const { deps, grants, notifications, audits } = world()
    const grant = makeGrantCouponToMember(deps)
    const input = {
      memberCode: 'JC-U-000007',
      couponVersionId: 50,
      expiresOn: '2027-03-31',
      internalNote: '口コミ御礼',
      notify: true,
      requestKey: 'req-12345678',
    }
    const first = await grant(owner, input)
    const second = await grant(owner, input)
    expect(first.created).toBe(true)
    expect(second).toMatchObject({ grantId: first.grantId, created: false })
    expect(grants.size).toBe(1)
    expect([...grants.values()][0]?.expiresAt.toISOString()).toBe('2026-12-31T15:00:00.000Z')
    expect(notifications[0]).toMatchObject({
      event: 'coupon_granted',
      memberId: 7,
      values: { couponName: '口コミ御礼 1,000円OFF', couponExpiresAt: '2026年12月31日' },
      deduplicationKey: `coupon_granted:${first.grantId}`,
    })
    expect(audits.filter((a) => a.action === 'coupon.grant')).toHaveLength(1)
  })

  it('needs members.manage', async () => {
    const { deps } = world()
    const staff: StaffActor = {
      staffId: 2,
      access: { staffId: 2, grants: [{ role: 'cleaning', storeId: 1 }] },
    }
    await expect(
      makeGrantCouponToMember(deps)(staff, {
        memberCode: 'JC-U-000007',
        couponVersionId: 50,
        notify: false,
        requestKey: 'req-12345678',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('segment issuance (A-15)', () => {
  const input = {
    campaignKey: 'camp-12345678',
    name: '秋の一斉配布',
    couponVersionId: 50,
    segment: { code: 'all_active' } as const,
    notify: true,
  }

  it('grants to every member of the segment and does not run a completed campaign twice', async () => {
    const { deps, grants, campaigns, notifications } = world()
    const run = makeRunCampaign(deps)
    const result = await run(owner, input)
    expect(result).toMatchObject({ granted: 3, notified: 3, alreadyRan: false })
    expect(campaigns[0]).toMatchObject({ status: 'completed', targetCount: 3 })
    const again = await run(owner, input)
    expect(again.alreadyRan).toBe(true)
    expect(grants.size).toBe(3)
    expect(notifications).toHaveLength(3)
  })

  it('marks a failed run and resumes it without duplicate grants', async () => {
    const w = world()
    const run = makeRunCampaign(w.deps)
    w.failAfter(1)
    await expect(run(owner, input)).rejects.toThrow('db down')
    expect(w.campaigns[0]?.status).toBe('failed')
    w.failAfter(null)
    const resumed = await run(owner, input)
    expect(resumed.granted).toBe(1)
    expect(w.grants.size).toBe(3)
    expect(w.campaigns).toHaveLength(1)
    expect(w.campaigns[0]?.status).toBe('completed')
  })

  it('resolves segments against a fixed base time', () => {
    expect(resolveSegment({ code: 'no_use_days', days: 90 }, NOW)).toEqual({
      kind: 'no_use_since',
      since: new Date('2026-07-14T03:00:00Z'),
    })
    expect(
      resolveSegment({ code: 'registered_between', from: '2026-10-01', to: '2026-10-31' }, NOW),
    ).toEqual({
      kind: 'registered_between',
      from: new Date('2026-09-30T15:00:00Z'),
      to: new Date('2026-10-31T15:00:00Z'),
    })
    expect(() => resolveSegment({ code: 'no_use_days', days: 0 }, NOW)).toThrow()
  })
})
