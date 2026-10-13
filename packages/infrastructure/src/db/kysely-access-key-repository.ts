import type {
  AccessKeyRecord,
  AccessKeyRepository,
  KeyEvent,
  LockDevice,
  LockDeviceInput,
  LockDeviceRepository,
} from '@jancube/application'
import type { AccessKeyStatus } from '@jancube/domain'
import { sql } from 'kysely'
import type { Database } from './create-db'

function keyQuery(db: Database) {
  return db
    .selectFrom('access_keys as k')
    .selectAll('k')
    .select((eb) => [
      // Attempts of the current phase: issue attempts while pending, revoke attempts afterwards.
      eb
        .selectFrom('key_events as e')
        .select((e) => e.fn.countAll<number>().as('n'))
        .whereRef('e.access_key_id', '=', 'k.id')
        .where(
          'e.event_type',
          '=',
          sql<string>`CASE WHEN k.status = 'revoke_pending' THEN 'revoke' ELSE 'issue' END`,
        )
        .as('attempts'),
      eb
        .selectFrom('key_events as e')
        .select((e) => e.fn.max('e.occurred_at').as('at'))
        .whereRef('e.access_key_id', '=', 'k.id')
        .where('e.event_type', 'in', ['issue', 'revoke'])
        .as('last_attempt_at'),
    ])
}

type KeyRow = Awaited<ReturnType<ReturnType<typeof keyQuery>['execute']>>[number]

const toKey = (row: KeyRow): AccessKeyRecord => ({
  id: Number(row.id),
  bookingId: Number(row.booking_id),
  storeId: Number(row.store_id),
  lockDeviceId: Number(row.lock_device_id),
  providerKeyId: row.provider_key_id,
  codeCiphertext: row.code_ciphertext ? new Uint8Array(row.code_ciphertext) : null,
  validFrom: row.valid_from,
  validTo: row.valid_to,
  status: row.status as AccessKeyStatus,
  idempotencyKey: row.idempotency_key,
  issuedAt: row.issued_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
  attempts: Number(row.attempts ?? 0),
  lastAttemptAt: row.last_attempt_at
    ? new Date(row.last_attempt_at as unknown as string | Date)
    : null,
})

/** access_keys and key_events (F-KEY-01〜07, A-09). Codes are stored encrypted only. */
export class KyselyAccessKeyRepository implements AccessKeyRepository {
  constructor(private readonly db: Database) {}

  async keysForBookings(bookingIds: readonly number[]) {
    if (bookingIds.length === 0) return []
    const rows = await keyQuery(this.db)
      .where('k.booking_id', 'in', [...bookingIds])
      .orderBy('k.id', 'desc')
      .execute()
    return rows.map(toKey)
  }

  async key(id: number) {
    const row = await keyQuery(this.db).where('k.id', '=', id).executeTakeFirst()
    return row ? toKey(row) : null
  }

  async createKey(input: Parameters<AccessKeyRepository['createKey']>[0]) {
    await this.db
      .insertInto('access_keys')
      .ignore()
      .values({
        booking_id: input.bookingId,
        store_id: input.storeId,
        lock_device_id: input.lockDeviceId,
        valid_from: input.validFrom,
        valid_to: input.validTo,
        status: 'pending',
        idempotency_key: input.idempotencyKey,
      })
      .execute()
    const row = await this.db
      .selectFrom('access_keys')
      .select('id')
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst()
    if (!row) throw new Error('the booking already has a live access key')
    return Number(row.id)
  }

  async markIssued(id: number, input: Parameters<AccessKeyRepository['markIssued']>[1]) {
    await this.db
      .updateTable('access_keys')
      .set({
        provider_key_id: input.providerKeyId,
        code_ciphertext: Buffer.from(input.codeCiphertext),
        encryption_key_version: input.keyVersion,
        status: 'issued',
        issued_at: input.at,
      })
      .where('id', '=', id)
      .execute()
  }

  async setStatus(id: number, status: AccessKeyStatus, at: Date) {
    await this.db
      .updateTable('access_keys')
      .set(status === 'revoked' ? { status, revoked_at: at } : { status })
      .where('id', '=', id)
      .execute()
  }

  async recordEvent(event: Parameters<AccessKeyRepository['recordEvent']>[0]) {
    await this.db
      .insertInto('key_events')
      .values({
        access_key_id: event.accessKeyId,
        lock_device_id: event.lockDeviceId,
        booking_id: event.bookingId,
        event_type: event.eventType,
        result: event.result,
        request_key: event.requestKey,
        attempt_no: event.attemptNo,
        occurred_at: event.at,
        error_code: event.errorCode ?? null,
        redacted_details: event.details ? JSON.stringify(event.details) : null,
        staff_id: event.staffId ?? null,
      })
      .execute()
  }

