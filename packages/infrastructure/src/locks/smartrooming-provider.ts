import {
  type AccessKeyProvider,
  AccessKeyProviderError,
  type LockDevice,
} from '@jancube/application'
import { utcToLocal } from '@jancube/domain'

const DEFAULT_BASE_URL = 'https://www.smartrooming.net/api/v2'
const DEFAULT_TIMEOUT_MS = 10_000

/** PhonePasscode (SmartRooming Connect API v1.0.1). */
interface PhonePasscode {
  id: number
  passcode: string
  begin: string
  end: string
  phone_number?: string
  comment?: string
}

export interface SmartRoomingConfig {
  /** Bearer token from the SmartRooming management screen. Never logged. */
  readonly apiToken: string
  readonly baseUrl?: string
  /**
   * Time zone of `begin` / `end` of phone passcodes. The spec marks other endpoints as UTC but not
   * these; store time (Asia/Tokyo) is assumed until the provider confirms.
   */
  readonly timeZone?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

/**
 * SmartRooming Connect API (NinjaLock M) over plain fetch, so it runs on Cloudflare Workers.
 *
 * Tracker #10: one entrance door per store. Entry codes are entrance-door phone passcodes
 * (`/entrance-doors/phone-passcodes/{EntranceDoorApiKey}`): the provider numbers the passcode and
 * takes a validity period. `lock_devices.external_device_id` holds the EntranceDoorApiKey.
 * Each passcode carries our request key in `comment`, so a retried issue finds the passcode an
 * earlier (timed-out) attempt created instead of creating a second one.
 */
export class SmartRoomingAccessKeyProvider implements AccessKeyProvider {
  readonly name = 'smartrooming'
  private readonly baseUrl: string
  private readonly timeZone: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch

  constructor(private readonly config: SmartRoomingConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeZone = config.timeZone ?? 'Asia/Tokyo'
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetcher = config.fetch ?? ((input, init) => fetch(input, init))
  }

  async issue(device: LockDevice, input: { requestKey: string; validFrom: Date; validTo: Date }) {
    const comment = `jancube ${input.requestKey}`
    const path = `/entrance-doors/phone-passcodes/${encodeURIComponent(device.externalDeviceId)}`
    const existing = (await this.call<PhonePasscode[]>('GET', path)) ?? []
    let passcode = existing.find((p) => p.comment === comment)
    if (!passcode) {
      const created = await this.call<PhonePasscode[]>('POST', path, {
        begin: this.format(input.validFrom),
        // The API's periods are inclusive (例: 10:00:00〜11:59:59).
        end: this.format(new Date(input.validTo.getTime() - 1000)),
        comment,
      })
      passcode = (created ?? []).find((p) => p.comment === comment)
    }
    if (!passcode?.passcode || passcode.id === undefined) {
      throw new AccessKeyProviderError(
        'unexpected_response',
        'issued passcode not found in the response',
      )
    }
    return {
      providerKeyId: String(passcode.id),
      code: passcode.passcode,
      details: passcode.phone_number ? { phoneNumber: passcode.phone_number } : undefined,
    }
  }

  async revoke(_device: LockDevice, providerKeyId: string) {
    try {
      await this.call(
        'DELETE',
        `/entrance-door-phone-passcodes/${encodeURIComponent(providerKeyId)}`,
      )
    } catch (error) {
      // Already gone (deleted in the provider console or expired) counts as revoked.
      if (error instanceof AccessKeyProviderError && error.code === 'not_found') return
      throw error
    }
  }

  /**
   * The API has no device-health endpoint for entrance doors and reports no battery level; a
   * successful passcode listing is taken as "online".
   */
  async status(device: LockDevice) {
    try {
      await this.call(
        'GET',
        `/entrance-doors/phone-passcodes/${encodeURIComponent(device.externalDeviceId)}`,
      )
      return { communication: 'online' as const, batteryPercent: null, detail: null }
    } catch (error) {
      const code = error instanceof AccessKeyProviderError ? error.code : 'error'
      return {
        communication:
          code === 'network' || code === 'server_error'
            ? ('unknown' as const)
            : ('offline' as const),
        batteryPercent: null,
        detail: code,
      }
    }
  }

  /** `YYYY-MM-DD HH:MM:SS` in the configured time zone. */
  private format(instant: Date): string {
    const { date, minuteOfDay } = utcToLocal(instant, this.timeZone)
    const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
    const mm = String(minuteOfDay % 60).padStart(2, '0')
    const ss = String(instant.getUTCSeconds()).padStart(2, '0')
    return `${date} ${hh}:${mm}:${ss}`
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiToken}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const timeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new AccessKeyProviderError(
        'network',
        timeout ? `timeout after ${this.timeoutMs}ms` : 'network error',
      )
    }
    if (response.status === 204) return null
    if (!response.ok) {
      // Response bodies are not echoed: they could contain passcodes.
      const status = response.status
      if (status === 401 || status === 403) {
        throw new AccessKeyProviderError(
          'unauthorized',
          `${method} ${status}: check the API token`,
          false,
        )
      }
      if (status === 404)
        throw new AccessKeyProviderError(
          'not_found',
          `${method} 404: unknown door or passcode`,
          false,
        )
      if (status === 400) {
        throw new AccessKeyProviderError(
          'rejected',
          `${method} 400: rejected (passcode limit or period)`,
          false,
        )
      }
      throw new AccessKeyProviderError(
        status === 429 ? 'rate_limited' : 'server_error',
        `${method} ${status}`,
      )
    }
    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text) as T
    } catch {
      throw new AccessKeyProviderError('unexpected_response', `${method} returned invalid JSON`)
    }
  }
}
