/** Outbound SMS (sign-in codes, phone-booking payment links). Production adapter: SMSLINK. */
export interface SmsSender {
  send(message: { to: string; body: string }): Promise<{ providerMessageId: string }>
}

/** Outbound email (booking messages, receipts). Production adapter: Resend. */
export interface EmailSender {
  send(message: {
    to: string
    subject: string
    text: string
    html?: string
  }): Promise<{ providerMessageId: string }>
}
