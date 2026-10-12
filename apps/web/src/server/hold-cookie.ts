import 'server-only'
import { cookies } from 'next/headers'

/**
 * The booking in progress is identified by a random key in an httpOnly cookie, not by the
 * (guessable) booking number. It lives slightly longer than any hold.
 */
const NAME = 'jc_hold'

export async function readHoldKey(): Promise<string | null> {
  return (await cookies()).get(NAME)?.value ?? null
}

export async function writeHoldKey(requestKey: string): Promise<void> {
  ;(await cookies()).set(NAME, requestKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  })
}

export async function clearHoldKey(): Promise<void> {
  ;(await cookies()).delete(NAME)
}
