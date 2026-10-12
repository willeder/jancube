import type { PasswordHasher, SecretBox } from '@jancube/application'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

/**
 * AES-256-GCM with a 32-byte key (DATA_ENCRYPTION_KEY, base64). Ciphertext layout:
 * [1 byte key version][12 byte IV][ciphertext+tag]. The version byte allows key rotation.
 */
export class AesGcmSecretBox implements SecretBox {
  private readonly key: Promise<CryptoKey>

  constructor(
    base64Key: string,
    private readonly version = 1,
  ) {
    const raw = fromBase64(base64Key)
    if (raw.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (base64)')
    this.key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }

  async encrypt(plaintext: string): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        await this.key,
        encoder.encode(plaintext),
      ),
    )
    const out = new Uint8Array(1 + iv.length + sealed.length)
    out[0] = this.version
    out.set(iv, 1)
    out.set(sealed, 13)
    return out
  }

  async decrypt(ciphertext: Uint8Array): Promise<string> {
    if (ciphertext[0] !== this.version) throw new Error(`unknown key version ${ciphertext[0]}`)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ciphertext.slice(1, 13) },
      await this.key,
      ciphertext.slice(13),
    )
    return decoder.decode(plain)
  }
}

/** Cloudflare Workers allow at most 100,000 PBKDF2 iterations. */
const ITERATIONS = 100_000

/** PBKDF2-HMAC-SHA256, stored as `pbkdf2$<iterations>$<salt b64>$<hash b64>`. */
export class Pbkdf2PasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const hash = await derive(password, salt, ITERATIONS)
    return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [scheme, iterations, salt, expected] = stored.split('$')
    if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false
    const actual = toBase64(await derive(password, fromBase64(salt), Number(iterations)))
    if (actual.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
  }
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}
