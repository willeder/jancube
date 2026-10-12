/**
 * SMS sign-in runs in two contexts with the same use cases (F-AUTH-01〜03):
 * - booking: C-05〜C-07 during a hold, continuing to payment (C-09)
 * - login: C-22 ログイン from anywhere, continuing to the page the customer came from
 */
export type AuthFlow = 'booking' | 'login'

export const DEFAULT_AFTER_LOGIN = '/mypage'

/**
 * Only same-site paths are followed after sign-in (no open redirects): a single leading slash, no
 * scheme-relative `//` or `/\`, printable ASCII only, bounded length.
 */
export function safeNext(value: unknown, fallback = DEFAULT_AFTER_LOGIN): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return fallback
  if (!/^\/(?![/\\])[\x21-\x7e]*$/.test(value)) return fallback
  if (value.includes('\\')) return fallback
  return value
}

export interface AuthPaths {
  readonly flow: AuthFlow
  readonly next: string
  readonly start: string
  readonly verify: string
  readonly verifyResent: string
  readonly profile: string
  /** Where the member continues once signed in. */
  readonly done: string
}

export function authPaths(flow: AuthFlow, nextInput?: unknown): AuthPaths {
  if (flow === 'booking') {
    return {
      flow,
      next: '/booking/payment',
      start: '/booking/auth',
      verify: '/booking/auth/verify',
      verifyResent: '/booking/auth/verify?resent=1',
      profile: '/booking/auth/profile',
      done: '/booking/payment',
    }
  }
  const next = safeNext(nextInput)
  const query = next === DEFAULT_AFTER_LOGIN ? '' : `next=${encodeURIComponent(next)}`
  const path = (base: string, extra?: string) => {
    const q = [query, extra].filter(Boolean).join('&')
    return q ? `${base}?${q}` : base
  }
  return {
    flow,
    next,
    start: path('/login'),
    verify: path('/login/verify'),
    verifyResent: path('/login/verify', 'resent=1'),
    profile: path('/login/profile'),
    done: next,
  }
}

/** Sign-in page for a protected customer page. */
export function loginPath(next: string): string {
  return authPaths('login', next).start
}
