import 'server-only'
import { cookies } from 'next/headers'
import { runtimeConfig } from './runtime-config'

/**
 * Customer session: `memberId.expiresAtSeconds.signature` in an httpOnly cookie, signed with
 * HMAC-SHA-256 (SESSION_SECRET). Nothing secret is stored in it; the signature stops tampering.
 */
const SESSION = 'jc_session'
const SESSION_DAYS = 365

/** Sign-in in progress (C-05 → C-07): the challenge id, never the code. */
const CHALLENGE = 'jc_auth'
const CHALLENGE_MINUTES = 40

const secure = () => process.env.NODE_ENV === 'production'

/** HMAC-SHA-256 (SESSION_SECRET) of a cookie payload, base64url. */
export async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(runtimeConfig().sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return Buffer.from(mac).toString('base64url')
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function readSessionMemberId(): Promise<number | null> {
  const value = (await cookies()).get(SESSION)?.value
  if (!value) return null
  const [memberId, expires, signature] = value.split('.')
  if (!memberId || !expires || !signature) return null
  if (!constantTimeEqual(signature, await sign(`${memberId}.${expires}`))) return null
  if (Number(expires) * 1000 <= Date.now()) return null
  const id = Number(memberId)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function startSession(memberId: number): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60
  const payload = `${memberId}.${expires}`
  ;(await cookies()).set(SESSION, `${payload}.${await sign(payload)}`, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

export async function endSession(): Promise<void> {
  ;(await cookies()).delete(SESSION)
}

export async function readChallengeId(): Promise<string | null> {
  return (await cookies()).get(CHALLENGE)?.value ?? null
}

export async function writeChallengeId(challengeId: string): Promise<void> {
  ;(await cookies()).set(CHALLENGE, challengeId, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: CHALLENGE_MINUTES * 60,
  })
}

export async function clearChallengeId(): Promise<void> {
  ;(await cookies()).delete(CHALLENGE)
}
