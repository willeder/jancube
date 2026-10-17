import { describe, expect, it } from 'vitest'
import type { DueDelivery, NotificationRepository, PublishedTemplate } from '../ports/notifications'
import type { AlertRepository, OutboxEvent, OutboxRepository, SecretBox } from '../ports/ops'
import { makeDispatchNotifications, makeNotify } from './notify'
import { makeProcessOutbox } from './outbox'

/** Fake encryption: ciphertext is an index into a table (the package has no DOM/Node text codecs). */
const sealed: string[] = []
const box: SecretBox = {
  encrypt: async (s) => Uint8Array.of(sealed.push(s) - 1),
  decrypt: async (b) => sealed[b[0] as number] as string,
}

const template = (channel: PublishedTemplate['channel'], priority: number): PublishedTemplate => ({
  templateId: priority,
  versionId: priority * 10,
  channel,
  priority,
  subject: channel === 'email' ? '{{storeName}}のご予約' : null,
  body: '{{storeName}} {{bookingCode}}',
})

function world(
  contact: { email?: string; line?: string; phone?: string; preference?: 'email' | 'line' } = {},
) {
  let now = new Date('2026-11-01T00:00:00Z')
  const queued: (Parameters<NotificationRepository['enqueue']>[0] & {
    id: number
    attempts: number
    status: string
    retryAt: Date | null
  })[] = []
  const alerts: string[] = []
  const notifications: NotificationRepository = {
    templates: async () => [template('line', 1), template('email', 2)],
    memberContact: async () => ({
      memberId: 1,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      lineUserId: contact.line ?? null,
      notificationChannel: contact.preference,
    }),
    enqueue: async (d) => {
      if (queued.some((q) => q.deduplicationKey === d.deduplicationKey)) return
      queued.push({ ...d, id: queued.length + 1, attempts: 0, status: 'queued', retryAt: null })
    },
    claimDue: async (at) =>
      queued
        .filter((q) => q.status === 'queued' && (q.retryAt ?? q.scheduledAt) <= at)
        .map(
          (q): DueDelivery => ({
            id: q.id,
            channel: q.channel,
            destinationCiphertext: q.destinationCiphertext,
            messageCiphertext: q.messageCiphertext,
            attemptCount: q.attempts,
            bookingId: q.bookingId,
            storeId: 1,
          }),
        ),
    recordAttempt: async (id, attempt, next) => {
      const q = queued.find((x) => x.id === id)
      if (!q) return
      q.attempts = attempt.attemptNo
      q.status = next.status
      q.retryAt = next.status === 'queued' ? next.retryAt : null
    },
  }
  const alertRepo: AlertRepository = {
    raise: async (a) => {
      alerts.push(a.alertKey)
    },
    resolve: async () => {},
  }
  const clock = { now: () => now }
  return {
    queued,
    alerts,
    notifications,
    alertRepo,
    clock,
    advance: (minutes: number) => {
      now = new Date(now.getTime() + minutes * 60_000)
    },
  }
}

const request = {
  event: 'booking_confirmed' as const,
  storeId: 1,
  memberId: 1,
  values: { storeName: '本町店', bookingCode: 'JC-2026-000001' },
  deduplicationKey: 'booking_confirmed:1',
}

describe('notify (F-NTF-07)', () => {
  it('honors the selected channel and never falls back from unavailable LINE or to SMS', async () => {
    const email = world({ line: 'U1', email: 'a@example.com', preference: 'email' })
    expect(await makeNotify({ ...email, secrets: box })(request)).toMatchObject({
      channel: 'email',
    })
    const blocked = world({ email: 'a@example.com', phone: '+819012345678', preference: 'line' })
    expect(await makeNotify({ ...blocked, secrets: box })(request)).toEqual({
      status: 'screen_only',
    })
    expect(blocked.queued).toHaveLength(0)
    blocked.notifications.templates = async () => [template('sms', 1)]
    expect(await makeNotify({ ...blocked, secrets: box })(request)).toEqual({
      status: 'screen_only',
    })
    expect(
      await makeNotify({ ...blocked, secrets: box })({
        ...request,
        event: 'payment_link',
        smsTo: '+819012345678',
      }),
    ).toMatchObject({ channel: 'sms' })
  })
  it('uses LINE when linked, email otherwise, and nothing when neither', async () => {
    const line = world({ line: 'U1', email: 'a@example.com' })
    expect(await makeNotify({ ...line, secrets: box })(request)).toEqual({
      status: 'queued',
      channel: 'line',
    })
    const email = world({ email: 'a@example.com' })
    expect(await makeNotify({ ...email, secrets: box })(request)).toMatchObject({
      channel: 'email',
    })
    const none = world({ phone: '+819012345678' })
    expect(await makeNotify({ ...none, secrets: box })(request)).toEqual({ status: 'screen_only' })
  })

  it('stores destination and message encrypted, secrets redacted, once per key', async () => {
    const w = world({ email: 'a@example.com' })
    const notify = makeNotify({ ...w, secrets: box })
    await notify({ ...request, values: { ...request.values }, secretValueNames: ['bookingCode'] })
    await notify(request)
    expect(w.queued).toHaveLength(1)
    expect(await box.decrypt(w.queued[0]?.destinationCiphertext as Uint8Array)).toBe(
      'a@example.com',
    )
    expect(JSON.parse(await box.decrypt(w.queued[0]?.messageCiphertext as Uint8Array))).toEqual({
      subject: '本町店のご予約',
      body: '本町店 JC-2026-000001',
    })
    expect(w.queued[0]?.contextRedacted).toEqual({ storeName: '本町店', bookingCode: '***' })
  })
})

