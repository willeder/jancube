import type { EmailSender } from '@jancube/application'

/** Resend REST API (https://resend.com/docs/api-reference/emails/send-email). Uses fetch, so it runs on Workers. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly config: { apiKey: string; from: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: { to: string; subject: string; text: string; html?: string }) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as { id: string }
    return { providerMessageId: data.id }
  }
}
