import 'server-only'
import { redirect } from 'next/navigation'
import { loginPath } from '@/lib/auth-flow'
import { readSessionMemberId } from './session'

/** Signed-in member for a C-12〜C-19 page; otherwise C-22 ログイン, coming back here afterwards. */
export async function requireMemberPage(currentPath: string): Promise<number> {
  const memberId = await readSessionMemberId()
  if (!memberId) redirect(loginPath(currentPath))
  return memberId
}

/** /mypage/bookings/{code}{suffix} */
export const bookingPath = (code: string, suffix = '') =>
  `/mypage/bookings/${encodeURIComponent(code)}${suffix}`
