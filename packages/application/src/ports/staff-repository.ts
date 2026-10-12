import type { RoleGrant } from '@jancube/domain'

export type StaffStatus = 'invited' | 'active' | 'disabled'

export interface StaffRecord {
  readonly id: number
  readonly email: string
  readonly name: string
  readonly status: StaffStatus
  readonly passwordHash: string | null
  readonly grants: readonly RoleGrant[]
}

export interface StaffRepository {
  findByEmail(email: string): Promise<StaffRecord | null>
  findById(id: number): Promise<StaffRecord | null>
  recordLogin(id: number, at: Date): Promise<void>
  setPassword(id: number, passwordHash: string, activate: boolean): Promise<void>
  createToken(token: {
    readonly staffId: number
    readonly purpose: 'invite' | 'password_reset'
    readonly tokenHash: string
    readonly expiresAt: Date
  }): Promise<void>
  /** Marks the token used and returns its staff id, or null if unknown, used or expired. */
  consumeToken(
    tokenHash: string,
    purpose: 'invite' | 'password_reset',
    now: Date,
  ): Promise<number | null>
}

/** Slow salted password hashing (PBKDF2 on Workers). */
export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(password: string, stored: string): Promise<boolean>
}
