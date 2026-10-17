import type { LineReplyChoice, LineReplySender, LineSender } from '@jancube/application'

/**
 * LINE Messaging API: push (https://developers.line.biz/en/reference/messaging-api/#send-push-message)
 * for notifications (L-04) and reply (#send-reply-message) for the webhook guidance message.
 */
export class LineMessagingSender implements LineSender, LineReplySender {
  constructor(private readonly config: { channelAccessToken: string }) {}

  async push(message: { to: string; text: string }) {
    const retryKey = crypto.randomUUID()
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.channelAccessToken}`,
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({ to: message.to, messages: [{ type: 'text', text: message.text }] }),
    })
    if (!res.ok) throw new Error(`LINE push failed: ${res.status} ${await res.text()}`)
    const data = (await res.json().catch(() => ({}))) as { sentMessages?: { id: string }[] }
    return { providerMessageId: data.sentMessages?.[0]?.id ?? retryKey }
  }

  async reply(replyToken: string, text: string, choices: readonly LineReplyChoice[] = []) {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: 'text',
            text,
            ...(choices.length
              ? {
                  quickReply: {
                    items: choices.slice(0, 13).map((choice) => ({
                      type: 'action',
                      action:
                        'uri' in choice
                          ? { type: 'uri', label: choice.label.slice(0, 20), uri: choice.uri }
                          : {
                              type: 'postback',
                              label: choice.label.slice(0, 20),
                              data: choice.data,
                              displayText: choice.label,
                            },
                    })),
                  },
                }
              : {}),
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`LINE reply failed: ${res.status} ${await res.text()}`)
  }
}

/** Development: log instead of sending. */
export class ConsoleLineSender implements LineSender, LineReplySender {
  async push(message: { to: string; text: string }) {
    console.info(`[line:dev] to=${message.to}\n${message.text}`)
    return { providerMessageId: `dev-line-${Date.now()}` }
  }

  async reply(_replyToken: string, text: string, choices: readonly LineReplyChoice[] = []) {
    console.info(`[line:dev] reply\n${text}`)
    console.info(choices)
  }
}
