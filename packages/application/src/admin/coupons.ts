import {
  assertCan,
  assertCouponVersionDraft,
  type CouponGrantTrigger,
  type CouponVersionDraft,
  can,
  DomainError,
  normalizeCouponCode,
  visibleStoreIds,
} from '@jancube/domain'
import type { CouponAdminRepository, CouponVersionView } from '../ports/admin-masters'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import { auditActor, optionalText, requireText, type StaffActor } from './admin-actor'

export interface CouponAdminDeps {
  readonly coupons: CouponAdminRepository
  readonly audit: AuditLog
  readonly clock: Clock
}

export const GRANT_TRIGGER_LABELS: Readonly<Record<CouponGrantTrigger, string>> = {
  registration: '会員登録時',
  line_friend: 'LINE友だち追加',
  first_use: '初回利用後',
  manual: '手動配布・コード入力',
  bulk: '一斉発行(A-15)',
}

/**
 * Starting points for the A-14 form. Values the client has not fixed yet are marked in the note
 * and can be changed before saving.
 */
export interface CouponPreset {
  readonly key: string
  readonly label: string
  readonly code: string
  readonly name: string
  readonly discountType: 'amount' | 'percent'
  readonly discountValue: number
  readonly maximumDiscount: number | null
  readonly maxUses: number
  readonly grantTrigger: CouponGrantTrigger
  /** Validity length from today. */
  readonly validDays: number
  readonly conditionsNote: string
  readonly campaignTag: string | null
  readonly description: string
}

export const COUPON_PRESETS: readonly CouponPreset[] = [
  {
    key: 'first3half',
    label: 'F-CPN-02 初回3回半額',
    code: 'FIRST3HALF',
    name: '初回3回 半額クーポン',
    discountType: 'percent',
    discountValue: 50,
    maximumDiscount: null,
    maxUses: 3,
    grantTrigger: 'registration',
    validDays: 365,
    conditionsNote: '会員登録から3回のご利用まで料金が半額 / 併用不可',
    campaignTag: 'first3half',
    description:
      '会員登録時に自動付与（3回分）。付与後の有効期限はクーポンの利用終了日までです（登録日起算の期限は未対応・要確認）。',
  },
  {
    key: 'opening',
    label: 'F-CPN-04 オープニングキャンペーン',
    code: 'OPENING',
    name: 'オープニングキャンペーン',
    discountType: 'percent',
    discountValue: 30,
    maximumDiscount: null,
    maxUses: 1,
    grantTrigger: 'registration',
    validDays: 30,
    conditionsNote: 'オープニング期間中のご利用に限り割引 / 併用不可',
    campaignTag: 'opening',
    description:
      '期間限定割引をクーポンとして実装（課題#7 未確定）。新規登録者へ自動付与し、既存会員には A-15 一斉発行で配布します。割引率・期間・対象店舗は仮の値です。',
  },
]

function assertTargetStores(actor: StaffActor, draft: CouponVersionDraft) {
  const visible = visibleStoreIds(actor.access, 'coupons.manage')
  if (visible === null) return
  // Store-scoped staff may only create coupons limited to their own stores.
  if (draft.storeIds.length === 0 || draft.storeIds.some((s) => !visible.includes(s))) {
    throw new DomainError('forbidden', 'coupon targets stores outside the staff scope')
  }
}

const versionSummary = (v: CouponVersionView | CouponVersionDraft | null | undefined) =>
  v && {
    discountType: v.discountType,
    discountValue: v.discountValue,
    maximumDiscount: v.maximumDiscount,
    minimumSpend: v.minimumSpend,
    maxUses: v.maxUses,
    validFrom: v.validFrom.toISOString(),
    validTo: v.validTo.toISOString(),
    weekdayMask: v.weekdayMask,
    startMinute: v.startMinute,
    endMinute: v.endMinute,
    grantTrigger: v.grantTrigger,
    stackable: v.stackable,
    storeIds: v.storeIds,
    roomTypeIds: v.roomTypeIds,
  }

/** A-14 クーポン一覧. */
export function makeListCoupons(deps: CouponAdminDeps) {
  return async function listCoupons(actor: StaffActor) {
    assertCan(actor.access, 'coupons.manage')
    return deps.coupons.list()
  }
}

export function makeGetCoupon(deps: CouponAdminDeps) {
  return async function getCoupon(actor: StaffActor, couponId: number) {
    assertCan(actor.access, 'coupons.manage')
    const coupon = await deps.coupons.find(couponId)
    if (!coupon) throw new DomainError('coupon_not_found', 'coupon not found')
    return coupon
  }
}

