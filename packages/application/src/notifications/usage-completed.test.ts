import { describe, expect, it, vi } from 'vitest'
import type { OutboxEvent, OutboxRepository } from '../ports/ops'
import { makeUsageCompletedNotice } from './usage-completed'

describe('end+15-minute completion notice', () => {
  function world() {
    const end = new Date('2026-10-25T07:00:00Z')
    const booking = { end, status: 'confirmed' }
    let now = new Date('2026-10-25T07:14:59Z')
    const events = new Map<string, Parameters<OutboxRepository['enqueue']>[0]>()
    const notify = vi.fn(async () => undefined)
    const notice = makeUsageCompletedNotice({
      booking: async () => booking,
      clock: { now: () => now },
      outbox: {
        enqueue: async (event) => {
          events.set(event.eventKey, event)
        },
      } as OutboxRepository,
      notify,
    })
    const event: OutboxEvent = {
      id: 1,
      eventType: 'booking.usage_completed',
      aggregateType: 'booking',
      aggregateId: 1,
      payload: { end: end.toISOString() },
      attemptCount: 0,
    }
    return {
      notice,
      booking,
      events,
      notify,
      event,
      due: () => {
        now = new Date('2026-10-25T07:15:00Z')
      },
    }
  }

  it('persists one delayed event per booking end and refuses early delivery', async () => {
    const w = world()
    await w.notice.schedule(1)
    await w.notice.schedule(1)
    expect([...w.events.values()]).toMatchObject([
      { availableAt: new Date('2026-10-25T07:15:00Z') },
    ])
    await expect(w.notice.handle(w.event)).rejects.toThrow('not due')
    expect(w.notify).not.toHaveBeenCalled()
    w.due()
    await w.notice.handle(w.event)
    expect(w.notify).toHaveBeenCalledWith(1, 'usage_completed', {
      dedupSuffix: w.booking.end.toISOString(),
    })
  })

  it('invalidates canceled and rescheduled bookings without sending', async () => {
    const w = world()
    w.due()
    w.booking.status = 'canceled'
    await w.notice.handle(w.event)
    await w.notice.schedule(1)
    expect(w.events.size).toBe(0)
    w.booking.status = 'confirmed'
    w.booking.end = new Date('2026-10-26T07:00:00Z')
    await w.notice.handle(w.event)
    expect(w.notify).not.toHaveBeenCalled()
  })
})
