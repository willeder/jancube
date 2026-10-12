import { describe, expect, it } from 'vitest'
import { AesGcmSecretBox, Pbkdf2PasswordHasher } from './secret-box'

const key = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)))

describe('AesGcmSecretBox', () => {
  it('round-trips text with a fresh IV each time', async () => {
    const box = new AesGcmSecretBox(key)
    const a = await box.encrypt('入室コード 482913')
    const b = await box.encrypt('入室コード 482913')
    expect(a).not.toEqual(b)
    expect(await box.decrypt(a)).toBe('入室コード 482913')
  })

  it('rejects tampering and wrong keys', async () => {
    const box = new AesGcmSecretBox(key)
    const sealed = await box.encrypt('secret')
    sealed[20] = (sealed[20] ?? 0) ^ 1
    await expect(box.decrypt(sealed)).rejects.toThrow()
    expect(() => new AesGcmSecretBox(btoa('short'))).toThrow(/32 bytes/)
  })
})

describe('Pbkdf2PasswordHasher', () => {
  it('verifies the right password only', async () => {
    const hasher = new Pbkdf2PasswordHasher()
    const stored = await hasher.hash('correct horse 123')
    expect(stored).toMatch(/^pbkdf2\$100000\$/)
    expect(await hasher.verify('correct horse 123', stored)).toBe(true)
    expect(await hasher.verify('wrong', stored)).toBe(false)
    expect(await hasher.verify('x', 'garbage')).toBe(false)
  })
})
