import { describe, expect, it } from 'vitest'
import { StripePaymentGateway } from './stripe-gateway'

const secret = 'whsec_test_secret'
const gateway = new StripePaymentGateway({ secretKey: 'sk_test_x', webhookSecret: secret })

async function sign(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  )
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')
  return `t=${timestamp},v1=${hex}`
}

const completed = JSON.stringify({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_1',
      payment_status: 'paid',
      payment_intent: 'pi_1',
      amount_total: 5800,
    },
  },
})

describe('StripePaymentGateway.parseWebhook', () => {
  it('accepts a correctly signed completed checkout', async () => {
    const event = await gateway.parseWebhook(completed, await sign(completed))
    expect(event).toMatchObject({
      kind: 'checkout_paid',
      eventId: 'evt_1',
      checkoutId: 'cs_test_1',
      externalPaymentId: 'pi_1',
      amount: 5800,
    })
    expect(event.payloadSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a tampered body, a missing header and an old timestamp', async () => {
    const header = await sign(completed)
    await expect(gateway.parseWebhook(completed.replace('5800', '1'), header)).rejects.toThrow(
      /signature/,
    )
    await expect(gateway.parseWebhook(completed, null)).rejects.toThrow(/missing/)
    const old = await sign(completed, Math.floor(Date.now() / 1000) - 3600)
    await expect(gateway.parseWebhook(completed, old)).rejects.toThrow(/tolerance/)
  })

  it('waits for async payment methods to settle', async () => {
    const unpaid = completed.replace('"paid"', '"unpaid"')
    expect(await gateway.parseWebhook(unpaid, await sign(unpaid))).toMatchObject({
      kind: 'ignored',
    })
  })

  it('treats test and live keys as separate environments', () => {
    expect(gateway.environment).toBe('test')
    expect(
      new StripePaymentGateway({ secretKey: 'sk_live_x', webhookSecret: secret }).environment,
    ).toBe('live')
  })
})
