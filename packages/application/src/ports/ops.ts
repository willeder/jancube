import type { LocalDate } from '@jancube/domain'

/** Who performed an action (audit_logs.actor_type). */
export type Actor =
  | { readonly type: 'system' }
  | { readonly type: 'staff'; readonly staffId: number }
  | { readonly type: 'member'; readonly memberId: number }

export const SYSTEM: Actor = { type: 'system' }

/** A-24 操作監査ログ. Secrets must be removed from before/after values by the caller. */
export interface AuditLog {
  record(entry: {
    readonly actor: Actor
    readonly action: string
    readonly targetType: string
    readonly targetId?: number | null
    readonly targetCode?: string | null
    readonly storeId?: number | null
    readonly before?: unknown
    readonly after?: unknown
    readonly reason?: string | null
    readonly requestId?: string
    readonly ip?: string | null
  }): Promise<void>
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

/** A-25 アラート. `alertKey` makes raising idempotent (same problem → same alert). */
export interface AlertRepository {
  raise(alert: {
    readonly alertKey: string
    readonly alertType: string
    readonly severity: AlertSeverity
    readonly failureReason: string
    readonly recoverySteps: string
    readonly storeId?: number | null
    readonly bookingId?: number | null
    readonly paymentId?: number | null
    readonly lockDeviceId?: number | null
    readonly deliveryId?: number | null
    readonly detectedAt: Date
  }): Promise<void>
  resolve(alertKey: string, at: Date): Promise<void>
}

/** batch_runs: each scheduled job run is recorded once per run key. */
export interface BatchRunRepository {
  /** null when this run key already ran (or is running). */
  start(run: {
    readonly jobType: string
    readonly businessDate: LocalDate
    readonly storeId: number | null
    readonly runKey: string
    readonly startedAt: Date
    readonly triggeredBy?: number | null
  }): Promise<number | null>
  finish(
    id: number,
    result: {
      readonly status: 'completed' | 'failed'
      readonly processed: number
      readonly failed: number
      readonly errorSummary?: string | null
      readonly finishedAt: Date
    },
  ): Promise<void>
}

/** Symmetric encryption for stored secrets (entry codes, notification destinations). */
export interface SecretBox {
  encrypt(plaintext: string): Promise<Uint8Array>
  decrypt(ciphertext: Uint8Array): Promise<string>
}

// ---------------------------------------------------------------- outbox

export interface OutboxEvent {
  readonly id: number
  readonly eventType: string
  readonly aggregateType: string
  readonly aggregateId: number
  readonly payload: Readonly<Record<string, unknown>>
  readonly attemptCount: number
}

export interface OutboxRepository {
  enqueue(event: {
    readonly eventKey: string
    readonly eventType: string
    readonly aggregateType: string
    readonly aggregateId: number
    readonly payload: Readonly<Record<string, unknown>>
    readonly availableAt: Date
  }): Promise<void>
  /** Leases up to `limit` due events to this worker. */
  claim(workerId: string, now: Date, limit: number): Promise<OutboxEvent[]>
  complete(id: number, at: Date): Promise<void>
  fail(id: number, error: string, retryAt: Date | null): Promise<void>
}
