import type {
  PriceAdminRepository,
  PriceAssignmentView,
  PriceRoomOption,
  PriceVersionView,
} from '@jancube/application'
import type { PriceVersionDraft } from '@jancube/domain'
import type { Database } from './create-db'
import { toNumber } from './sql-values'

/** A-16 / A-17: price profiles, immutable versions and room assignments. */
export class KyselyPriceAdminRepository implements PriceAdminRepository {
  constructor(private readonly db: Database) {}

  private async versions(filter: { profileIds?: number[]; versionIds?: number[] }) {
    let query = this.db
      .selectFrom('price_profile_versions as v')
      .innerJoin('price_profiles as p', 'p.id', 'v.price_profile_id')
      .select([
        'v.id',
        'v.price_profile_id',
        'p.name as profile_name',
        'v.version_no',
        'v.status',
        'v.hourly_amount',
        'v.minimum_minutes',
        'v.tax_rate',
        'v.valid_from',
        'v.valid_to',
        'v.published_at',
      ])
    if (filter.profileIds) {
      query = query.where(
        'v.price_profile_id',
        'in',
        filter.profileIds.length ? filter.profileIds : [0],
      )
    }
    if (filter.versionIds) {
      query = query.where('v.id', 'in', filter.versionIds.length ? filter.versionIds : [0])
    }
    const rows = await query.orderBy('v.version_no', 'desc').execute()
    const ids = rows.map((r) => r.id)
    const [packages, rules] = ids.length
      ? await Promise.all([
          this.db
            .selectFrom('price_packages')
            .select(['price_version_id', 'duration_minutes', 'package_amount'])
            .where('price_version_id', 'in', ids)
            .orderBy('duration_minutes')
            .execute(),
          this.db
            .selectFrom('price_time_rules')
            .select([
              'price_version_id',
              'weekday_mask',
              'holiday_mode',
              'start_minute',
              'end_minute',
              'hourly_discount_amount',
              'priority',
            ])
            .where('price_version_id', 'in', ids)
            .orderBy('priority')
            .execute(),
        ])
      : [[], []]
    return rows.map((r): PriceVersionView & { profileName: string } => ({
      id: Number(r.id),
      profileId: Number(r.price_profile_id),
      profileName: r.profile_name,
      versionNo: r.version_no,
      status: r.status as PriceVersionView['status'],
      hourlyRate: Number(r.hourly_amount),
      minimumMinutes: r.minimum_minutes,
      taxRatePercent: toNumber(r.tax_rate),
      validFrom: r.valid_from,
      validTo: r.valid_to,
      publishedAt: r.published_at,
      packages: packages
        .filter((p) => p.price_version_id === r.id)
        .map((p) => ({ minutes: p.duration_minutes, price: Number(p.package_amount) })),
      timeRules: rules
        .filter((t) => t.price_version_id === r.id)
        .map((t) => ({
          weekdayMask: t.weekday_mask,
          holidayMode: t.holiday_mode as 'any' | 'only' | 'exclude',
          startMinute: t.start_minute,
          endMinute: t.end_minute,
          hourlyDiscount: Number(t.hourly_discount_amount),
          priority: t.priority,
        })),
    }))
  }

  async listProfiles(at: Date) {
    const profiles = await this.db
      .selectFrom('price_profiles')
      .select(['id', 'code', 'name', 'is_active'])
      .orderBy('code')
      .execute()
    const versions = await this.versions({ profileIds: profiles.map((p) => p.id) })
    const current = await this.assignments({ at })
    return profiles.map((p) => {
      const id = Number(p.id)
      const inEffect = current.filter((a) => a.profileId === id && a.validFrom <= at)
      return {
        id,
        code: p.code,
        name: p.name,
        isActive: p.is_active === 1,
        latest: versions.find((v) => v.profileId === id) ?? null,
        roomCount: new Set(inEffect.map((a) => a.roomId)).size,
      }
    })
  }

