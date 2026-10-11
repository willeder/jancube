import type { StoreRepository } from '@jancube/application'
import type { Store, StoreStatus } from '@jancube/domain'
import type { Database } from './create-db'

export class KyselyStoreRepository implements StoreRepository {
  constructor(private readonly db: Database) {}

  async listActive(): Promise<Store[]> {
    const rows = await this.db
      .selectFrom('stores')
      .select([
        'id',
        'code',
        'name',
        'address',
        'access_text',
        'map_url',
        'timezone',
        'status',
        'is_active',
      ])
      .where('is_active', '=', 1)
      .orderBy('code')
      .execute()

    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      name: r.name,
      address: r.address,
      accessText: r.access_text,
      mapUrl: r.map_url,
      timezone: r.timezone,
      status: r.status as StoreStatus,
      isActive: r.is_active === 1,
    }))
  }
}
