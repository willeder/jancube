import { type AccessKeyProvider, AccessKeyProviderError } from '@jancube/application'

/**
 * Development stand-in for the lock API: generates a 6-digit code locally and logs the call (without
 * the code). Used only when APP_ENV=development and no lock API token is configured.
 */
export class ConsoleAccessKeyProvider implements AccessKeyProvider {
  readonly name = 'console'
  private readonly issued = new Map<string, { providerKeyId: string; code: string }>()

  async issue(
    device: { name: string },
    input: { requestKey: string; validFrom: Date; validTo: Date },
  ) {
    const existing = this.issued.get(input.requestKey)
    if (existing) return existing
    const digits = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
    const result = {
      providerKeyId: `dev-${input.requestKey}`,
      code: String(digits % 1_000_000).padStart(6, '0'),
    }
    this.issued.set(input.requestKey, result)
    console.info(
      `[lock:dev] issue on ${device.name} ${input.validFrom.toISOString()}..${input.validTo.toISOString()} (${input.requestKey})`,
    )
    return result
  }

  async revoke(device: { name: string }, providerKeyId: string) {
    console.info(`[lock:dev] revoke on ${device.name} ${providerKeyId}`)
  }

  async status() {
    return {
      communication: 'online' as const,
      batteryPercent: null,
      detail: 'development stand-in',
    }
  }
}

/** Outside development without a lock API token: every call fails loudly (and raises alerts). */
export class UnconfiguredAccessKeyProvider implements AccessKeyProvider {
  readonly name = 'unconfigured'

  private fail(): never {
    throw new AccessKeyProviderError(
      'not_configured',
      'SMARTROOMING_API_TOKEN is not configured',
      false,
    )
  }

  async issue(): Promise<never> {
    this.fail()
  }

  async revoke(): Promise<never> {
    this.fail()
  }

  async status() {
    return { communication: 'unknown' as const, batteryPercent: null, detail: 'not configured' }
  }
}
