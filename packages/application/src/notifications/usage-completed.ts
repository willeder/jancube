import { addMinutes, type NotificationEvent } from '@jancube/domain'
import type { Clock } from '../ports/clock'
import type { OutboxEvent, OutboxRepository } from '../ports/ops'

interface Booking {
  end: Date
  status: string
}
/** Delayed outbox events survive Worker restarts; changed/canceled bookings invalidate old events. */
export function makeUsageCompletedNotice(deps: {
  booking: (id: number) => Promise<Booking | null>
  outbox: OutboxRepository
  clock: Clock
  notify: (id: number, event: NotificationEvent, extra: { dedupSuffix: string }) => Promise<unknown>
}) {
  return {
    schedule: async (bookingId: number) => {
      const booking = await deps.booking(bookingId)
      if (!booking || booking.status !== 'confirmed') return
      await deps.outbox.enqueue({
        eventKey: `usage_completed:${bookingId}:${booking.end.toISOString()}`,
        eventType: 'booking.usage_completed',
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: { end: booking.end.toISOString() },
        availableAt: addMinutes(booking.end, 15),
      })
    },
    handle: async (event: OutboxEvent) => {
      const booking = await deps.booking(event.aggregateId)
      if (
        !booking ||
        !['confirmed', 'completed'].includes(booking.status) ||
        event.payload.end !== booking.end.toISOString()
      )
        return
      if (deps.clock.now() < addMinutes(booking.end, 15))
        throw new Error('completion notice is not due')
      // Notification only. This path never invokes a payment gateway or charges a customer.
      await deps.notify(event.aggregateId, 'usage_completed', {
        dedupSuffix: booking.end.toISOString(),
      })
    },
  }
}
