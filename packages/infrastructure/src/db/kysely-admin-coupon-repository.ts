import type {
  CampaignRow,
  CampaignStatus,
  CouponAdminRepository,
  CouponCampaignRepository,
  CouponVersionView,
  SegmentQuery,
} from '@jancube/application'
import type { CouponGrantTrigger, CouponStatus, CouponVersionDraft } from '@jancube/domain'
import { type ExpressionBuilder, sql, type Transaction } from 'kysely'
import type { Database } from './create-db'
import type { DB } from './schema.generated'

const USED = ['confirmed', 'completed']

type VersionRow = {
  id: number
  coupon_id: number
  version_no: number
  discount_type: string
  discount_value: string
  maximum_discount_amount: number | null
  minimum_spend_amount: number
  max_uses: number
  valid_from: Date
  valid_to: Date
  weekday_mask: number
  start_minute: number | null
  end_minute: number | null
  grant_trigger: string
  stackable: number
  conditions_note: string | null
  created_at: Date
}

const versionColumns = [
  'v.id',
  'v.coupon_id',
  'v.version_no',
  'v.discount_type',
  'v.discount_value',
  'v.maximum_discount_amount',
  'v.minimum_spend_amount',
  'v.max_uses',
  'v.valid_from',
  'v.valid_to',
  'v.weekday_mask',
  'v.start_minute',
  'v.end_minute',
  'v.grant_trigger',
  'v.stackable',
  'v.conditions_note',
  'v.created_at',
] as const

