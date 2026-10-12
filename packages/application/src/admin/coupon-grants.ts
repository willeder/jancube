import { assertCan, DomainError, type LocalDate } from '@jancube/domain'
import type { NotifyRequest, NotifyResult } from '../notifications/notify'
import type {
  CampaignRow,
  CouponAdminRepository,
  CouponCampaignRepository,
  GrantableVersion,
  MemberAdminRepository,
  SegmentCount,
  SegmentQuery,
} from '../ports/admin-masters'
import type { Clock } from '../ports/clock'
import type { AuditLog } from '../ports/ops'
import {
  assertRequestKey,
  auditActor,
  endOfLocalDate,
  formatExpiryDate,
  optionalText,
  requireText,
  type StaffActor,
  startOfLocalDate,
} from './admin-actor'
import { loadVisibleMember } from './members'

export interface CouponGrantDeps {
  readonly members: MemberAdminRepository
  readonly coupons: CouponAdminRepository
  readonly campaigns: CouponCampaignRepository
  readonly notify: (request: NotifyRequest) => Promise<NotifyResult>
  readonly audit: AuditLog
  readonly clock: Clock
}

async function grantableVersion(deps: CouponGrantDeps, versionId: number, at: Date) {
  const version = (await deps.coupons.grantables(at)).find((v) => v.couponVersionId === versionId)
  if (!version) throw new DomainError('coupon_not_grantable', 'coupon is not active or expired')
  return version
}

/** F-NTF: 「クーポン付与」 notification; one per grant (deduplicated on the grant id). */
function notifyGrant(
  deps: CouponGrantDeps,
  memberId: number,
  grantId: number,
  couponName: string,
  expiresAt: Date,
) {
  return deps.notify({
    event: 'coupon_granted',
    storeId: null,
    memberId,
    couponGrantId: grantId,
    values: { couponName, couponExpiresAt: formatExpiryDate(expiresAt) },
    deduplicationKey: `coupon_granted:${grantId}`,
  })
}

/**
 * A-13 個別クーポン発行: grants the current version of an active coupon to one member. Uses and
 * expiry may be lowered for this grant only. `requestKey` (a token rendered with the form) makes a
 * double submit grant once.
 */
export function makeGrantCouponToMember(deps: CouponGrantDeps) {
  return async function grantCouponToMember(
    actor: StaffActor,
    input: {
      memberCode: string
      couponVersionId: number
      maxUses?: number | null
      /** Last valid day (inclusive, Asia/Tokyo); null = the coupon's own end. */
      expiresOn?: LocalDate | null
      internalNote?: string | null
      notify: boolean
      requestKey: string
    },
  ) {
    assertRequestKey(input.requestKey)
    const member = await loadVisibleMember(deps, actor, input.memberCode, 'members.manage')
    if (member.status === 'withdrawn') {
      throw new DomainError('member_withdrawn', 'withdrawn members cannot receive coupons')
    }
    const now = deps.clock.now()
    const version = await grantableVersion(deps, input.couponVersionId, now)
    const maxUses = input.maxUses ?? version.maxUses
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      throw new DomainError('invalid_coupon', 'uses must be between 1 and 100')
    }
    const chosenEnd = input.expiresOn ? endOfLocalDate(input.expiresOn) : version.validTo
    const expiresAt = chosenEnd < version.validTo ? chosenEnd : version.validTo
    if (expiresAt <= now || expiresAt <= version.validFrom) {
      throw new DomainError('invalid_coupon', 'expiry must be in the future')
    }
    const internalNote = optionalText(input.internalNote, 1000)
    const { grantId, created } = await deps.coupons.grant({
      memberId: member.id,
      couponVersionId: version.couponVersionId,
      campaignId: null,
      issuanceKey: `admin:${input.requestKey}`,
      maxUses,
      validFrom: version.validFrom,
      expiresAt,
      grantedAt: now,
      grantedBy: actor.staffId,
      internalNote,
    })
    if (created) {
      await deps.audit.record({
        actor: auditActor(actor),
        action: 'coupon.grant',
        targetType: 'member',
        targetId: member.id,
        targetCode: member.memberCode,
        after: {
          grantId,
          couponId: version.couponId,
          couponVersionId: version.couponVersionId,
          maxUses,
          expiresAt: expiresAt.toISOString(),
          internalNote,
        },
      })
    }
    const notification = input.notify
      ? await notifyGrant(deps, member.id, grantId, version.name, expiresAt)
      : null
    return { grantId, created, notification }
  }
}

// ---------------------------------------------------------------- A-15 segment issuance

/** Fixed segments (A-15). Only `active` members are targeted. */
export type MemberSegment =
  | { readonly code: 'all_active' }
  | { readonly code: 'no_use_days'; readonly days: number }
  | { readonly code: 'registered_between'; readonly from: LocalDate; readonly to: LocalDate }
  | { readonly code: 'single_use' }
  | { readonly code: 'store_users'; readonly storeId: number }

export const SEGMENT_LABELS: Readonly<Record<MemberSegment['code'], string>> = {
  all_active: '有効な会員すべて',
  no_use_days: '一定期間ご利用のないお客様（未利用の会員を含む）',
  registered_between: '登録日が期間内のお客様',
  single_use: '初回利用のみのお客様（2回目未利用）',
  store_users: '特定店舗のご利用者',
}

