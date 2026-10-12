import type {
  AlertRepository,
  AuditLog,
  BatchRunRepository,
  OutboxEvent,
  OutboxRepository,
} from '@jancube/application'
import type { Database } from './create-db'

const dateValue = (date: string) => new Date(`${date}T00:00:00Z`)

/** IPv4 → 4 bytes, IPv6 → 16 bytes, anything else → null. */
function ipBytes(ip: string | null | undefined): Buffer | null {
  if (!ip) return null
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) return Buffer.from(v4.slice(1).map(Number))
  if (!ip.includes(':')) return null
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h
  if (groups.length !== 8) return null
  return Buffer.from(groups.flatMap((g) => [(parseInt(g, 16) >> 8) & 255, parseInt(g, 16) & 255]))
}

export class KyselyAuditLog implements AuditLog {
  constructor(private readonly db: Database) {}

  async record(entry: Parameters<AuditLog['record']>[0]) {
    await this.db
      .insertInto('audit_logs')
      .values({
        actor_type: entry.actor.type,
        staff_id: entry.actor.type === 'staff' ? entry.actor.staffId : null,
        member_id: entry.actor.type === 'member' ? entry.actor.memberId : null,
        store_id: entry.storeId ?? null,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId ?? null,
        target_code: entry.targetCode ?? null,
        before_values: entry.before === undefined ? null : JSON.stringify(entry.before),
        after_values: entry.after === undefined ? null : JSON.stringify(entry.after),
        reason: entry.reason ?? null,
        ip_address: ipBytes(entry.ip),
        request_id: entry.requestId ?? crypto.randomUUID(),
        occurred_at: new Date(),
      })
      .execute()
  }
}

export class KyselyAlertRepository implements AlertRepository {
  constructor(private readonly db: Database) {}

  async raise(alert: Parameters<AlertRepository['raise']>[0]) {
    await this.db
      .insertInto('alerts')
      .ignore()
      .values({
        alert_key: alert.alertKey,
        alert_type: alert.alertType,
        severity: alert.severity,
        status: 'open',
        failure_reason: alert.failureReason,
        recovery_steps: alert.recoverySteps,
        store_id: alert.storeId ?? null,
        booking_id: alert.bookingId ?? null,
        payment_id: alert.paymentId ?? null,
        lock_device_id: alert.lockDeviceId ?? null,
        delivery_id: alert.deliveryId ?? null,
        detected_at: alert.detectedAt,
      })
      .execute()
  }

  async resolve(alertKey: string, at: Date) {
    await this.db
      .updateTable('alerts')
      .set({ status: 'resolved', resolved_at: at })
      .where('alert_key', '=', alertKey)
      .where('status', '<>', 'resolved')
      .execute()
  }
}

export class KyselyBatchRunRepository implements BatchRunRepository {
  constructor(private readonly db: Database) {}

  async start(run: Parameters<BatchRunRepository['start']>[0]) {
    const inserted = await this.db
      .insertInto('batch_runs')
      .ignore()
      .values({
        job_type: run.jobType,
        business_date: dateValue(run.businessDate),
        store_id: run.storeId,
        run_key: run.runKey,
        status: 'running',
        started_at: run.startedAt,
        triggered_by: run.triggeredBy ?? null,
      })
      .executeTakeFirst()
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0n) === 0) return null
    return Number(inserted.insertId)
  }

  async finish(id: number, result: Parameters<BatchRunRepository['finish']>[1]) {
    await this.db
      .updateTable('batch_runs')
      .set({
        status: result.status,
        processed_count: result.processed,
        failed_count: result.failed,
        error_summary: result.errorSummary ?? null,
        finished_at: result.finishedAt,
      })
      .where('id', '=', id)
      .execute()
  }
}

/** A lease older than this is considered abandoned (worker crashed) and can be claimed again. */
const LEASE_MINUTES = 5

export class KyselyOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Database) {}

  async enqueue(event: Parameters<OutboxRepository['enqueue']>[0]) {
    await this.db
      .insertInto('outbox_events')
      .ignore()
      .values({
        event_key: event.eventKey,
        event_type: event.eventType,
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        payload: JSON.stringify(event.payload),
        status: 'pending',
        available_at: event.availableAt,
      })
      .execute()
  }

  async claim(workerId: string, now: Date, limit: number): Promise<OutboxEvent[]> {
    const stale = new Date(now.getTime() - LEASE_MINUTES * 60_000)
    const candidates = await this.db
      .selectFrom('outbox_events')
      .select('id')
      .where((eb) =>
        eb.or([
          eb.and([eb('status', '=', 'pending'), eb('available_at', '<=', now)]),
          eb.and([eb('status', '=', 'processing'), eb('locked_at', '<', stale)]),
        ]),
      )
      .orderBy('available_at')
      .limit(limit)
      .execute()
    const claimed: OutboxEvent[] = []
    for (const { id } of candidates) {
      // Conditional update = optimistic lease; works the same on MySQL and TiDB.
      const result = await this.db
        .updateTable('outbox_events')
        .set({ status: 'processing', locked_at: now, locked_by: workerId })
        .where('id', '=', id)
        .where((eb) =>
          eb.or([
            eb('status', '=', 'pending'),
            eb.and([eb('status', '=', 'processing'), eb('locked_at', '<', stale)]),
          ]),
        )
        .executeTakeFirst()
      if (Number(result.numUpdatedRows) !== 1) continue
      const row = await this.db
        .selectFrom('outbox_events')
        .select(['id', 'event_type', 'aggregate_type', 'aggregate_id', 'payload', 'attempt_count'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
      claimed.push({
        id: Number(row.id),
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: Number(row.aggregate_id),
        payload: (typeof row.payload === 'string'
          ? JSON.parse(row.payload)
          : row.payload) as Record<string, unknown>,
        attemptCount: row.attempt_count,
      })
    }
    return claimed
  }

  async complete(id: number, at: Date) {
    await this.db
      .updateTable('outbox_events')
      .set({ status: 'delivered', delivered_at: at, locked_at: null, locked_by: null })
      .where('id', '=', id)
      .execute()
  }

  async fail(id: number, error: string, retryAt: Date | null) {
    await this.db
      .updateTable('outbox_events')
      .set((eb) => ({
        status: retryAt ? 'pending' : 'failed',
        available_at: retryAt ?? eb.ref('available_at'),
        attempt_count: eb('attempt_count', '+', 1),
        last_error: error,
        locked_at: null,
        locked_by: null,
      }))
      .where('id', '=', id)
      .execute()
  }
}
