import {
  type AuditLogEntry,
  type AuditLogFilter,
  type AuditLogQuery,
  REPORT_TIME_ZONE,
} from '@jancube/application'
import { addDays, localToUtc } from '@jancube/domain'
import { sql } from 'kysely'
import type { Database } from './create-db'

/** VARBINARY(16) → "203.0.113.24" / "2001:db8:0:0:0:0:0:1". */
export function ipText(bytes: Buffer | Uint8Array | null): string | null {
  if (!bytes) return null
  const b = Buffer.from(bytes)
  if (b.length === 4) return [...b].join('.')
  if (b.length === 16) {
    const groups: string[] = []
    for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i).toString(16))
    return groups.join(':')
  }
  return null
}

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** LIKE pattern for a user-typed fragment (wildcards in the input are literal). */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

const PAGE = 500

/** A-24 監査ログ search over audit_logs (newest first). */
export class KyselyAuditLogQuery implements AuditLogQuery {
  constructor(private readonly db: Database) {}

  async search(
    filter: AuditLogFilter,
    page: { limit: number; beforeId?: number | null },
  ): Promise<AuditLogEntry[]> {
    if (filter.storeIds?.length === 0) return []
    const start = localToUtc(filter.from, 0, REPORT_TIME_ZONE)
    const end = localToUtc(addDays(filter.to, 1), 0, REPORT_TIME_ZONE)
    let q = this.db
      .selectFrom('audit_logs as a')
      .leftJoin('staff as st', 'st.id', 'a.staff_id')
      .leftJoin('members as m', 'm.id', 'a.member_id')
      .leftJoin('stores as s', 's.id', 'a.store_id')
      .select([
        'a.id',
        'a.occurred_at',
        'a.actor_type',
        'a.staff_id',
        'st.name as staff_name',
        'm.member_code',
        's.code as store_code',
        'a.action',
        'a.target_type',
        'a.target_id',
        'a.target_code',
        'a.before_values',
        'a.after_values',
        'a.reason',
        'a.ip_address',
        'a.request_id',
      ])
      .where('a.occurred_at', '>=', start)
      .where('a.occurred_at', '<', end)
      .orderBy('a.id', 'desc')
      .limit(page.limit)
    if (page.beforeId) q = q.where('a.id', '<', page.beforeId)
    if (filter.storeIds) q = q.where('a.store_id', 'in', [...filter.storeIds])
    if (filter.action) q = q.where('a.action', '=', filter.action)
    if (filter.actor) {
      const actor = filter.actor
      if (/^(system|システム)$/i.test(actor)) {
        q = q.where('a.actor_type', '=', 'system')
      } else {
        const like = contains(actor)
        q = q.where((eb) =>
          eb.or([
            eb('st.name', 'like', like),
            eb('st.email_normalized', 'like', like),
            eb('m.member_code', 'like', like),
          ]),
        )
      }
    }
    if (filter.target) {
      const target = filter.target
      q = q.where((eb) =>
        eb.or([
          eb('a.target_code', 'like', contains(target)),
          eb('a.target_type', '=', target),
          ...(/^\d+$/.test(target) ? [eb('a.target_id', '=', Number(target))] : []),
        ]),
      )
    }
    const rows = await q.execute()
    const roles = await this.roles(rows.flatMap((r) => (r.staff_id ? [Number(r.staff_id)] : [])))
    return rows.map((r) => ({
      id: Number(r.id),
      occurredAt: r.occurred_at,
      actorType: r.actor_type as AuditLogEntry['actorType'],
      actorLabel: r.staff_name ?? r.member_code ?? null,
      actorRoles: r.staff_id ? (roles.get(Number(r.staff_id)) ?? []) : [],
      storeCode: r.store_code,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id === null ? null : Number(r.target_id),
      targetCode: r.target_code,
      before: parseJson(r.before_values),
      after: parseJson(r.after_values),
      reason: r.reason,
      ip: ipText(r.ip_address),
      requestId: r.request_id,
    }))
  }

  async *stream(filter: AuditLogFilter): AsyncIterable<AuditLogEntry> {
    let beforeId: number | null = null
    for (;;) {
      const rows = await this.search(filter, { limit: PAGE, beforeId })
      yield* rows
      if (rows.length < PAGE) return
      beforeId = rows.at(-1)?.id ?? null
    }
  }

  async actions(): Promise<string[]> {
    const rows = await sql<{ action: string }>`
      SELECT DISTINCT action FROM audit_logs ORDER BY action`.execute(this.db)
    return rows.rows.map((r) => r.action)
  }

  /** Role names per staff member, with the store code for store-scoped grants. */
  private async roles(staffIds: number[]): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>()
    if (staffIds.length === 0) return result
    const rows = await this.db
      .selectFrom('staff_role_grants as g')
      .innerJoin('roles as r', 'r.id', 'g.role_id')
      .leftJoin('stores as s', 's.id', 'g.store_id')
      .select(['g.staff_id', 'r.name', 's.code'])
      .where('g.staff_id', 'in', [...new Set(staffIds)])
      .execute()
    for (const row of rows) {
      const list = result.get(Number(row.staff_id)) ?? []
      list.push(row.code ? `${row.name}(${row.code})` : row.name)
      result.set(Number(row.staff_id), list)
    }
    return result
  }
}
