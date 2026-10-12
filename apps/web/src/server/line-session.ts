import 'server-only'
import type { VerifiedLineUser } from '@jancube/application'
import { cookies } from 'next/headers'
import { constantTimeEqual, sign } from './session'

/**
 * L-02 → L-03: the LINE user proven by the ID token, kept while the customer confirms their phone
 * number by SMS. Signed (HMAC, `line:` prefix) so the browser cannot swap in another LINE user id.
 */
const PENDING = 'jc_line'
const PENDING_MINUTES = 40

const secure = () => process.env.NODE_ENV === 'production'

export interface PendingLineLink extends VerifiedLineUser {
  /** Where to continue after linking (relative path). */
  readonly next: string
}

/** Only same-site relative paths, so `next` cannot redirect to another site. */
export function safeNext(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/'
  }
  return value.slice(0, 300)
}

export async function writePendingLineLink(link: PendingLineLink): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + PENDING_MINUTES * 60
  const payload = Buffer.from(
    JSON.stringify({ u: link.lineUserId, f: link.friendStatus, n: link.next, e: expires }),
  ).toString('base64url')
  ;(await cookies()).set(PENDING, `${payload}.${await sign(`line:${payload}`)}`, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: PENDING_MINUTES * 60,
  })
}

export async function readPendingLineLink(): Promise<PendingLineLink | null> {
  const value = (await cookies()).get(PENDING)?.value
  const [payload, signature] = value?.split('.') ?? []
  if (!payload || !signature) return null
  if (!constantTimeEqual(signature, await sign(`line:${payload}`))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u?: unknown
      f?: unknown
      n?: unknown
      e?: unknown
    }
    if (typeof data.u !== 'string' || typeof data.e !== 'number' || data.e * 1000 <= Date.now()) {
      return null
    }
    return {
      lineUserId: data.u,
      friendStatus: data.f === 'friend' || data.f === 'blocked' ? data.f : 'unknown',
      next: safeNext(typeof data.n === 'string' ? data.n : null),
    }
  } catch {
    return null
  }
}

export async function clearPendingLineLink(): Promise<void> {
  ;(await cookies()).delete(PENDING)
}