/** A-14 作成: the coupon and its first version. */
export function makeCreateCoupon(deps: CouponAdminDeps) {
  return async function createCoupon(
    actor: StaffActor,
    input: {
      code: string
      name: string
      campaignTag?: string | null
      activate: boolean
      version: CouponVersionDraft
    },
  ): Promise<number> {
    assertCan(actor.access, 'coupons.manage')
    const code = normalizeCouponCode(input.code)
    const name = requireText(input.name, 'name_required', 200)
    const campaignTag = optionalText(input.campaignTag, 100)
    assertCouponVersionDraft(input.version)
    assertTargetStores(actor, input.version)
    if (await deps.coupons.codeTaken(code)) {
      throw new DomainError('coupon_code_taken', 'this code is already used')
    }
    const status = input.activate ? 'active' : 'draft'
    const { couponId, versionId } = await deps.coupons.create(
      { code, name, campaignTag, status, createdBy: actor.staffId },
      input.version,
    )
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'coupon.create',
      targetType: 'coupon',
      targetId: couponId,
      targetCode: code,
      after: { name, campaignTag, status, versionId, version: versionSummary(input.version) },
    })
    return couponId
  }
}

/** A-14 編集: conditions are published as a new version; grants keep the version they got. */
export function makePublishCouponVersion(deps: CouponAdminDeps) {
  return async function publishCouponVersion(
    actor: StaffActor,
    couponId: number,
    draft: CouponVersionDraft,
  ) {
    assertCan(actor.access, 'coupons.manage')
    const coupon = await deps.coupons.find(couponId)
    if (!coupon) throw new DomainError('coupon_not_found', 'coupon not found')
    assertCouponVersionDraft(draft)
    assertTargetStores(actor, draft)
    const result = await deps.coupons.addVersion(couponId, draft, actor.staffId)
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'coupon.version_publish',
      targetType: 'coupon',
      targetId: couponId,
      targetCode: coupon.code,
      before: versionSummary(coupon.versions[0]) ?? null,
      after: { versionNo: result.versionNo, ...versionSummary(draft) },
    })
    return result
  }
}

/** A-14: name and campaign tag (shown to customers immediately, not versioned). */
export function makeUpdateCoupon(deps: CouponAdminDeps) {
  return async function updateCoupon(
    actor: StaffActor,
    couponId: number,
    input: { name: string; campaignTag?: string | null },
  ): Promise<void> {
    assertCan(actor.access, 'coupons.manage')
    const coupon = await deps.coupons.find(couponId)
    if (!coupon) throw new DomainError('coupon_not_found', 'coupon not found')
    const name = requireText(input.name, 'name_required', 200)
    const campaignTag = optionalText(input.campaignTag, 100)
    await deps.coupons.update(couponId, { name, campaignTag })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'coupon.update',
      targetType: 'coupon',
      targetId: couponId,
      targetCode: coupon.code,
      before: { name: coupon.name, campaignTag: coupon.campaignTag },
      after: { name, campaignTag },
    })
  }
}

/** A-14 有効化 / 停止. Disabled coupons cannot be used or granted; existing grants stay recorded. */
export function makeSetCouponStatus(deps: CouponAdminDeps) {
  return async function setCouponStatus(
    actor: StaffActor,
    couponId: number,
    status: 'active' | 'disabled',
  ): Promise<void> {
    assertCan(actor.access, 'coupons.manage')
    if (status !== 'active' && status !== 'disabled') {
      throw new DomainError('invalid_coupon', 'unknown status')
    }
    const coupon = await deps.coupons.find(couponId)
    if (!coupon) throw new DomainError('coupon_not_found', 'coupon not found')
    if (coupon.status === status) return
    await deps.coupons.setStatus(couponId, status)
    await deps.audit.record({
      actor: auditActor(actor),
      action: status === 'active' ? 'coupon.activate' : 'coupon.disable',
      targetType: 'coupon',
      targetId: couponId,
      targetCode: coupon.code,
      before: { status: coupon.status },
      after: { status },
    })
  }
}

/** Coupons that can be granted now (A-13 / A-15 pickers). */
export function makeListGrantableCoupons(deps: CouponAdminDeps) {
  return async function listGrantableCoupons(actor: StaffActor) {
    if (!can(actor.access, 'members.manage') && !can(actor.access, 'coupons.manage')) {
      throw new DomainError('forbidden', 'members.manage or coupons.manage required')
    }
    return deps.coupons.grantables(deps.clock.now())
  }
}