describe('dispatchNotifications', () => {
  it('sends, retries with back-off, then alerts', async () => {
    const w = world({ email: 'a@example.com' })
    await makeNotify({ ...w, secrets: box })(request)
    const sentTo: string[] = []
    let fail = true
    const dispatch = makeDispatchNotifications({
      ...w,
      secrets: box,
      alerts: w.alertRepo,
      email: {
        send: async (m) => {
          if (fail) throw new Error('smtp down')
          sentTo.push(`${m.to}|${m.subject}`)
          return { providerMessageId: 'm1' }
        },
      },
      sms: { send: async () => ({ providerMessageId: 's' }) },
      line: { push: async () => ({ providerMessageId: 'l' }) },
    })
    expect(await dispatch()).toMatchObject({ claimed: 1, failed: 1 })
    expect(await dispatch()).toMatchObject({ claimed: 0 }) // waiting 1 minute
    for (const minutes of [1, 5, 15, 60]) {
      w.advance(minutes)
      await dispatch()
    }
    expect(w.queued[0]?.status).toBe('failed')
    expect(w.alerts).toEqual(['notification_failed:1'])

    const ok = world({ email: 'b@example.com' })
    await makeNotify({ ...ok, secrets: box })(request)
    fail = false
    await makeDispatchNotifications({
      ...ok,
      secrets: box,
      alerts: ok.alertRepo,
      email: {
        send: async (m) => {
          sentTo.push(`${m.to}|${m.subject}`)
          return { providerMessageId: 'm1' }
        },
      },
      sms: { send: async () => ({ providerMessageId: 's' }) },
      line: { push: async () => ({ providerMessageId: 'l' }) },
    })()
    expect(sentTo).toEqual(['b@example.com|本町店のご予約'])
    expect(ok.queued[0]?.status).toBe('sent')
  })
})

describe('processOutbox', () => {
  it('runs handlers, skips unknown events and retries failures', async () => {
    const events: (OutboxEvent & { status: string })[] = [
      {
        id: 1,
        eventType: 'booking.confirmed',
        aggregateType: 'booking',
        aggregateId: 7,
        payload: {},
        attemptCount: 0,
        status: 'pending',
      },
      {
        id: 2,
        eventType: 'something.else',
        aggregateType: 'x',
        aggregateId: 1,
        payload: {},
        attemptCount: 0,
        status: 'pending',
      },
      {
        id: 3,
        eventType: 'booking.canceled',
        aggregateType: 'booking',
        aggregateId: 8,
        payload: {},
        attemptCount: 7,
        status: 'pending',
      },
    ]
    const outbox: OutboxRepository = {
      enqueue: async () => {},
      claim: async () => events.filter((e) => e.status === 'pending'),
      complete: async (id) => {
        const e = events.find((x) => x.id === id)
        if (e) e.status = 'delivered'
      },
      fail: async (id, _err, retryAt) => {
        const e = events.find((x) => x.id === id)
        if (e) e.status = retryAt ? 'pending' : 'failed'
      },
    }
    const alerts: string[] = []
    const handled: number[] = []
    const result = await makeProcessOutbox({
      outbox,
      alerts: { raise: async (a) => void alerts.push(a.alertKey), resolve: async () => {} },
      clock: { now: () => new Date() },
      workerId: 'test',
      handlers: {
        'booking.confirmed': async (e) => void handled.push(e.aggregateId),
        'booking.canceled': async () => {
          throw new Error('lock api down')
        },
      },
    })()
    expect(result).toEqual({ claimed: 3, failed: 1 })
    expect(handled).toEqual([7])
    expect(events.map((e) => e.status)).toEqual(['delivered', 'delivered', 'failed'])
    expect(alerts).toEqual(['outbox_failed:3'])
  })
})