/** Resolves a segment to absolute times; `baseTime` is fixed per campaign so a rerun selects the same members. */
export function resolveSegment(segment: MemberSegment, baseTime: Date): SegmentQuery {
  switch (segment.code) {
    case 'all_active':
    case 'single_use':
      return { kind: segment.code }
    case 'no_use_days': {
      if (!Number.isInteger(segment.days) || segment.days < 1 || segment.days > 3650) {
        throw new DomainError('invalid_segment', 'days must be 1-3650')
      }
      return {
        kind: 'no_use_since',
        since: new Date(baseTime.getTime() - segment.days * 86_400_000),
      }
    }
    case 'registered_between': {
      const from = startOfLocalDate(segment.from)
      const to = endOfLocalDate(segment.to)
      if (to <= from) throw new DomainError('invalid_segment', 'period must end after it starts')
      return { kind: 'registered_between', from, to }
    }
    case 'store_users':
      if (!Number.isInteger(segment.storeId) || segment.storeId <= 0) {
        throw new DomainError('invalid_segment', 'choose a store')
      }
      return { kind: 'store_users', storeId: segment.storeId }
    default:
      throw new DomainError('invalid_segment', 'unknown segment')
  }
}

/** A-15 対象件数プレビュー (with how many can be reached by LINE / email). */
export function makePreviewSegment(deps: CouponGrantDeps) {
  return async function previewSegment(
    actor: StaffActor,
    segment: MemberSegment,
  ): Promise<SegmentCount> {
    assertCan(actor.access, 'coupons.manage')
    return deps.campaigns.countSegment(resolveSegment(segment, deps.clock.now()))
  }
}

export function makeListCampaigns(deps: CouponGrantDeps) {
  return async function listCampaigns(actor: StaffActor): Promise<CampaignRow[]> {
    assertCan(actor.access, 'coupons.manage')
    return deps.campaigns.listCampaigns(50)
  }
}

const BATCH_SIZE = 200

/**
 * A-15 一斉発行. Idempotent on `campaignKey` (a token rendered with the form): a completed campaign
 * is not run again, and an interrupted one resumes — grants use per-member issuance keys and
 * notifications are deduplicated per grant, so nobody gets a coupon or a message twice.
 *
 * Runs inside the request in batches; segments of a few thousand members fit comfortably. Moving
 * the loop to the jobs worker is the follow-up if segments grow much larger.
 */
export function makeRunCampaign(deps: CouponGrantDeps) {
  return async function runCampaign(
    actor: StaffActor,
    input: {
      campaignKey: string
      name: string
      couponVersionId: number
      segment: MemberSegment
      notify: boolean
    },
  ) {
    assertCan(actor.access, 'coupons.manage')
    assertRequestKey(input.campaignKey)
    const name = requireText(input.name, 'name_required', 200)
    const existing = await deps.campaigns.findCampaign(input.campaignKey)
    if (existing?.status === 'completed') {
      return {
        campaignId: existing.id,
        granted: existing.grantedCount,
        notified: 0,
        screenOnly: 0,
        alreadyRan: true,
      }
    }
    const now = deps.clock.now()
    const baseTime =
      typeof existing?.segmentConditions.baseTime === 'string'
        ? new Date(existing.segmentConditions.baseTime)
        : now
    const query = resolveSegment(input.segment, baseTime)
    const version: GrantableVersion = await grantableVersion(
      deps,
      existing?.couponVersionId ?? input.couponVersionId,
      now,
    )
    const count = await deps.campaigns.countSegment(query)
    const campaignId =
      existing?.id ??
      (await deps.campaigns.createCampaign({
        campaignKey: input.campaignKey,
        couponVersionId: version.couponVersionId,
        name,
        segmentCode: input.segment.code,
        segmentConditions: { ...input.segment, baseTime: baseTime.toISOString() },
        previewCount: count.total,
        targetCount: count.total,
        issuedBy: actor.staffId,
      }))
    await deps.campaigns.updateCampaign(campaignId, { status: 'running', startedAt: now })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'coupon.campaign_start',
      targetType: 'coupon_campaign',
      targetId: campaignId,
      targetCode: input.campaignKey,
      after: {
        name,
        couponVersionId: version.couponVersionId,
        segment: input.segment,
        targetCount: count.total,
        resumed: !!existing,
      },
    })

    let granted = 0
    let notified = 0
    let screenOnly = 0
    try {
      let afterId = 0
      for (;;) {
        const memberIds = await deps.campaigns.segmentMemberIds(query, afterId, BATCH_SIZE)
        if (memberIds.length === 0) break
        for (const memberId of memberIds) {
          const { grantId, created } = await deps.coupons.grant({
            memberId,
            couponVersionId: version.couponVersionId,
            campaignId,
            issuanceKey: `campaign:${campaignId}:${memberId}`,
            maxUses: version.maxUses,
            validFrom: version.validFrom,
            expiresAt: version.validTo,
            grantedAt: now,
            grantedBy: actor.staffId,
            internalNote: null,
          })
          if (created) granted++
          if (input.notify) {
            const result = await notifyGrant(deps, memberId, grantId, version.name, version.validTo)
            if (result.status === 'queued') notified++
            else screenOnly++
          }
        }
        afterId = memberIds[memberIds.length - 1] as number
      }
    } catch (error) {
      await deps.campaigns.updateCampaign(campaignId, { status: 'failed', finishedAt: now })
      throw error
    }
    await deps.campaigns.updateCampaign(campaignId, {
      status: 'completed',
      finishedAt: deps.clock.now(),
    })
    await deps.audit.record({
      actor: auditActor(actor),
      action: 'coupon.campaign_complete',
      targetType: 'coupon_campaign',
      targetId: campaignId,
      targetCode: input.campaignKey,
      after: { granted, notified, screenOnly },
    })
    return { campaignId, granted, notified, screenOnly, alreadyRan: false }
  }
}
