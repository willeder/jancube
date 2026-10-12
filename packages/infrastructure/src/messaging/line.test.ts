import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ipText } from '../db/kysely-audit-log-query'
import { DevLineIdentityVerifier, LineLoginVerifier } from './line-login'
import { LineSignatureWebhookParser, lineSignature } from './line-webhook'

const secret = 'test-channel-secret'
const parser = new LineSignatureWebhookParser({ channelSecret: secret })

const body = JSON.stringify({
  destination: 'Ubot0000000000000000000000000000',
  events: [
    {
      type: 'follow',
      webhookEventId: '01HXXXXXXXXXXXXXXXXXXXXXXX',
      timestamp: 1_793_500_000_000,
      replyToken: 'reply-1',
      source: { type: 'user', userId: 'U1234567890abcdef1234567890abcdef' },
      deliveryContext: { isRedelivery: false },
      mode: 'active',
    },
    {
      type: 'message',
      timestamp: 1_793_500_000_100,
      replyToken: 'reply-2',
      source: { type: 'user', userId: 'U1234567890abcdef1234567890abcdef' },
      message: { type: 'text', id: '1', text: 'こんにちは' },
      deliveryContext: { isRedelivery: true },
    },
    { type: 'postback', webhookEventId: '01HYYYYYYYYYYYYYYYYYYYYYYY', timestamp: 1 },
  ],
})

describe('LINE webhook signature (x-line-signature)', () => {
  it('accepts the HMAC-SHA256 of the raw body and parses the events', async () => {
    const payload = await parser.parse(body, await lineSignature(secret, body))
    expect(payload.destination).toBe('Ubot0000000000000000000000000000')
    expect(payload.payloadSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.events).toEqual([
      {
        eventId: '01HXXXXXXXXXXXXXXXXXXXXXXX',
        type: 'follow',
        rawType: 'follow',
        userId: 'U1234567890abcdef1234567890abcdef',
        replyToken: 'reply-1',
        timestamp: new Date(1_793_500_000_000),
        isRedelivery: false,
      },
      expect.objectContaining({ type: 'message', isRedelivery: true, replyToken: 'reply-2' }),
      expect.objectContaining({ type: 'other', rawType: 'postback', userId: null }),
    ])
    // Events without webhookEventId get a stable content hash as id.
    expect(payload.events[1]?.eventId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches an independent HMAC computation, including UTF-8 bodies', async () => {
    expect(await lineSignature('secret', '{}')).toBe('dzJZAsrKgS3CWXM6rNBGtzgXNyx3e42VtAJkdHRRbhM=')
    const japanese = '{"text":"予約したい"}'
    expect(await lineSignature(secret, japanese)).toBe(
      createHmac('sha256', secret).update(Buffer.from(japanese, 'utf8')).digest('base64'),
    )
  })

  it('rejects a tampered body, a wrong secret and a missing header', async () => {
    const signature = await lineSignature(secret, body)
    await expect(parser.parse(body.replace('follow', 'unfollow'), signature)).rejects.toThrow(
      /signature/,
    )
    await expect(
      new LineSignatureWebhookParser({ channelSecret: 'other' }).parse(body, signature),
    ).rejects.toThrow(/signature/)
    await expect(parser.parse(body, null)).rejects.toThrow(/missing/)
  })

  it('accepts the empty verification request from the LINE console', async () => {
    const empty = JSON.stringify({ destination: 'Ubot', events: [] })
    expect((await parser.parse(empty, await lineSignature(secret, empty))).events).toEqual([])
  })
})

const USER = 'U1234567890abcdef1234567890abcdef'
const NOW = 1_793_500_000_000

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = []
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
  return { http, calls }
}

const claims = (over: Record<string, unknown> = {}) =>
  Response.json({
    iss: 'https://access.line.me',
    sub: USER,
    aud: '2000000001',
    exp: NOW / 1000 + 600,
    iat: NOW / 1000,
    name: '山田',
    ...over,
  })

describe('LINE ID token verification (F-LINE-02)', () => {
  it('posts the token with the channel id and returns the LINE user', async () => {
    const { http, calls } = fakeFetch(() => claims())
    const verifier = new LineLoginVerifier({ channelId: '2000000001' }, http, () => NOW)
    expect(await verifier.verifyIdToken('id.token.sig')).toEqual({
      lineUserId: USER,
      displayName: '山田',
    })
    expect(calls[0]?.url).toBe('https://api.line.me/oauth2/v2.1/verify')
    expect(String(calls[0]?.init?.body)).toBe('id_token=id.token.sig&client_id=2000000001')
  })

  it('rejects tokens LINE refuses, for another channel, expired or with a wrong issuer', async () => {
    const reject = async (response: () => Response) => {
      const { http } = fakeFetch(response)
      const verifier = new LineLoginVerifier({ channelId: '2000000001' }, http, () => NOW)
      await expect(verifier.verifyIdToken('t')).rejects.toMatchObject({
        code: 'line_token_invalid',
      })
    }
    await reject(() => Response.json({ error: 'invalid_request' }, { status: 400 }))
    await reject(() => claims({ aud: '2999999999' }))
    await reject(() => claims({ exp: NOW / 1000 - 1 }))
    await reject(() => claims({ iss: 'https://evil.example' }))
    await reject(() => claims({ sub: 'not-a-user-id' }))
  })

  it('reports LINE outages as errors, not as invalid tokens', async () => {
    const { http } = fakeFetch(() => new Response('down', { status: 503 }))
    const verifier = new LineLoginVerifier({ channelId: '2000000001' }, http, () => NOW)
    await expect(verifier.verifyIdToken('t')).rejects.toThrow(/HTTP 503/)
  })

  it('reads the friendship only with an access token issued to this channel', async () => {
    const ok = fakeFetch((url) =>
      url.includes('access_token=')
        ? Response.json({ client_id: '2000000001', expires_in: 1000, scope: 'profile openid' })
        : Response.json({ friendFlag: false }),
    )
    const verifier = new LineLoginVerifier({ channelId: '2000000001' }, ok.http, () => NOW)
    expect(await verifier.friendship('access')).toBe(false)
    expect(ok.calls[1]?.init?.headers).toEqual({ Authorization: 'Bearer access' })

    const foreign = fakeFetch(() => Response.json({ client_id: '2999999999', expires_in: 1000 }))
    const other = new LineLoginVerifier({ channelId: '2000000001' }, foreign.http, () => NOW)
    expect(await other.friendship('access')).toBeNull()
    expect(foreign.calls).toHaveLength(1)
    expect(await other.friendship(null)).toBeNull()
  })

  it('development stand-in accepts only dev:<user id>', async () => {
    const dev = new DevLineIdentityVerifier()
    expect(await dev.verifyIdToken(`dev:${USER}`)).toMatchObject({ lineUserId: USER })
    await expect(dev.verifyIdToken('real.jwt.token')).rejects.toMatchObject({
      code: 'line_token_invalid',
    })
  })
})

describe('audit log IP addresses', () => {
  it('formats stored IPv4/IPv6 bytes', () => {
    expect(ipText(Buffer.from([203, 0, 113, 24]))).toBe('203.0.113.24')
    expect(ipText(Buffer.from('20010db8000000000000000000000001', 'hex'))).toBe(
      '2001:db8:0:0:0:0:0:1',
    )
    expect(ipText(null)).toBeNull()
  })
})
