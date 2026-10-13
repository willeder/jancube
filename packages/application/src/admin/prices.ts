import {
  assertCan,
  assertPriceVersionDraft,
  type CombinationRule,
  type CouponEvaluation,
  calculatePrice,
  DomainError,
  evaluateCoupon,
  includedTax,
  type LocalDate,
  localToUtc,
  type PriceVersionDraft,
  visibleStoreIds,
  weekdayOf,
} from '@jancube/domain'
import type {
  CouponAdminRepository,
  PriceAdminRepository,
  PriceVersionView,
} from '../ports/admin-masters'
import type { Clock } from '../ports/clock'
import type { PricingRepository } from '../ports/inventory-repository'
import type { AuditLog } from '../ports/ops'
import { auditActor, requireText, type StaffActor } from './admin-actor'

export interface PriceAdminDeps {
  readonly prices: PriceAdminRepository
  readonly pricing: PricingRepository
  readonly coupons: CouponAdminRepository
  readonly audit: AuditLog
  readonly clock: Clock
  /** Same rule the booking flow uses (tracker #6). */
  readonly combinationRule: CombinationRule
}

const versionSummary = (d: PriceVersionDraft) => ({
  hourlyRate: d.hourlyRate,
  minimumMinutes: d.minimumMinutes,
  taxRatePercent: d.taxRatePercent,
  validFrom: d.validFrom.toISOString(),
  packages: d.packages,
  timeRules: d.timeRules,
})

function assertProfileCode(code: string): string {
  const normalized = code.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{2,32}$/.test(normalized)) {
    throw new DomainError('invalid_price_code', 'use 2-32 letters, digits, - or _')
  }
  return normalized
}

/** A version published "from today" takes effect now rather than in the past. */
const effectiveFrom = (validFrom: Date, now: Date) => (validFrom < now ? now : validFrom)

/** A-16 料金プロファイル一覧. */
export function makeListPriceProfiles(deps: PriceAdminDeps) {
  return async function listPriceProfiles(actor: StaffActor) {
    assertCan(actor.access, 'prices.manage')
    return deps.prices.listProfiles(deps.clock.now())
  }
}

export function makeGetPriceProfile(deps: PriceAdminDeps) {
  return async function getPriceProfile(actor: StaffActor, profileId: number) {
    assertCan(actor.access, 'prices.manage')
    const profile = await deps.prices.findProfile(profileId)
    if (!profile) throw new DomainError('price_profile_not_found', 'price profile not found')
    const stores = visibleStoreIds(actor.access, 'prices.manage')
    const [assignments, rooms] = await Promise.all([
      deps.prices.assignments({ at: deps.clock.now(), profileId, storeIds: stores }),
      deps.prices.rooms(stores),
    ])
    return { profile, assignments, rooms }
  }
}

/** A-16 パターン作成: the profile and its first published version. */
export function makeCreatePriceProfile(deps: PriceAdminDeps) {
  return async function createPriceProfile(
    actor: StaffActor,
    input: { code: string; name: string; version: PriceVersionDraft },
  ): Promise<number> {
    assertCan(actor.access, 'prices.manage')
    const code = assertProfileCode(input.code)
    const name = requireText(input.name, 'name_required', 200)
    assertPriceVersionDraft(input.version)
    if (await deps.prices.codeTaken(code)) {
      throw new DomainError('price_code_taken', 'this code is already used')
    }
    const now = deps.clock.now()
    const profileId = await deps.prices.createProfile({ code, name })
    const draft = { ...input.version, validFrom: effectiveFrom(input.version.validFrom, now) }
    const { versionId } = await deps.prices.publishVersion(profileId, draft, actor.staffId, now)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'price.profile_create',
      targetType: 'price_profile',
      targetId: profileId,
      targetCode: code,
      after: { name, versionId, version: versionSummary(draft) },
    })
    return profileId
  }
}

export function makeUpdatePriceProfile(deps: PriceAdminDeps) {
  return async function updatePriceProfile(
    actor: StaffActor,
    profileId: number,
    input: { name: string; isActive: boolean },
  ): Promise<void> {
    assertCan(actor.access, 'prices.manage')
    const profile = await deps.prices.findProfile(profileId)
    if (!profile) throw new DomainError('price_profile_not_found', 'price profile not found')
    const name = requireText(input.name, 'name_required', 200)
    await deps.prices.updateProfile(profileId, { name, isActive: input.isActive })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'price.profile_update',
      targetType: 'price_profile',
      targetId: profileId,
      targetCode: profile.code,
      before: { name: profile.name, isActive: profile.isActive },
      after: { name, isActive: input.isActive },
    })
  }
}

/**
 * A-16 新しい版を公開. Published versions are never edited (bookings keep the version they were
 * priced with). With `moveRooms`, rooms using this profile switch to the new version at its
 * valid-from time.
 */
export function makePublishPriceVersion(deps: PriceAdminDeps) {
  return async function publishPriceVersion(
    actor: StaffActor,
    profileId: number,
    input: { version: PriceVersionDraft; moveRooms: boolean },
  ) {
    assertCan(actor.access, 'prices.manage')
    const profile = await deps.prices.findProfile(profileId)
    if (!profile) throw new DomainError('price_profile_not_found', 'price profile not found')
    assertPriceVersionDraft(input.version)
    const now = deps.clock.now()
    const draft = { ...input.version, validFrom: effectiveFrom(input.version.validFrom, now) }
    const roomIds = input.moveRooms
      ? await deps.prices.roomsOnProfile(profileId, draft.validFrom)
      : []
    const published = await deps.prices.publishVersion(profileId, draft, actor.staffId, now)
    const moved =
      roomIds.length > 0
        ? await deps.prices.assign({
            roomIds,
            versionId: published.versionId,
            validFrom: draft.validFrom,
          })
        : null
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'price.version_publish',
      targetType: 'price_profile',
      targetId: profileId,
      targetCode: profile.code,
      after: { ...published, version: versionSummary(draft), movedRoomIds: roomIds },
    })
    return { ...published, movedRooms: moved?.created ?? 0 }
  }
}