  async findProfile(profileId: number) {
    const p = await this.db
      .selectFrom('price_profiles')
      .select(['id', 'code', 'name', 'is_active'])
      .where('id', '=', profileId)
      .executeTakeFirst()
    if (!p) return null
    return {
      id: Number(p.id),
      code: p.code,
      name: p.name,
      isActive: p.is_active === 1,
      versions: await this.versions({ profileIds: [profileId] }),
    }
  }

  async findVersion(versionId: number) {
    const [version] = await this.versions({ versionIds: [versionId] })
    return version ?? null
  }

  async codeTaken(code: string) {
    const row = await this.db
      .selectFrom('price_profiles')
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst()
    return !!row
  }

  async createProfile(profile: { code: string; name: string }) {
    const inserted = await this.db
      .insertInto('price_profiles')
      .values({ code: profile.code, name: profile.name, is_active: 1 })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async updateProfile(profileId: number, values: { name: string; isActive: boolean }) {
    await this.db
      .updateTable('price_profiles')
      .set({ name: values.name, is_active: values.isActive ? 1 : 0 })
      .where('id', '=', profileId)
      .execute()
  }

  publishVersion(
    profileId: number,
    draft: PriceVersionDraft,
    publishedBy: number,
    publishedAt: Date,
  ) {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('price_profiles')
        .select('id')
        .where('id', '=', profileId)
        .forUpdate()
        .execute()
      const last = await trx
        .selectFrom('price_profile_versions')
        .select((eb) => eb.fn.max('version_no').as('n'))
        .where('price_profile_id', '=', profileId)
        .executeTakeFirst()
      const versionNo = Number(last?.n ?? 0) + 1
      const inserted = await trx
        .insertInto('price_profile_versions')
        .values({
          price_profile_id: profileId,
          version_no: versionNo,
          status: 'published',
          hourly_amount: draft.hourlyRate,
          minimum_minutes: draft.minimumMinutes,
          valid_from: draft.validFrom,
          valid_to: null,
          tax_rate: draft.taxRatePercent,
          published_by: publishedBy,
          published_at: publishedAt,
        })
        .executeTakeFirstOrThrow()
      const versionId = Number(inserted.insertId)
      if (draft.packages.length > 0) {
        await trx
          .insertInto('price_packages')
          .values(
            draft.packages.map((p) => ({
              price_version_id: versionId,
              duration_minutes: p.minutes,
              package_amount: p.price,
            })),
          )
          .execute()
      }
      if (draft.timeRules.length > 0) {
        await trx
          .insertInto('price_time_rules')
          .values(
            draft.timeRules.map((r) => ({
              price_version_id: versionId,
              weekday_mask: r.weekdayMask,
              holiday_mode: r.holidayMode,
              start_minute: r.startMinute,
              end_minute: r.endMinute,
              hourly_discount_amount: r.hourlyDiscount,
              priority: r.priority,
            })),
          )
          .execute()
      }
      return { versionId, versionNo }
    })
  }

  async assignments(filter: {
    at: Date
    profileId?: number
    storeIds?: readonly number[] | null
  }): Promise<PriceAssignmentView[]> {
    let query = this.db
      .selectFrom('price_assignments as a')
      .innerJoin('price_profile_versions as v', 'v.id', 'a.price_version_id')
      .innerJoin('price_profiles as p', 'p.id', 'v.price_profile_id')
      .innerJoin('rooms as r', 'r.id', 'a.room_id')
      .innerJoin('stores as s', 's.id', 'r.store_id')
      .select([
        'a.id',
        'a.room_id',
        'r.code as room_code',
        'r.store_id',
        's.code as store_code',
        'p.id as profile_id',
        'p.name as profile_name',
        'v.id as version_id',
        'v.version_no',
        'a.valid_from',
        'a.valid_to',
      ])
      .where((eb) => eb.or([eb('a.valid_to', 'is', null), eb('a.valid_to', '>', filter.at)]))
    if (filter.profileId !== undefined) query = query.where('p.id', '=', filter.profileId)
    if (filter.storeIds) {
      query = query.where('r.store_id', 'in', filter.storeIds.length ? [...filter.storeIds] : [0])
    }
    const rows = await query
      .orderBy('s.code')
      .orderBy('r.sort_order')
      .orderBy('a.valid_from')
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      roomId: Number(r.room_id),
      roomCode: r.room_code,
      storeId: Number(r.store_id),
      storeCode: r.store_code,
      profileId: Number(r.profile_id),
      profileName: r.profile_name,
      versionId: Number(r.version_id),
      versionNo: r.version_no,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }))
  }

  async roomsOnProfile(profileId: number, at: Date) {
    const rows = await this.db
      .selectFrom('price_assignments as a')
      .innerJoin('price_profile_versions as v', 'v.id', 'a.price_version_id')
      .select('a.room_id')
      .distinct()
      .where('v.price_profile_id', '=', profileId)
      .where('a.valid_from', '<=', at)
      .where((eb) => eb.or([eb('a.valid_to', 'is', null), eb('a.valid_to', '>', at)]))
      .execute()
    return rows.map((r) => Number(r.room_id))
  }

  assign(input: { roomIds: readonly number[]; versionId: number; validFrom: Date }) {
    return this.db.transaction().execute(async (trx) => {
      const roomIds = [...input.roomIds]
      // Assignments that would only start at/after the new start never took effect: remove them.
      const removed = await trx
        .deleteFrom('price_assignments')
        .where('room_id', 'in', roomIds)
        .where('valid_from', '>=', input.validFrom)
        .executeTakeFirst()
      // Assignments running past the new start end there.
      const ended = await trx
        .updateTable('price_assignments')
        .set({ valid_to: input.validFrom })
        .where('room_id', 'in', roomIds)
        .where('valid_from', '<', input.validFrom)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', input.validFrom)]))
        .executeTakeFirst()
      await trx
        .insertInto('price_assignments')
        .values(
          roomIds.map((roomId) => ({
            price_version_id: input.versionId,
            room_id: roomId,
            valid_from: input.validFrom,
          })),
        )
        .execute()
      return {
        ended: Number(ended.numUpdatedRows),
        removed: Number(removed.numDeletedRows),
        created: roomIds.length,
      }
    })
  }

  private roomQuery() {
    return this.db
      .selectFrom('rooms as r')
      .innerJoin('stores as s', 's.id', 'r.store_id')
      .innerJoin('room_types as t', 't.id', 'r.room_type_id')
      .select([
        'r.id',
        'r.store_id',
        's.code as store_code',
        'r.code',
        'r.name',
        'r.room_type_id',
        't.name as room_type_name',
        's.timezone',
      ])
  }

  async rooms(storeIds: readonly number[] | null) {
    let query = this.roomQuery()
    if (storeIds) query = query.where('r.store_id', 'in', storeIds.length ? [...storeIds] : [0])
    const rows = await query.orderBy('s.code').orderBy('r.sort_order').orderBy('r.code').execute()
    return rows.map(toRoom)
  }

  async room(roomId: number) {
    const row = await this.roomQuery().where('r.id', '=', roomId).executeTakeFirst()
    return row ? toRoom(row) : null
  }
}

function toRoom(r: {
  id: number
  store_id: number
  store_code: string
  code: string
  name: string
  room_type_id: number
  room_type_name: string
  timezone: string
}): PriceRoomOption {
  return {
    id: Number(r.id),
    storeId: Number(r.store_id),
    storeCode: r.store_code,
    code: r.code,
    name: r.name,
    roomTypeId: Number(r.room_type_id),
    roomTypeName: r.room_type_name,
    timezone: r.timezone,
  }
}
