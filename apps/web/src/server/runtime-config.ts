import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'

/** Fixed values used only when APP_ENV=development, so local runs need no secrets set up. */
const DEV_FALLBACKS = {
  AUTH_PEPPER: 'dev-only-auth-pepper-not-secret',
  SESSION_SECRET: 'dev-only-session-secret-not-secret',
  // 32 bytes, base64 — same development key as the jobs worker.
  DATA_ENCRYPTION_KEY: 'ZGV2LW9ubHktZGF0YS1rZXktMzItYnl0ZXMtbG9uZyE=',
} as const

type SecretName = keyof typeof DEV_FALLBACKS

export interface RuntimeConfig {
  readonly isDevelopment: boolean
  readonly authPepper: string
  readonly sessionSecret: string
  readonly dataKey: string
  /** Public base URL (links in emails/SMS). Request origin is used for in-app redirects. */
  readonly appUrl: string
  readonly emailFrom: string
  readonly resendApiKey: string | null
  readonly lineChannelAccessToken: string | null
  /** C-21: MAINTENANCE_MODE=1 stops customer screens; MAINTENANCE_MESSAGE describes the period. */
  readonly maintenance: { readonly enabled: boolean; readonly message: string | null }
  /**
   * LINE (F-LINE-01〜05). Null values = not set up yet: development uses stand-ins, other
   * environments answer LINE requests with "not configured" (the rest of the app keeps working).
   */
  readonly line: {
    /** LINE Login channel id of the LIFF app (ID token audience; member_line_links.provider_id). */
    readonly loginChannelId: string | null
    /** LIFF app id (public; used by the /liff page). */
    readonly liffId: string | null
    /** Messaging API channel secret (webhook signature). */
    readonly channelSecret: string | null
  }
  readonly smslink: { readonly apiToken: string; readonly endpoint: string }
  /** Null in development without Stripe test keys: the local dev checkout page is used instead. */
  readonly stripe: {
    readonly secretKey: string
    readonly webhookSecret: string
    readonly accountId: string
  } | null
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
    dataKey: secret('DATA_ENCRYPTION_KEY'),
    appUrl: env.APP_URL ?? 'http://localhost:3010',
    emailFrom: env.EMAIL_FROM ?? '雀CUBE <no-reply@jancube.net>',
    resendApiKey: env.RESEND_API_KEY || null,
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || null,
    maintenance: {
      enabled: ['1', 'true', 'on'].includes((env.MAINTENANCE_MODE ?? '').trim().toLowerCase()),
      message: env.MAINTENANCE_MESSAGE?.trim() || null,
    },
    line: {
      loginChannelId: env.LINE_LOGIN_CHANNEL_ID || null,
      liffId: env.LIFF_ID || null,
      channelSecret: env.LINE_CHANNEL_SECRET || null,
    },
    smslink: { apiToken: env.SMSLINK_API_TOKEN ?? '', endpoint: env.SMSLINK_ENDPOINT ?? '' },
    stripe: stripeConfig(env, isDevelopment),
  }
}

function stripeConfig(env: Record<string, string | undefined>, isDevelopment: boolean) {
  const secretKey = env.STRIPE_SECRET_KEY
  if (!secretKey) {
    if (isDevelopment) return null
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? ''
  if (!webhookSecret && !isDevelopment) throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  return {
    secretKey,
    webhookSecret,
    accountId: env.STRIPE_ACCOUNT_ID ?? 'default',
  }
}
