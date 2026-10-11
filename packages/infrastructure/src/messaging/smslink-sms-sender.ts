import type { SmsSender } from '@jancube/application'

/**
 * SMSLINK adapter (client's chosen SMS provider).
 * The SMSLINK API specification has not been received yet, so this adapter is a placeholder that
 * fails loudly. Implement `send` once the spec (endpoint, auth, sender number, IP allow-list policy)
 * is available. Until then, wire ConsoleSmsSender in development.
 */
export class SmslinkSmsSender implements SmsSender {
  constructor(private readonly config: { apiToken: string; endpoint: string }) {}

  async send(_message: { to: string; body: string }): Promise<{ providerMessageId: string }> {
    throw new Error(`SMSLINK adapter not implemented yet (endpoint: ${this.config.endpoint})`)
  }
}