  async events(bookingId: number): Promise<KeyEvent[]> {
    const rows = await this.db
      .selectFrom('key_events as e')
      .leftJoin('staff as s', 's.id', 'e.staff_id')
      .select([
        'e.id',
        'e.access_key_id',
        'e.lock_device_id',
        'e.booking_id',
        'e.event_type',
        'e.result',
        'e.attempt_no',
        'e.occurred_at',
        'e.error_code',
        'e.redacted_details',
        's.name as staff_name',
      ])
      .where('e.booking_id', '=', bookingId)
      .orderBy('e.occurred_at')
      .orderBy('e.id')
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      accessKeyId: r.access_key_id === null ? null : Number(r.access_key_id),
      lockDeviceId: Number(r.lock_device_id),
      bookingId: r.booking_id === null ? null : Number(r.booking_id),
      eventType: r.event_type,
      result: r.result as KeyEvent['result'],
      attemptNo: r.attempt_no,
      occurredAt: r.occurred_at,
      errorCode: r.error_code,
      details: (typeof r.redacted_details === 'string'
        ? JSON.parse(r.redacted_details)
        : r.redacted_details) as KeyEvent['details'],
      staffName: r.staff_name,
    }))
  }

  async pendingWork(limit: number) {
    const rows = await keyQuery(this.db)
      .where('k.status', 'in', ['pending', 'revoke_pending'])
      .orderBy('k.updated_at')
      .limit(limit)
      .execute()
    return rows.map(toKey)
  }

  async expireKeys(now: Date) {
    const result = await this.db
      .updateTable('access_keys')
      .set({ status: 'expired' })
      .where('status', 'in', ['issued', 'active'])
      .where('valid_to', '<', now)
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  }
}

function deviceQuery(db: Database) {
  return db
    .selectFrom('lock_devices as d')
    .innerJoin('stores as s', 's.id', 'd.store_id')
    .selectAll('d')
    .select('s.code as store_code')
}

type DeviceRow = Awaited<ReturnType<ReturnType<typeof deviceQuery>['execute']>>[number]

const toDevice = (row: DeviceRow): LockDevice => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  storeCode: row.store_code,
  name: row.name,
  provider: row.provider,
  providerAccountId: row.provider_account_id,
  externalDeviceId: row.external_device_id,
  secretReference: row.secret_reference,
  batteryPercent: row.battery_percent,
  communicationStatus: row.communication_status as LockDevice['communicationStatus'],
  lastResponseAt: row.last_response_at,
  isActive: row.is_active === 1,
})

/** lock_devices (A-20). */
export class KyselyLockDeviceRepository implements LockDeviceRepository {
  constructor(private readonly db: Database) {}

  async list(storeIds: readonly number[] | null) {
    if (storeIds && storeIds.length === 0) return []
    let query = deviceQuery(this.db).orderBy('s.code').orderBy('d.name')
    if (storeIds) query = query.where('d.store_id', 'in', [...storeIds])
    return (await query.execute()).map(toDevice)
  }

  async find(id: number) {
    const row = await deviceQuery(this.db).where('d.id', '=', id).executeTakeFirst()
    return row ? toDevice(row) : null
  }

  async activeForStore(storeId: number) {
    const row = await deviceQuery(this.db)
      .where('d.store_id', '=', storeId)
      .where('d.is_active', '=', 1)
      .orderBy('d.id')
      .limit(1)
      .executeTakeFirst()
    return row ? toDevice(row) : null
  }

  private values(input: LockDeviceInput) {
    return {
      store_id: input.storeId,
      name: input.name,
      provider: input.provider,
      provider_account_id: input.providerAccountId,
      external_device_id: input.externalDeviceId,
      secret_reference: input.secretReference,
      is_active: input.isActive ? 1 : 0,
    }
  }

  async create(input: LockDeviceInput) {
    const result = await this.db
      .insertInto('lock_devices')
      .values(this.values(input))
      .executeTakeFirstOrThrow()
    return Number(result.insertId)
  }

  async update(id: number, input: LockDeviceInput) {
    await this.db.updateTable('lock_devices').set(this.values(input)).where('id', '=', id).execute()
  }

  async recordStatus(id: number, status: Parameters<LockDeviceRepository['recordStatus']>[1]) {
    await this.db
      .updateTable('lock_devices')
      .set({
        communication_status: status.communication,
        // Providers that do not report the battery keep the last known value.
        ...(status.batteryPercent === null ? {} : { battery_percent: status.batteryPercent }),
        ...(status.communication === 'online' ? { last_response_at: status.at } : {}),
      })
      .where('id', '=', id)
      .execute()
  }
}
