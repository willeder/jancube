import type { StaffRecord, StaffRepository, StaffStatus } from '@jancube/application'
import type { RoleCode } from '@jancube/domain'
import type { Database } from './create-db'

export class KyselyStaffRepository implements StaffRepository {
  constructor(private readonly db: Database) {}

  findByEmail(email: string) {
    return this.load('email_normalized', email)
  }

  findById(id: number) {
    return this.load('id', id)
  }

  async recordLogin(id: number, at: Date) {
    await this.db.updateTable('staff').set({ last_login_at: at }).where('id', '=', id).execute()
  }

  async setPassword(id: number, passwordHash: string, activate: boolean) {
    await this.db
      .updateTable('staff')
      .set(
        activate
          ? { password_hash: passwordHash, status: 'active' }
          : { password_hash: passwordHash },
      )
      .where('id', '=', id)
      .where('status', '<>', 'disabled')
      .execute()
  }

  async createToken(token: Parameters<StaffRepository['createToken']>[0]) {
    await this.db
      .insertInto('staff_auth_tokens')
      .values({
        staff_id: token.staffId,
        purpose: token.purpose,
        token_hash: Buffer.from(token.tokenHash, 'hex'),
        expires_at: token.expiresAt,
      })
      .execute()
  }

  async consumeToken(tokenHash: string, purpose: 'invite' | 'password_reset', now: Date) {
    const hash = Buffer.from(tokenHash, 'hex')
    const result = await this.db
      .updateTable('staff_auth_tokens')
      .set({ used_at: now })
      .where('token_hash', '=', hash)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) return null
    const row = await this.db
      .selectFrom('staff_auth_tokens')
      .select('staff_id')
      .where('token_hash', '=', hash)
      .executeTakeFirstOrThrow()
    return Number(row.staff_id)
  }

  private async load(column: 'id' | 'email_normalized', value: number | string) {
    const staff = await this.db
      .selectFrom('staff')
      .select(['id', 'email_normalized', 'name', 'status', 'password_hash'])
      .where(column, '=', value as never)
      .executeTakeFirst()
    if (!staff) return null
    const grants = await this.db
      .selectFrom('staff_role_grants as g')
      .innerJoin('roles as r', 'r.id', 'g.role_id')
      .select(['r.code', 'g.store_id'])
      .where('g.staff_id', '=', staff.id)
      .execute()
    return {
      id: Number(staff.id),
      email: staff.email_normalized,
      name: staff.name,
      status: staff.status as StaffStatus,
      passwordHash: staff.password_hash,
      grants: grants.map((g) => ({
        role: g.code as RoleCode,
        storeId: g.store_id === null ? null : Number(g.store_id),
      })),
    } satisfies StaffRecord
  }
}