/** A-13 / A-14 / A-15: coupon master, grants and segment campaigns. */
export class KyselyCouponAdminRepository
  implements CouponAdminRepository, CouponCampaignRepository
{
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------- master

  private async versions(filter: { couponIds?: number[]; latestOnly?: boolean }) {
    let query = this.db.selectFrom('coupon_versions as v').select(versionColumns)
    if (filter.couponIds) {
      query = query.where('v.coupon_id', 'in', filter.couponIds.length ? filter.couponIds : [0])
    }
    if (filter.latestOnly) {
      query = query.where((eb) =>
        eb(
          'v.version_no',
          '=',
          eb
            .selectFrom('coupon_versions as latest')
            .select((e) => e.fn.max('latest.version_no').as('n'))
            .whereRef('latest.coupon_id', '=', 'v.coupon_id'),
        ),
      )
    }
    const rows = await query.orderBy('v.version_no', 'desc').execute()
    const ids = rows.map((r) => r.id)
    const [stores, types] = ids.length
      ? await Promise.all([
          this.db
            .selectFrom('coupon_stores')
            .select(['coupon_version_id', 'store_id'])
            .where('coupon_version_id', 'in', ids)
            .execute(),
          this.db
            .selectFrom('coupon_room_types')
            .select(['coupon_version_id', 'room_type_id'])
            .where('coupon_version_id', 'in', ids)
            .execute(),
        ])
      : [[], []]
    return rows.map((r) => ({
      couponId: Number(r.coupon_id),
      view: toVersion(
        r,
        stores.filter((s) => s.coupon_version_id === r.id).map((s) => Number(s.store_id)),
        types.filter((t) => t.coupon_version_id === r.id).map((t) => Number(t.room_type_id)),
      ),
    }))
  }

  async list() {
    const coupons = await this.db
      .selectFrom('coupons as c')
      .select(['c.id', 'c.code', 'c.name', 'c.campaign_tag', 'c.status'])
      .select((eb) =>
        eb
          .selectFrom('coupon_grants as g')
          .innerJoin('coupon_versions as gv', 'gv.id', 'g.coupon_version_id')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('gv.coupon_id', '=', 'c.id')
          .as('grant_count'),
      )
      .orderBy('c.id', 'desc')
      .execute()
    const latest = await this.versions({ latestOnly: true })
    return coupons.map((c) => ({
      id: Number(c.id),
      code: c.code,
      name: c.name,
      campaignTag: c.campaign_tag,
      status: c.status as CouponStatus,
      latest: latest.find((v) => v.couponId === Number(c.id))?.view ?? null,
      grantCount: Number(c.grant_count ?? 0),
    }))
  }

  async find(couponId: number) {
    const coupon = await this.db
      .selectFrom('coupons')
      .select(['id', 'code', 'name', 'campaign_tag', 'status'])
      .where('id', '=', couponId)
      .executeTakeFirst()
    if (!coupon) return null
    const versions = await this.versions({ couponIds: [couponId] })
    return {
      id: Number(coupon.id),
      code: coupon.code,
      name: coupon.name,
      campaignTag: coupon.campaign_tag,
      status: coupon.status as CouponStatus,
      versions: versions.map((v) => v.view),
    }
  }

  async codeTaken(code: string) {
    const row = await this.db
      .selectFrom('coupons')
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst()
    return !!row
  }

  create(coupon: Parameters<CouponAdminRepository['create']>[0], version: CouponVersionDraft) {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('coupons')
        .values({
          code: coupon.code,
          name: coupon.name,
          campaign_tag: coupon.campaignTag,
          status: coupon.status,
          created_by: coupon.createdBy,
        })
        .executeTakeFirstOrThrow()
      const couponId = Number(inserted.insertId)
      const versionId = await insertVersion(trx, couponId, 1, version, coupon.createdBy)
      return { couponId, versionId }
    })
  }

  addVersion(couponId: number, version: CouponVersionDraft, publishedBy: number) {
    return this.db.transaction().execute(async (trx) => {
      // Lock the coupon row so two editors cannot take the same version number.
      await trx.selectFrom('coupons').select('id').where('id', '=', couponId).forUpdate().execute()
      const last = await trx
        .selectFrom('coupon_versions')
        .select((eb) => eb.fn.max('version_no').as('n'))
        .where('coupon_id', '=', couponId)
        .executeTakeFirst()
      const versionNo = Number(last?.n ?? 0) + 1
      const versionId = await insertVersion(trx, couponId, versionNo, version, publishedBy)
      return { versionId, versionNo }
    })
  }

  async update(couponId: number, values: { name: string; campaignTag: string | null }) {
    await this.db
      .updateTable('coupons')
      .set({ name: values.name, campaign_tag: values.campaignTag })
      .where('id', '=', couponId)
      .execute()
  }

  async setStatus(couponId: number, status: CouponStatus) {
    await this.db.updateTable('coupons').set({ status }).where('id', '=', couponId).execute()
  }

  async grantables(at: Date) {
    const rows = await this.db
      .selectFrom('coupons as c')
      .innerJoin('coupon_versions as v', 'v.coupon_id', 'c.id')
      .select([
        'c.id as coupon_id',
        'c.code',
        'c.name',
        'v.id as version_id',
        'v.version_no',
        'v.max_uses',
        'v.valid_from',
        'v.valid_to',
        'v.grant_trigger',
        'v.discount_type',
        'v.discount_value',
      ])
      .where('c.status', '=', 'active')
      .where('v.valid_to', '>', at)
      .where((eb) =>
        eb(
          'v.version_no',
          '=',
          eb
            .selectFrom('coupon_versions as latest')
            .select((e) => e.fn.max('latest.version_no').as('n'))
            .whereRef('latest.coupon_id', '=', 'c.id'),
        ),
      )
      .orderBy('c.name')
      .execute()
    return rows.map((r) => ({
      couponId: Number(r.coupon_id),
      couponVersionId: Number(r.version_id),
      code: r.code,
      name: r.name,
      versionNo: r.version_no,
      maxUses: r.max_uses,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      grantTrigger: r.grant_trigger as CouponGrantTrigger,
      discountType: r.discount_type as 'amount' | 'percent',
      discountValue: Number(r.discount_value),
    }))
  }

  async grant(grant: Parameters<CouponAdminRepository['grant']>[0]) {
    const inserted = await this.db
      .insertInto('coupon_grants')
      .ignore()
      .values({
        member_id: grant.memberId,
        coupon_version_id: grant.couponVersionId,
        campaign_id: grant.campaignId,
        issuance_key: grant.issuanceKey,
        max_uses: grant.maxUses,
        valid_from: grant.validFrom,
        expires_at: grant.expiresAt,
        granted_at: grant.grantedAt,
        granted_by: grant.grantedBy,
        internal_note: grant.internalNote,
      })
      .executeTakeFirst()
    const created = Number(inserted.numInsertedOrUpdatedRows ?? 0n) > 0
    const row = await this.db
      .selectFrom('coupon_grants')
      .select('id')
      .where('issuance_key', '=', grant.issuanceKey)
      .executeTakeFirstOrThrow()
    return { grantId: Number(row.id), created }
  }

  // ---------------------------------------------------------------- A-15 segments

  /** Active members of a fixed segment (bookings count as use when confirmed or completed). */
  private segmentWhere(segment: SegmentQuery) {
    return (eb: ExpressionBuilder<DB, 'members'>) => {
      const uses = () =>
        eb
          .selectFrom('bookings')
          .select('bookings.id')
          .whereRef('bookings.member_id', '=', 'members.id')
          .where('bookings.status', 'in', USED)
      const active = eb('members.status', '=', 'active')
      switch (segment.kind) {
        case 'all_active':
          return active
        case 'no_use_since':
          return eb.and([
            active,
            eb.not(eb.exists(uses().where('bookings.starts_at', '>=', segment.since))),
          ])
        case 'registered_between':
          return eb.and([
            active,
            eb('members.created_at', '>=', segment.from),
            eb('members.created_at', '<', segment.to),
          ])
        case 'single_use':
          return eb.and([
            active,
            eb(
              eb
                .selectFrom('bookings')
                .select((e) => e.fn.countAll<number>().as('n'))
                .whereRef('bookings.member_id', '=', 'members.id')
                .where('bookings.status', 'in', USED),
              '=',
              1,
            ),
          ])
        case 'store_users':
          return eb.and([
            active,
            eb.exists(uses().where('bookings.store_id', '=', segment.storeId)),
          ])
      }
    }
  }

  async countSegment(segment: SegmentQuery) {
    const line = sql`exists (select 1 from member_line_links l where l.member_id = members.id and l.friend_status <> 'blocked')`
    const row = await this.db
      .selectFrom('members')
      .select((eb) => [
        eb.fn.countAll<number>().as('total'),
        eb.fn.sum<number>(sql`case when ${line} then 1 else 0 end`).as('line'),
        eb.fn
          .sum<number>(
            sql`case when not ${line} and members.email_normalized is not null then 1 else 0 end`,
          )
          .as('email'),
      ])
      .where(this.segmentWhere(segment))
      .executeTakeFirstOrThrow()
    const total = Number(row.total)
    const lineCount = Number(row.line ?? 0)
    const email = Number(row.email ?? 0)
    return { total, line: lineCount, email, none: total - lineCount - email }
  }

  async segmentMemberIds(segment: SegmentQuery, afterId: number, limit: number) {
    const rows = await this.db
      .selectFrom('members')
      .select('members.id')
      .where(this.segmentWhere(segment))
      .where('members.id', '>', afterId)
      .orderBy('members.id')
      .limit(limit)
      .execute()
    return rows.map((r) => Number(r.id))
  }

  private campaignQuery() {
    return this.db
      .selectFrom('coupon_campaigns as k')
      .innerJoin('coupon_versions as v', 'v.id', 'k.coupon_version_id')
      .innerJoin('coupons as c', 'c.id', 'v.coupon_id')
      .innerJoin('staff as s', 's.id', 'k.issued_by')
      .select([
        'k.id',
        'k.campaign_key',
        'k.name',
        'k.coupon_version_id',
        'c.name as coupon_name',
        'k.segment_code',
        'k.segment_conditions',
        'k.preview_count',
        'k.target_count',
        'k.status',
        's.name as issued_by_name',
        'k.started_at',
        'k.finished_at',
        'k.created_at',
      ])
      .select((eb) =>
        eb
          .selectFrom('coupon_grants as g')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('g.campaign_id', '=', 'k.id')
          .as('granted_count'),
      )
  }

  async findCampaign(campaignKey: string) {
    const row = await this.campaignQuery()
      .where('k.campaign_key', '=', campaignKey)
      .executeTakeFirst()
    return row ? toCampaign(row) : null
  }

  async createCampaign(campaign: Parameters<CouponCampaignRepository['createCampaign']>[0]) {
    const inserted = await this.db
      .insertInto('coupon_campaigns')
      .values({
        campaign_key: campaign.campaignKey,
        coupon_version_id: campaign.couponVersionId,
        name: campaign.name,
        segment_code: campaign.segmentCode,
        segment_conditions: JSON.stringify(campaign.segmentConditions),
        preview_count: campaign.previewCount,
        target_count: campaign.targetCount,
        status: 'queued',
        issued_by: campaign.issuedBy,
      })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async updateCampaign(
    id: number,
    values: { status: CampaignStatus; startedAt?: Date; finishedAt?: Date },
  ) {
    await this.db
      .updateTable('coupon_campaigns')
      .set({
        status: values.status,
        ...(values.startedAt ? { started_at: values.startedAt } : {}),
        ...(values.finishedAt ? { finished_at: values.finishedAt } : {}),
      })
      .where('id', '=', id)
      .execute()
  }

  async listCampaigns(limit: number) {
    const rows = await this.campaignQuery().orderBy('k.id', 'desc').limit(limit).execute()
    return rows.map(toCampaign)
  }
}

