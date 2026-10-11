import type { EmailSender, SmsSender } from '@jancube/application'

/** Development adapters: log instead of sending. Never wire these in production. */
export class ConsoleSmsSender implements SmsSender {
  async send(message: { to: string; body: string }) {
    console.info(`[sms:dev] to=${message.to} body=${message.body}`)
    return { providerMessageId: `dev-sms-${Date.now()}` }
  }
}

export class ConsoleEmailSender implements EmailSender {
  async send(message: { to: string; subject: string; text: string }) {
    console.info(`[email:dev] to=${message.to} subject=${message.subject}\n${message.text}`)
    return { providerMessageId: `dev-email-${Date.now()}` }
  }
}
