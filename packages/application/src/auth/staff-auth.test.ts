import { describe, expect, it } from 'vitest'
import type { StaffRecord, StaffRepository } from '../ports/staff-repository'
import {
  makeGetStaffSession,
  makeRequestPasswordReset,
  makeSetPasswordWithToken,
  makeStaffSignIn,
  type StaffAuthDeps,
} from './staff-auth'

function world() {
  const staff: StaffRecord[] = [
    {
      id: 1,
      email: 'owner@example.com',
      name: 'オーナー',
      status: 'active',
      passwordHash: 'hash:correct horse 123',
      grants: [{ role: 'owner', storeId: null }],
    },
    {
      id: 2,
      email: 'gone@example.com',
      name: '退職者',
      status: 'disabled',
      passwordHash: 'hash:correct horse 123',
      grants: [],
    },
  ]
  const tokens: { hash: string; staffId: number; used: boolean; expires: Date }[] = []
  const mails: string[] = []
  const repo: StaffRepository = {
    findByEmail: async (email) => staff.find((s) => s.email === email) ?? null,
    findById: async (id) => staff.find((s) => s.id === id) ?? null,
    recordLogin: async () => {},
    setPassword: async (id, hash) => {
      const s = staff.find((x) => x.id === id)
      if (s) Object.assign(s, { passwordHash: hash, status: 'active' })
    },
    createToken: async (t) =>
      void tokens.push({
        hash: t.tokenHash,
        staffId: t.staffId,
        used: false,
        expires: t.expiresAt,
      }),
    consumeToken: async (hash, _purpose, now) => {
      const t = tokens.find((x) => x.hash === hash && !x.used && x.expires > now)
      if (!t) return null
      t.used = true
      return t.staffId
    },
  }
  const deps: StaffAuthDeps = {
    staff: repo,
    passwords: {
      hash: async (p) => `hash:${p}`,
      verify: async (p, stored) => stored === `hash:${p}`,
    },
    tokens: { hash: async (s) => `h(${s})` },
    random: { digits: () => '000000', token: () => 'tok123' },
    email: {
      send: async (m) => {
        mails.push(m.text)
        return { providerMessageId: 'x' }
      },
    },
    audit: { record: async () => {} },
    clock: { now: () => new Date('2026-11-01T00:00:00Z') },
  }
  return { deps, mails, staff }
}

describe('staff sign-in (A-01)', () => {
  it('signs in active staff and returns their access', async () => {
    const { deps } = world()
    const session = await makeStaffSignIn(deps)(' Owner@Example.com ', 'correct horse 123')
    expect(session).toMatchObject({
      staffId: 1,
      access: { grants: [{ role: 'owner', storeId: null }] },
    })
  })

  it('gives the same error for wrong passwords, unknown and disabled accounts', async () => {
    const { deps } = world()
    const signIn = makeStaffSignIn(deps)
    for (const [email, password] of [
      ['owner@example.com', 'wrong'],
      ['nobody@example.com', 'x'],
      ['gone@example.com', 'correct horse 123'],
    ] as const) {
      await expect(signIn(email, password)).rejects.toMatchObject({ code: 'invalid_credentials' })
    }
  })

  it('drops the session of a disabled account', async () => {
    const { deps } = world()
    expect(await makeGetStaffSession(deps)(2)).toBeNull()
  })
})

describe('password reset (A-30)', () => {
  it('emails a link, sets a strong password once', async () => {
    const { deps, mails, staff } = world()
    await makeRequestPasswordReset(deps)('owner@example.com', (t) => `https://x/reset?token=${t}`)
    await makeRequestPasswordReset(deps)('nobody@example.com', (t) => t)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toContain('https://x/reset?token=tok123')

    const setPassword = makeSetPasswordWithToken(deps)
    await expect(setPassword('tok123', 'password_reset', 'short1')).rejects.toMatchObject({
      code: 'weak_password',
    })
    await setPassword('tok123', 'password_reset', 'new password 2026')
    expect(staff[0]?.passwordHash).toBe('hash:new password 2026')
    await expect(
      setPassword('tok123', 'password_reset', 'new password 2026'),
    ).rejects.toMatchObject({
      code: 'token_invalid',
    })
  })
})