async function insertVersion(
  trx: Transaction<DB>,
  couponId: number,
  versionNo: number,
  v: CouponVersionDraft,
  publishedBy: number,
): Promise<number> {
  const inserted = await trx
    .insertInto('coupon_versions')
    .values({
      coupon_id: couponId,
      version_no: versionNo,
      discount_type: v.discountType,
      discount_value: v.discountValue,
      maximum_discount_amount: v.maximumDiscount,
      minimum_spend_amount: v.minimumSpend,
      max_uses: v.maxUses,
      valid_from: v.validFrom,
      valid_to: v.validTo,
      weekday_mask: v.weekdayMask,
      start_minute: v.startMinute,
      end_minute: v.endMinute,
      grant_trigger: v.grantTrigger,
      stackable: v.stackable ? 1 : 0,
      conditions_note: v.conditionsNote,
      published_by: publishedBy,
    })
    .executeTakeFirstOrThrow()
  const versionId = Number(inserted.insertId)
  if (v.storeIds.length > 0) {
    await trx
      .insertInto('coupon_stores')
      .values(v.storeIds.map((storeId) => ({ coupon_version_id: versionId, store_id: storeId })))
      .execute()
  }
  if (v.roomTypeIds.length > 0) {
    await trx
      .insertInto('coupon_room_types')
      .values(
        v.roomTypeIds.map((roomTypeId) => ({
          coupon_version_id: versionId,
          room_type_id: roomTypeId,
        })),
      )
      .execute()
  }
  return versionId
}

