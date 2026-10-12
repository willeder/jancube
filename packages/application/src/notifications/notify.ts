import {
  chooseChannel,
  NOTIFICATION_RETRY_MINUTES,
  type NotificationChannel,
  type NotificationEvent,
  renderTemplate,
} from '@jancube/domain'
import type { Clock } from '../ports/clock'
import type { EmailSender, SmsSender } from '../ports/messaging'
import type { LineSender, NotificationRepository } from '../ports/notifications'
import type { AlertRepository, SecretBox } from '../ports/ops'

export interface NotifyDeps {
  readonly notifications: NotificationRepository
  readonly secrets: SecretBox
  readonly clock: Clock
}

export interface NotifyRequest {
  readonly event: NotificationEvent
  readonly storeId: number | null
  /** Member to notify; their contact points decide the channel (F-NTF-07). */
  readonly memberId: number | null
  /** Explicit SMS destination (e.g. payment link to a phone number of a non-member). */
  readonly smsTo?: string | null
  readonly values: Readonly<Record<string, string>>
  /** Values that must not be stored in clear text in the delivery context (e.g. entry codes). */
  readonly secretValueNames?: readonly string[]
  readonly deduplicationKey: string
  readonly bookingId?: number | null
  readonly couponGrantId?: number | null
  readonly paymentLinkId?: number | null
  readonly scheduledAt?: Date
}

export type NotifyResult =
  | { readonly status: 'queued'; readonly channel: NotificationChannel }
  /** No reachable channel: the information is shown on screen only (F-NTF-07). */
  | { readonly status: 'screen_only' }

/** Chooses the channel, renders the published template and queues the delivery. */
export function makeNotify(deps: NotifyDeps) {
  return async function notify(request: NotifyRequest): Promise<NotifyResult> {
    const templates = await deps.notifications.templates(request.event, request.storeId)
    if (templates.length === 0) return { status: 'screen_only' }
    const contact = request.memberId
      ? await deps.notifications.memberContact(request.memberId)
      : null
    const smsTo = request.smsTo ?? contact?.phone ?? null
    const destinations: Record<NotificationChannel, string | null> = {
      line: contact?.lineUserId ?? null,
      email: contact?.email ?? null,
      sms: smsTo,
    }
    const channel = chooseChannel(
      templates.map((t) => t.channel),
      { line: !!destinations.line, email: !!destinations.email, sms: !!destinations.sms },
    )
    const template = templates.find((t) => t.channel === channel)
    const destination = channel ? destinations[channel] : null
    if (!channel || !template || !destination) return { status: 'screen_only' }

    const hidden = new Set(request.secretValueNames ?? [])
    const contextRedacted = Object.fromEntries(
      Object.entries(request.values).map(([k, v]) => [k, hidden.has(k) ? '***' : v]),
    )
    await deps.notifications.enqueue({
      deduplicationKey: request.deduplicationKey,
      memberId: request.memberId,
      bookingId: request.bookingId ?? null,
      couponGrantId: request.couponGrantId ?? null,
      paymentLinkId: request.paymentLinkId ?? null,
      templateVersionId: template.versionId,
      channel,
      destinationCiphertext: await deps.secrets.encrypt(destination),
      messageCiphertext: await deps.secrets.encrypt(
        JSON.stringify({
          subject: template.subject ? renderTemplate(template.subject, request.values) : null,
          body: renderTemplate(template.body, request.values),
        }),
      ),
      contextRedacted,
      scheduledAt: request.scheduledAt ?? deps.clock.now(),
    })
    return { status: 'queued', channel }
  }
}

export interface DispatchDeps extends NotifyDeps {
  readonly email: EmailSender
  readonly sms: SmsSender
  readonly line: LineSender
  readonly alerts: AlertRepository
}

/** Jobs worker (every minute): send due deliveries, retry with back-off, alert on final failure. */
export function makeDispatchNotifications(deps: DispatchDeps) {
  return async function dispatchNotifications(limit = 50) {
    const now = deps.clock.now()
    const due = await deps.notifications.claimDue(now, limit)
    let sent = 0
    let failed = 0
    for (const delivery of due) {
      const attemptNo = delivery.attemptCount + 1
      try {
        const to = await deps.secrets.decrypt(delivery.destinationCiphertext)
        const message = JSON.parse(await deps.secrets.decrypt(delivery.messageCiphertext)) as {
          subject: string | null
          body: string
        }
        const result =
          delivery.channel === 'email'
            ? await deps.email.send({
                to,
                subject: message.subject ?? '雀CUBE',
                text: message.body,
              })
            : delivery.channel === 'sms'
              ? await deps.sms.send({ to, body: message.body })
              : await deps.line.push({ to, text: message.body })
        await deps.notifications.recordAttempt(
          delivery.id,
          { attemptNo, result: 'accepted', providerMessageId: result.providerMessageId, at: now },
          { status: 'sent' },
        )
        sent++
      } catch (error) {
        failed++
        const retryMinutes = NOTIFICATION_RETRY_MINUTES[attemptNo - 1]
        const message = error instanceof Error ? error.message : String(error)
        await deps.notifications.recordAttempt(
          delivery.id,
          { attemptNo, result: 'failed', error: message.slice(0, 1000), at: now },
          retryMinutes === undefined
            ? { status: 'failed' }
            : { status: 'queued', retryAt: new Date(now.getTime() + retryMinutes * 60_000) },
        )
        if (retryMinutes === undefined) {
          await deps.alerts.raise({
            alertKey: `notification_failed:${delivery.id}`,
            alertType: 'notification_failed',
            severity: 'warning',
            failureReason: `${delivery.channel} notification could not be sent: ${message}`.slice(
              0,
              2000,
            ),
            recoverySteps:
              'お客様の連絡先を確認し、必要に応じて電話等でご案内してください。予約詳細から通知履歴を確認できます。',
            storeId: delivery.storeId,
            bookingId: delivery.bookingId,
            deliveryId: delivery.id,
            detectedAt: now,
          })
        }
      }
    }
    return { claimed: due.length, sent, failed }
  }
}
