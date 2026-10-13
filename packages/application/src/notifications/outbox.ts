import type { Clock } from '../ports/clock'
import type { AlertRepository, OutboxEvent, OutboxRepository } from '../ports/ops'

/** Handles one business event type (e.g. 'booking.confirmed'). Must be idempotent. */
export type OutboxHandler = (event: OutboxEvent) => Promise<void>

const MAX_ATTEMPTS = 8
const backoffMinutes = (attempt: number) => Math.min(60, 2 ** attempt)

/**
 * Jobs worker (every minute): deliver business events to their handlers. Unknown event types are
 * completed without action so new producers do not block the queue.
 */
export function makeProcessOutbox(deps: {
  readonly outbox: OutboxRepository
  readonly alerts: AlertRepository
  readonly clock: Clock
  readonly handlers: Readonly<Record<string, OutboxHandler>>
  readonly workerId: string
}) {
  return async function processOutbox(limit = 50) {
    const now = deps.clock.now()
    const events = await deps.outbox.claim(deps.workerId, now, limit)
    let failed = 0
    for (const event of events) {
      const handler = deps.handlers[event.eventType]
      try {
        if (handler) await handler(event)
        await deps.outbox.complete(event.id, deps.clock.now())
      } catch (error) {
        failed++
        const message = error instanceof Error ? error.message : String(error)
        const attempt = event.attemptCount + 1
        const giveUp = attempt >= MAX_ATTEMPTS
        await deps.outbox.fail(
          event.id,
          message.slice(0, 2000),
          giveUp ? null : new Date(now.getTime() + backoffMinutes(attempt) * 60_000),
        )
        if (giveUp) {
          await deps.alerts.raise({
            alertKey: `outbox_failed:${event.id}`,
            alertType: 'job_failed',
            severity: 'critical',
            failureReason:
              `${event.eventType} for ${event.aggregateType} ${event.aggregateId}: ${message}`.slice(
                0,
                2000,
              ),
            recoverySteps: '原因を確認して解消後、アラート一覧から再実行してください。',
            bookingId: event.aggregateType === 'booking' ? event.aggregateId : null,
            detectedAt: now,
          })
        }
      }
    }
    return { claimed: events.length, failed }
  }
}