/** A-16 割当先: rooms use a published version from `validFrom` (room-level, tracker #34). */
export function makeAssignPriceVersion(deps: PriceAdminDeps) {
  return async function assignPriceVersion(
    actor: StaffActor,
    input: { versionId: number; roomIds: readonly number[]; validFrom: Date },
  ) {
    assertCan(actor.access, 'prices.manage')
    const version = await deps.prices.findVersion(input.versionId)
    if (version?.status !== 'published') {
      throw new DomainError('price_version_not_found', 'published version not found')
    }
    const roomIds = [...new Set(input.roomIds)]
    if (roomIds.length === 0) throw new DomainError('rooms_required', 'choose at least one room')
    for (const roomId of roomIds) {
      const room = await deps.prices.room(roomId)
      if (!room) throw new DomainError('room_not_found', 'room not found')
      assertCan(actor.access, 'prices.manage', room.storeId)
    }
    if (Number.isNaN(input.validFrom.getTime())) {
      throw new DomainError('invalid_price', 'valid-from date is required')
    }
    const now = deps.clock.now()
    const validFrom = effectiveFrom(input.validFrom, now)
    const before = (await deps.prices.assignments({ at: now })).filter((a) =>
      roomIds.includes(a.roomId),
    )
    const result = await deps.prices.assign({ roomIds, versionId: version.id, validFrom })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'price.assign',
      targetType: 'price_version',
      targetId: version.id,
      before: before.map((a) => ({
        roomId: a.roomId,
        versionId: a.versionId,
        validFrom: a.validFrom.toISOString(),
        validTo: a.validTo?.toISOString() ?? null,
      })),
      after: { roomIds, versionId: version.id, validFrom: validFrom.toISOString(), ...result },
    })
    return result
  }
}

/** A-17 choices: rooms, latest version of each profile, and active coupons. */
export function makeListSimulationOptions(deps: PriceAdminDeps) {
  return async function listSimulationOptions(actor: StaffActor) {
    assertCan(actor.access, 'prices.manage')
    const [rooms, profiles, coupons] = await Promise.all([
      deps.prices.rooms(visibleStoreIds(actor.access, 'prices.manage')),
      deps.prices.listProfiles(deps.clock.now()),
      deps.coupons.list(),
    ])
    return {
      rooms,
      versions: profiles.flatMap((p) =>
        p.latest ? [{ id: p.latest.id, label: `${p.name} 第${p.latest.versionNo}版` }] : [],
      ),
      coupons: coupons
        .filter((c) => c.status === 'active')
        .map((c) => ({ id: c.id, name: c.name })),
    }
  }
}

export type SimulationInput =
  | {
      readonly mode: 'room'
      readonly roomId: number
      readonly date: LocalDate
      readonly startMinute: number
      readonly endMinute: number
      readonly couponId?: number | null
    }
  | { readonly mode: 'version'; readonly versionId: number; readonly minutes: number }

/**
 * A-17 料金シミュレーション: the price the booking flow would quote, with its breakdown. Time rules
 * (price_time_rules) are listed for reference only; the pricing calculation does not apply them yet.
 */
export function makeSimulatePrice(deps: PriceAdminDeps) {
  return async function simulatePrice(actor: StaffActor, input: SimulationInput) {
    assertCan(actor.access, 'prices.manage')
    let version: PriceVersionView & { profileName: string }
    let minutes: number
    let room: Awaited<ReturnType<PriceAdminRepository['room']>> = null
    let start: Date | null = null
    if (input.mode === 'room') {
      room = await deps.prices.room(input.roomId)
      if (!room) throw new DomainError('room_not_found', 'room not found')
      assertCan(actor.access, 'prices.manage', room.storeId)
      minutes = input.endMinute - input.startMinute
      start = localToUtc(input.date, input.startMinute, room.timezone)
      const priced = await deps.pricing.forRoom(room.id, start)
      if (!priced) throw new DomainError('price_not_set', 'no price assigned to this room')
      const found = await deps.prices.findVersion(priced.priceVersionId)
      if (!found) throw new DomainError('price_not_set', 'price version not found')
      version = found
    } else {
      const found = await deps.prices.findVersion(input.versionId)
      if (!found) throw new DomainError('price_version_not_found', 'price version not found')
      version = found
      minutes = input.minutes
    }
    const quote = calculatePrice(minutes, {
      hourlyRate: version.hourlyRate,
      packages: version.packages,
      combinationRule: deps.combinationRule,
    })

    let coupon: { name: string; evaluation: CouponEvaluation } | null = null
    if (input.mode === 'room' && input.couponId && room && start) {
      const detail = await deps.coupons.find(input.couponId)
      const terms = detail?.versions[0]
      if (!detail || !terms) throw new DomainError('coupon_not_found', 'coupon not found')
      coupon = {
        name: detail.name,
        evaluation: evaluateCoupon(terms, {
          at: deps.clock.now(),
          storeId: room.storeId,
          roomTypeId: room.roomTypeId,
          startWeekday: weekdayOf(input.date),
          startMinute: input.startMinute,
          subtotal: quote.price,
        }),
      }
    }
    const discount = coupon?.evaluation.ok ? coupon.evaluation.discount : 0
    const total = quote.price - discount
    return {
      room,
      version,
      minutes,
      belowMinimum: minutes < version.minimumMinutes,
      quote,
      coupon,
      total,
      tax: includedTax(total, version.taxRatePercent),
    }
  }
}
