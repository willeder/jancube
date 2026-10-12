import type { RandomSource, SecretHasher } from '@jancube/application'

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

/** HMAC-SHA-256 keyed with a server-side pepper (AUTH_PEPPER), so a leaked table cannot be brute-forced offline. */
export class HmacSecretHasher implements SecretHasher {
  private readonly key: Promise<CryptoKey>

  constructor(pepper: string) {
    if (pepper.length < 16) throw new Error('AUTH_PEPPER must be at least 16 characters')
    this.key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  }

  async hash(secret: string): Promise<string> {
    const signature = await crypto.subtle.sign(
      'HMAC',
      await this.key,
      new TextEncoder().encode(secret),
    )
    return hex(signature)
  }
}

export class WebCryptoRandom implements RandomSource {
  digits(count: number): string {
    let out = ''
    const buf = new Uint8Array(1)
    while (out.length < count) {
      crypto.getRandomValues(buf)
      const byte = buf[0] ?? 255
      // Rejection sampling keeps every digit equally likely (250 = 25 × 10).
      if (byte < 250) out += String(byte % 10)
    }
    return out
  }

  token(): string {
    return hex(crypto.getRandomValues(new Uint8Array(24)))
  }
}
