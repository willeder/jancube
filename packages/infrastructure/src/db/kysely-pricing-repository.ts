import type { PricedProfile, PricingRepository } from '@jancube/application'
import type { CombinationRule } from '@jancube/domain'
import type { Database } from './create-db'
import { toNumber } from './sql-values'

/**
 * Price profile versions assigned per room (price_assignments, room-level per 2026-10-01 decision).
 * The package/hourly combination rule is not stored in the schema yet, so it is passed in as config.
 */
export class KyselyPricingRepository implements PricingRepository {
  constructor(
    private readonly db: Database,
    private readonly options: { combinationRule: CombinationRule },
  ) {}

  async forRoom(roomId: number, at: Date): Promise<PricedProfile | null> {
    const version = await this.db
      .selectFrom('price_assignments as pa')
      .innerJoin('price_profile_versions as v', 'v.id', 'pa.price_version_id')
      .select(['v.id', 'v.hourly_amount', 'v.minimum_minutes', 'v.tax_rate'])
      .where('pa.room_id', '=', roomId)
      .where('pa.valid_from', '<=', at)
      .where((eb) => eb.or([eb('pa.valid_to', 'is', null), eb('pa.valid_to', '>', at)]))
      .where('v.status', '=', 'published')
      .where('v.valid_from', '<=', at)
      .where((eb) => eb.or([eb('v.valid_to', 'is', null), eb('v.valid_to', '>', at)]))
      .orderBy('pa.priority', 'desc')
      .orderBy('pa.valid_from', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!version) return null

    const packages = await this.db
      .selectFrom('price_packages')
      .select(['duration_minutes', 'package_amount'])
      .where('price_version_id', '=', version.id)
      .orderBy('duration_minutes')
      .execute()

    return {
      priceVersionId: Number(version.id),
      minimumMinutes: version.minimum_minutes,
      taxRatePercent: toNumber(version.tax_rate),
      profile: {
        hourlyRate: Number(version.hourly_amount),
        packages: packages.map((p) => ({
          minutes: p.duration_minutes,
          price: Number(p.package_amount),
        })),
        combinationRule: this.options.combinationRule,
      },
    }
  }
}
