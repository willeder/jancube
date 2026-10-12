/**
 * SMS sign-in code rules (F-AUTH-01/02). Values are defaults pending confirmation (CQ-43/66).
 * The code itself is never stored; only a keyed hash is (auth_challenges.secret_hash).
 */
export const OTP_POLICY = {
  digits: 6,
  validMinutes: 10,
  maxAttempts: 5,
  resendAfterSeconds: 60,
  /** Sends allowed per phone number per rolling hour. */
  maxSendsPerHour: 5,
  /** A verified code may be used to finish registration within this time. */
  registrationWindowMinutes: 30,
} as const

/** SMS body, kept within 70 characters so it is billed as one Japanese message. */
export function signInCodeMessage(code: string): string {
  return `雀CUBE 認証コード: ${code}（${OTP_POLICY.validMinutes}分有効）`
}
