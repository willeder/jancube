import type { LineWebhookEvent, LineWebhookParser, LineWebhookPayload } from '@jancube/application'

const encoder = new TextEncoder()

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

const sha256Hex = async (text: string) =>
  hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))

/** `x-line-signature`: base64(HMAC-SHA256(channel secret, raw request body)). */
export async function lineSignature(channelSecret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  return Buffer.from(mac).toString('base64')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface RawEvent {
  type?: unknown
  webhookEventId?: unknown
  timestamp?: unknown
  replyToken?: unknown
  source?: { userId?: unknown }
  deliveryContext?: { isRedelivery?: unknown }
  message?: { type?: unknown; text?: unknown }
  postback?: { data?: unknown }
}

const KNOWN = new Set(['follow', 'unfollow', 'message', 'postback'])

async function toEvent(raw: RawEvent): Promise<LineWebhookEvent> {
  const rawType = typeof raw.type === 'string' ? raw.type : 'unknown'
  return {
    // Events without an id (very old API versions) are keyed by their content.
    eventId:
      typeof raw.webhookEventId === 'string' && raw.webhookEventId
        ? raw.webhookEventId.slice(0, 191)
        : await sha256Hex(JSON.stringify(raw)),
    type:
      rawType === 'postback'
        ? 'message'
        : KNOWN.has(rawType)
          ? (rawType as 'follow' | 'unfollow' | 'message')
          : 'other',
    rawType,
    userId:
      (raw.source as { type?: string })?.type === 'group' ||
      (raw.source as { type?: string })?.type === 'room'
        ? null
        : typeof raw.source?.userId === 'string'
          ? raw.source.userId
          : null,
    replyToken: typeof raw.replyToken === 'string' ? raw.replyToken : null,
    timestamp: new Date(typeof raw.timestamp === 'number' ? raw.timestamp : Date.now()),
    isRedelivery: raw.deliveryContext?.isRedelivery === true,
    text:
      raw.message?.type === 'text' && typeof raw.message.text === 'string'
        ? raw.message.text.slice(0, 5000)
        : null,
    postbackData: typeof raw.postback?.data === 'string' ? raw.postback.data.slice(0, 300) : null,
  }
}

/**
 * Messaging API webhook (https://developers.line.biz/en/reference/messaging-api/#signature-validation).
 * The signature is checked on the raw body before anything is parsed.
 */
export class LineSignatureWebhookParser implements LineWebhookParser {
  constructor(private readonly config: { readonly channelSecret: string }) {}

  async parse(rawBody: string, signature: string | null): Promise<LineWebhookPayload> {
    if (!signature) throw new Error('missing x-line-signature header')
    const expected = await lineSignature(this.config.channelSecret, rawBody)
    if (!constantTimeEqual(expected, signature.trim())) throw new Error('invalid signature')
    let body: { destination?: unknown; events?: unknown }
    try {
      body = JSON.parse(rawBody) as typeof body
    } catch {
      throw new Error('malformed webhook body')
    }
    const events = Array.isArray(body.events) ? (body.events as RawEvent[]) : []
    return {
      destination: typeof body.destination === 'string' ? body.destination : '',
      events: await Promise.all(events.map(toEvent)),
      payloadSha256: await sha256Hex(rawBody),
    }
  }
}