function toVersion(r: VersionRow, storeIds: number[], roomTypeIds: number[]): CouponVersionView {
  return {
    id: Number(r.id),
    versionNo: r.version_no,
    publishedAt: r.created_at,
    discountType: r.discount_type as 'amount' | 'percent',
    discountValue: Number(r.discount_value),
    maximumDiscount: r.maximum_discount_amount === null ? null : Number(r.maximum_discount_amount),
    minimumSpend: Number(r.minimum_spend_amount),
    maxUses: r.max_uses,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    weekdayMask: r.weekday_mask,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    grantTrigger: r.grant_trigger as CouponGrantTrigger,
    stackable: r.stackable === 1,
    conditionsNote: r.conditions_note,
    storeIds,
    roomTypeIds,
  }
}

function toCampaign(r: {
  id: number
  campaign_key: string
  name: string
  coupon_version_id: number
  coupon_name: string
  segment_code: string
  segment_conditions: unknown
  preview_count: number
  target_count: number
  status: string
  issued_by_name: string
  started_at: Date | null
  finished_at: Date | null
  created_at: Date
  granted_count: number | null
}): CampaignRow {
  const conditions =
    typeof r.segment_conditions === 'string'
      ? JSON.parse(r.segment_conditions)
      : (r.segment_conditions ?? {})
  return {
    id: Number(r.id),
    campaignKey: r.campaign_key,
    name: r.name,
    couponVersionId: Number(r.coupon_version_id),
    couponName: r.coupon_name,
    segmentCode: r.segment_code,
    segmentConditions: conditions as Record<string, unknown>,
    previewCount: r.preview_count,
    targetCount: r.target_count,
    grantedCount: Number(r.granted_count ?? 0),
    status: r.status as CampaignStatus,
    issuedByName: r.issued_by_name,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
  }
}
