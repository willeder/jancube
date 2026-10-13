import type { LineIdentity, LineIdentityVerifier } from '@jancube/application'
import { DomainError } from '@jancube/domain'

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify'
const FRIENDSHIP_URL = 'https://api.line.me/friendship/v1/status'

const invalid = () => new DomainError('line_token_invalid', 'the LINE ID token is not valid')

/**
 * LIFF / LINE Login token verification by LINE's verify endpoint
 * (https://developers.line.biz/en/reference/line-login/#verify-id-token). LINE checks the signature,
 * expiry and audience; the returned claims are checked again here.
 */
export class LineLoginVerifier implements LineIdentityVerifier {
  constructor(
    private readonly config: { readonly channelId: string },
    private readonly http: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  async verifyIdToken(idToken: string): Promise<LineIdentity> {
    if (!idToken || idToken.length > 8192) throw invalid()
    const res = await this.http(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: this.config.channelId }).toString(),
    })
    // 400: invalid, expired or issued to another channel.
    if (res.status === 400) throw invalid()
    if (!res.ok) throw new Error(`LINE ID token verification failed: HTTP ${res.status}`)
    const claims = (await res.json()) as {
      iss?: unknown
      sub?: unknown
      aud?: unknown
      exp?: unknown
      name?: unknown
    }
    if (
      claims.iss !== 'https://access.line.me' ||
      claims.aud !== this.config.channelId ||
      typeof claims.sub !== 'string' ||
      !/^U[0-9a-f]{32}$/.test(claims.sub) ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 <= this.now()
    ) {
      throw invalid()
    }
    return {
      lineUserId: claims.sub,
      displayName: typeof claims.name === 'string' ? claims.name : null,
    }
  }

  async friendship(accessToken: string | null): Promise<boolean | null> {
    if (!accessToken || accessToken.length > 4096) return null
    try {
      // Only trust an access token issued to this channel.
      const check = await this.http(`${VERIFY_URL}?access_token=${encodeURIComponent(accessToken)}`)
      if (!check.ok) return null
      const info = (await check.json()) as { client_id?: unknown; expires_in?: unknown }
      if (
        info.client_id !== this.config.channelId ||
        typeof info.expires_in !== 'number' ||
        info.expires_in <= 0
      ) {
        return null
      }
      const res = await this.http(FRIENDSHIP_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) return null
      const data = (await res.json()) as { friendFlag?: unknown }
      return typeof data.friendFlag === 'boolean' ? data.friendFlag : null
    } catch {
      return null
    }
  }
}

/**
 * Development without a LINE channel: the /liff page sends `dev:<LINE user id>` instead of a real
 * ID token. Never used when APP_ENV is not development.
 */
export class DevLineIdentityVerifier implements LineIdentityVerifier {
  async verifyIdToken(idToken: string): Promise<LineIdentity> {
    const match = /^dev:(U[0-9a-f]{32})$/.exec(idToken)
    if (!match?.[1]) throw invalid()
    return { lineUserId: match[1], displayName: '開発用LINEユーザー' }
  }

  async friendship(): Promise<boolean | null> {
    return true
  }
}
