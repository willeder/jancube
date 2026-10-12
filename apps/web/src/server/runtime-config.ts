import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'

/** Fixed values used only when APP_ENV=development, so local runs need no secrets set up. */
const DEV_FALLBACKS = {
  AUTH_PEPPER: 'dev-only-auth-pepper-not-secret',
  SESSION_SECRET: 'dev-only-session-secret-not-secret',
} as const

type SecretName = keyof typeof DEV_FALLBACKS

export interface RuntimeConfig {
  readonly isDevelopment: boolean
  readonly authPepper: string
  readonly sessionSecret: string
  readonly smslink: { readonly apiToken: string; readonly endpoint: string }
}

/**
 * Secrets come from `wrangler secret put` in deployed environments (or `.dev.vars` locally).
 * Outside development a missing secret is a startup error, never a silent fallback.
 */
export function runtimeConfig(): RuntimeConfig {
  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>
  const isDevelopment = env.APP_ENV === 'development'
  const secret = (name: SecretName) => {
    const value = env[name]
    if (value) return value
    if (isDevelopment) return DEV_FALLBACKS[name]
    throw new Error(`${name} is not configured`)
  }
  return {
    isDevelopment,
    authPepper: secret('AUTH_PEPPER'),
    sessionSecret: secret('SESSION_SECRET'),
    smslink: { apiToken: env.SMSLINK_API_TOKEN ?? '', endpoint: env.SMSLINK_ENDPOINT ?? '' },
  }
}
