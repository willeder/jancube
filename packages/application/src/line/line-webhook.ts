import type { WebhookRepository } from '../ports/checkout'
import type { Clock } from '../ports/clock'
import type {
  LineLinkRepository,
  LineReplySender,
  LineWebhookEvent,
  LineWebhookParser,
} from '../ports/line'

/** Compatibility guidance when the selection-chat handler is not supplied. */
export const LINE_GUIDANCE_MESSAGE = [
  'メッセージありがとうございます。',
  'ご予約・ご予約の確認は、画面下のメニュー「予約する」「予約確認」からお手続きください。',
  'その他のお問い合わせは、このトークに内容をお送りください。スタッフが確認のうえご返信します。',
].join('\n')

export interface LineWebhookDeps {
  readonly parser: LineWebhookParser
  readonly webhooks: WebhookRepository
  readonly links: LineLinkRepository
  readonly replies: LineReplySender
  readonly clock: Clock
  /** Same key as member_line_links.provider_id (see LineAccountDeps.providerId). */
  readonly providerId: string
  readonly environment: 'test' | 'live'
  readonly chat?: (
    event: LineWebhookEvent,
  ) => Promise<{ text: string; choices: readonly import('../ports/line').LineReplyChoice[] } | null>
}

/**
 * `/api/line/webhook`: verify the signature, store each event once (webhook_events, provider 'line')
 * and keep the friend status current (follow → friend, unfollow → blocked: no LINE notifications,
 * no fallback per tracker). Other messages get the fixed guidance reply.
 * Throws on processing errors so LINE redelivers; already processed events are skipped.
 */
export function makeHandleLineWebhook(deps: LineWebhookDeps) {
  return async function handleLineWebhook(rawBody: string, signature: string | null) {
    const payload = await deps.parser.parse(rawBody, signature)
    const result = { processed: 0, duplicates: 0, ignored: 0, failed: 0 }
    for (const event of payload.events) {
      const stored = await deps.webhooks.record({
        provider: 'line',
        environment: deps.environment,
        accountId: payload.destination.slice(0, 100) || 'unknown',
        eventId: event.eventId,
        eventType: event.rawType.slice(0, 100),
        payloadSha256: payload.payloadSha256,
        // No user ids or message text: only what is needed to trace the delivery.
        redacted: {
          type: event.rawType,
          isRedelivery: event.isRedelivery,
          timestamp: event.timestamp.toISOString(),
        },
        receivedAt: deps.clock.now(),
      })
      if (stored.duplicate && stored.processed) {
        result.duplicates++
        continue
      }
      try {
        const outcome = await handleEvent(deps, event)
        await deps.webhooks.finish(stored.id, outcome)
        result[outcome]++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await deps.webhooks.finish(stored.id, 'failed', message.slice(0, 2000))
        // A lost reply is not worth a redelivery (reply tokens expire within a minute).
        if (!(error instanceof ReplyFailed)) throw error
        result.failed++
      }
    }
    return result
  }
}

class ReplyFailed extends Error {}

async function handleEvent(
  deps: LineWebhookDeps,
  event: LineWebhookEvent,
): Promise<'processed' | 'ignored'> {
  switch (event.type) {
    case 'follow':
    case 'unfollow': {
      if (!event.userId) return 'ignored'
      const linked = await deps.links.setFriendStatus(
        deps.providerId,
        event.userId,
        event.type === 'follow' ? 'friend' : 'blocked',
        event.timestamp,
      )
      return linked ? 'processed' : 'ignored'
    }
    case 'message': {
      if (deps.chat) {
        const message = await deps.chat(event)
        if (message && event.replyToken) {
          try {
            await deps.replies.reply(event.replyToken, message.text, message.choices)
          } catch (error) {
            throw new ReplyFailed(error instanceof Error ? error.message : String(error))
          }
        }
        return 'processed'
      }
      // Redelivered events carry reply tokens that may already be used or expired.
      if (!event.replyToken || event.isRedelivery) return 'ignored'
      try {
        await deps.replies.reply(event.replyToken, LINE_GUIDANCE_MESSAGE)
      } catch (error) {
        throw new ReplyFailed(error instanceof Error ? error.message : String(error))
      }
      return 'processed'
    }
    default:
      return 'ignored'
  }
}
