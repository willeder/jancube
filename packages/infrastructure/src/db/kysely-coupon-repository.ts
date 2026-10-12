import type { CouponOffer, CouponRepository, GrantableCoupon } from '@jancube/application'
import type { Database } from './create-db'

const later = (a: Date, b: Date) => (a > b ? a : b)
const earlier = (a: Date, b: Date) => (a < b ? a : b)

export class KyselyCouponRepository implements CouponRepository {
  constructor(private readonly db: Database) {}

  async usableGrants(memberId: number, at: Date, bookingId: number): Promise<CouponOffer[]> {
    const rows = await this.db
      .selectFrom('coupon_grants as g')
      .innerJoin('coupon_versions as v', 'v.id', 'g.coupon_version_id')
      .innerJoin('coupons as c', 'c.id', 'v.coupon_id')
      .select([
        'g.id as grant_id',
        'g.max_uses',
        'g.valid_from as grant_from',
        'g.expires_at as grant_to',
        'c.name',
        'v.id as version_id',
        'v.discount_type',
        'v.discount_value',
        'v.maximum_discount_amount',
        'v.minimum_spend_amount',
        'v.valid_from',
        'v.valid_to',
        'v.weekday_mask',
        'v.start_minute',
        'v.end_minute',
        'v.conditions_note',
      ])
      .select((eb) =>
        eb
          .selectFrom('coupon_redemptions as r')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('r.coupon_grant_id', '=', 'g.id')
          .where('r.status', 'in', ['reserved', 'applied'])
          .where('r.booking_id', '<>', bookingId)
          .as('used'),
      )
      .where('g.member_id', '=', memberId)
      .where('g.revoked_at', 'is', null)
      .where('g.valid_from', '<=', at)
      .where('g.expires_at', '>', at)
      .where('c.status', '=', 'active')
      .execute()
    const usable = rows.filter((r) => Number(r.used ?? 0) < r.max_uses)
    if (usable.length === 0) return []

    const versionIds = [...new Set(usable.map((r) => r.version_id))]
    const [stores, roomTypes] = await Promise.all([
      this.db
        .selectFrom('coupon_stores')
        .select(['coupon_version_id', 'store_id'])
        .where('coupon_version_id', 'in', versionIds)
        .execute(),
      this.db
        .selectFrom('coupon_room_types')
        .select(['coupon_version_id', 'room_type_id'])
        .where('coupon_version_id', 'in', versionIds)
        .execute(),
    ])
    return usable.map((r) => ({
      grantId: Number(r.grant_id),
      couponName: r.name,
      conditionsNote: r.conditions_note,
      expiresAt: earlier(r.grant_to, r.valid_to),
      terms: {
        discountType: r.discount_type as 'amount' | 'percent',
        discountValue: Number(r.discount_value),
        maximumDiscount:
          r.maximum_discount_amount === null ? null : Number(r.maximum_discount_amount),
        minimumSpend: Number(r.minimum_spend_amount),
        validFrom: later(r.grant_from, r.valid_from),
        validTo: earlier(r.grant_to, r.valid_to),
        weekdayMask: r.weekday_mask,
        startMinute: r.start_minute,
        endMinute: r.end_minute,
        storeIds: stores
          .filter((s) => s.coupon_version_id === r.version_id)
          .map((s) => Number(s.store_id)),
        roomTypeIds: roomTypes
          .filter((t) => t.coupon_version_id === r.version_id)
          .map((t) => Number(t.room_type_id)),
      },
    }))
  }

  async findClaimableByCode(code: string, at: Date) {
    // Assumption to confirm with the client: typing a code claims only coupons whose grant trigger is
    // 'manual'; registration / LINE-friend / first-use coupons are granted automatically, not by code.
    const [coupon] = await this.currentVersions(at, { code, trigger: 'manual' })
    return coupon ?? null
  }

  findByTrigger(trigger: 'registration', at: Date) {
    return this.currentVersions(at, { trigger })
  }

  async grant(input: Parameters<CouponRepository['grant']>[0]) {
    await this.db
      .insertInto('coupon_grants')
      .ignore()
      .values({
        member_id: input.memberId,
        coupon_version_id: input.coupon.couponVersionId,
        issuance_key: input.issuanceKey,
        max_uses: input.coupon.maxUses,
        valid_from: input.coupon.validFrom,
        expires_at: input.coupon.validTo,
        granted_at: input.grantedAt,
      })
      .execute()
    const row = await this.db
      .selectFrom('coupon_grants')
      .select('id')
      .where('issuance_key', '=', input.issuanceKey)
      .executeTakeFirstOrThrow()
    return Number(row.id)
  }

  /** The latest version of each active coupon, valid at `at`, with the given grant trigger. */
  private async currentVersions(
    at: Date,
    filter: { code?: string; trigger: string },
  ): Promise<GrantableCoupon[]> {
    let query = this.db
      .selectFrom('coupons as c')
      .innerJoin('coupon_versions as v', 'v.coupon_id', 'c.id')
      .select([
        'c.id as coupon_id',
        'c.name',
        'v.id as version_id',
        'v.max_uses',
        'v.valid_from',
        'v.valid_to',
        'v.grant_trigger',
      ])
      .where('c.status', '=', 'active')
      .where((eb) =>
        eb(
          'v.version_no',
          '=',
          eb
            .selectFrom('coupon_versions as latest')
            .select((e) => e.fn.max('latest.version_no').as('v'))
            .whereRef('latest.coupon_id', '=', 'c.id'),
        ),
      )
      .where('v.valid_from', '<=', at)
      .where('v.valid_to', '>', at)
    if (filter.code) query = query.where('c.code', '=', filter.code)
    const rows = await query.execute()
    return rows
      .filter((r) => r.grant_trigger === filter.trigger)
      .map((r) => ({
        couponId: Number(r.coupon_id),
        couponVersionId: Number(r.version_id),
        name: r.name,
        maxUses: r.max_uses,
        validFrom: r.valid_from,
        validTo: r.valid_to,
      }))
  }
}
