import type {
  StaffAdminRepository,
  StaffAdminRow,
  StaffStatus,
  TemplateAdminRepository,
  TemplateRow,
} from '@jancube/application'
import type { NotificationChannel, NotificationEvent, RoleCode, RoleGrant } from '@jancube/domain'
import type { Transaction } from 'kysely'
import type { Database } from './create-db'
import type { DB } from './schema.generated'

/** A-21 notification templates and their published versions. */
export class KyselyTemplateAdminRepository implements TemplateAdminRepository {
  constructor(private readonly db: Database) {}

  private query() {
    return this.db
      .selectFrom('notification_templates as t')
      .leftJoin('stores as s', 's.id', 't.store_id')
      .select([
        't.id',
        't.event_type',
        't.channel',
        't.store_id',
        's.code as store_code',
        't.is_enabled',
        't.channel_priority',
      ])
      .select((eb) => [
        eb
          .selectFrom('notification_template_versions as v')
          .select((e) => e.fn.max('v.version_no').as('n'))
          .whereRef('v.template_id', '=', 't.id')
          .as('latest_version_no'),
        eb
          .selectFrom('notification_template_versions as v')
          .select((e) => e.fn.max('v.published_at').as('d'))
          .whereRef('v.template_id', '=', 't.id')
          .as('latest_published_at'),
      ])
  }

  async list() {
    const rows = await this.query()
      .orderBy('t.event_type')
      .orderBy('t.scope_store_key')
      .orderBy('t.channel_priority')
      .execute()
    return rows.map(toTemplate)
  }

  async find(templateId: number) {
    const row = await this.query().where('t.id', '=', templateId).executeTakeFirst()
    if (!row) return null
    const versions = await this.db
      .selectFrom('notification_template_versions as v')
      .innerJoin('staff as s', 's.id', 'v.published_by')
      .select([
        'v.id',
        'v.version_no',
        'v.subject',
        'v.body',
        'v.entry_guide_url',
        'v.published_at',
        's.name as published_by_name',
      ])
      .where('v.template_id', '=', templateId)
      .orderBy('v.version_no', 'desc')
      .limit(30)
      .execute()
    return {
      ...toTemplate(row),
      versions: versions.map((v) => ({
        id: Number(v.id),
        versionNo: v.version_no,
        subject: v.subject,
        body: v.body,
        entryGuideUrl: v.entry_guide_url,
        publishedAt: v.published_at,
        publishedByName: v.published_by_name,
      })),
    }
  }

  async exists(event: NotificationEvent, channel: NotificationChannel, storeId: number | null) {
    const row = await this.db
      .selectFrom('notification_templates')
      .select('id')
      .where('event_type', '=', event)
      .where('channel', '=', channel)
      .where('scope_store_key', '=', storeId ?? 0)
      .executeTakeFirst()
    return !!row
  }

  async create(template: Parameters<TemplateAdminRepository['create']>[0]) {
    const inserted = await this.db
      .insertInto('notification_templates')
      .values({
        event_type: template.event,
        channel: template.channel,
        store_id: template.storeId,
        is_enabled: template.isEnabled ? 1 : 0,
        channel_priority: template.priority,
      })
      .executeTakeFirstOrThrow()
    return Number(inserted.insertId)
  }

  async update(templateId: number, values: { isEnabled: boolean; priority: number }) {
    await this.db
      .updateTable('notification_templates')
      .set({ is_enabled: values.isEnabled ? 1 : 0, channel_priority: values.priority })
      .where('id', '=', templateId)
      .execute()
  }

  publishVersion(
    templateId: number,
    version: Parameters<TemplateAdminRepository['publishVersion']>[1],
    publishedBy: number,
    publishedAt: Date,
  ) {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('notification_templates')
        .select('id')
        .where('id', '=', templateId)
        .forUpdate()
        .execute()
      const last = await trx
        .selectFrom('notification_template_versions')
        .select((eb) => eb.fn.max('version_no').as('n'))
        .where('template_id', '=', templateId)
        .executeTakeFirst()
      const versionNo = Number(last?.n ?? 0) + 1
      await trx
        .insertInto('notification_template_versions')
        .values({
          template_id: templateId,
          version_no: versionNo,
          subject: version.subject,
          body: version.body,
          variables_schema: JSON.stringify(version.variables),
          entry_guide_url: version.entryGuideUrl,
          published_at: publishedAt,
          published_by: publishedBy,
        })
        .execute()
      return versionNo
    })
  }
}

function toTemplate(r: {
  id: number
  event_type: string
  channel: string
  store_id: number | null
  store_code: string | null
  is_enabled: number
  channel_priority: number
  latest_version_no: number | null
  latest_published_at: Date | null
}): TemplateRow {
  return {
    id: Number(r.id),
    event: r.event_type as NotificationEvent,
    channel: r.channel as NotificationChannel,
    storeId: r.store_id === null ? null : Number(r.store_id),
    storeCode: r.store_code,
    isEnabled: r.is_enabled === 1,
    priority: r.channel_priority,
    latestVersionNo: r.latest_version_no === null ? null : Number(r.latest_version_no),
    latestPublishedAt: r.latest_published_at,
  }
}

/** A-23 staff accounts and role grants. */
export class KyselyStaffAdminRepository implements StaffAdminRepository {
  constructor(private readonly db: Database) {}

  private async load(staffId?: number): Promise<StaffAdminRow[]> {
    let query = this.db
      .selectFrom('staff')
      .select(['id', 'email_normalized', 'name', 'status', 'last_login_at', 'password_hash'])
    if (staffId !== undefined) query = query.where('id', '=', staffId)
    const rows = await query.orderBy('id').execute()
    const ids = rows.map((r) => r.id)
    const grants = ids.length
      ? await this.db
          .selectFrom('staff_role_grants as g')
          .innerJoin('roles as r', 'r.id', 'g.role_id')
          .leftJoin('stores as s', 's.id', 'g.store_id')
          .select(['g.staff_id', 'r.code as role', 'g.store_id', 's.code as store_code'])
          .where('g.staff_id', 'in', ids)
          .orderBy('g.id')
          .execute()
      : []
    return rows.map((r) => ({
      id: Number(r.id),
      email: r.email_normalized,
      name: r.name,
      status: r.status as StaffStatus,
      hasPassword: r.password_hash !== null,
      lastLoginAt: r.last_login_at,
      grants: grants
        .filter((g) => g.staff_id === r.id)
        .map((g) => ({
          role: g.role as RoleCode,
          storeId: g.store_id === null ? null : Number(g.store_id),
          storeCode: g.store_code,
        })),
    }))
  }

  list() {
    return this.load()
  }

  async find(staffId: number) {
    const [row] = await this.load(staffId)
    return row ?? null
  }

  async emailTaken(email: string) {
    const row = await this.db
      .selectFrom('staff')
      .select('id')
      .where('email_normalized', '=', email)
      .executeTakeFirst()
    return !!row
  }

  create(staff: Parameters<StaffAdminRepository['create']>[0]) {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('staff')
        .values({ email_normalized: staff.email, name: staff.name, status: 'invited' })
        .executeTakeFirstOrThrow()
      const staffId = Number(inserted.insertId)
      await insertGrants(trx, staffId, staff.grants, staff.grantedBy)
      return staffId
    })
  }

  async updateName(staffId: number, name: string) {
    await this.db.updateTable('staff').set({ name }).where('id', '=', staffId).execute()
  }

  async replaceGrants(staffId: number, grants: readonly RoleGrant[], grantedBy: number) {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('staff_role_grants').where('staff_id', '=', staffId).execute()
      await insertGrants(trx, staffId, grants, grantedBy)
    })
  }

  async setStatus(staffId: number, status: StaffStatus) {
    await this.db.updateTable('staff').set({ status }).where('id', '=', staffId).execute()
  }

  async activeOwnerIds() {
    const rows = await this.db
      .selectFrom('staff as s')
      .innerJoin('staff_role_grants as g', 'g.staff_id', 's.id')
      .innerJoin('roles as r', 'r.id', 'g.role_id')
      .select('s.id')
      .distinct()
      .where('s.status', '=', 'active')
      .where('r.code', '=', 'owner')
      .execute()
    return rows.map((r) => Number(r.id))
  }
}

async function insertGrants(
  trx: Transaction<DB>,
  staffId: number,
  grants: readonly RoleGrant[],
  grantedBy: number,
) {
  if (grants.length === 0) return
  const roles = await trx
    .selectFrom('roles')
    .select(['id', 'code'])
    .where(
      'code',
      'in',
      grants.map((g) => g.role),
    )
    .execute()
  await trx
    .insertInto('staff_role_grants')
    .values(
      grants.map((g) => {
        const role = roles.find((r) => r.code === g.role)
        if (!role) throw new Error(`role ${g.role} is not seeded`)
        return { staff_id: staffId, role_id: role.id, store_id: g.storeId, granted_by: grantedBy }
      }),
    )
    .execute()
}
