import type { CheckoutState, PaymentEvent, PaymentGateway } from '@jancube/application'

const API = 'https://api.stripe.com/v1'
/** Reject webhook signatures older than this (Stripe's recommended tolerance). */
const SIGNATURE_TOLERANCE_SECONDS = 300

const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

interface StripeSession {
  id: string
  url: string | null
  status: 'open' | 'complete' | 'expired'
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  payment_intent: string | null
  amount_total: number | null
}

/**
 * Stripe Checkout over plain fetch (no SDK), so it runs unchanged on Cloudflare Workers.
 * JPY is a zero-decimal currency: amounts are whole yen. PayPay must be enabled in the Stripe
 * dashboard before `method: 'paypay'` can be used.
 */
export class StripePaymentGateway implements PaymentGateway {
  readonly provider = 'stripe'
  readonly environment: 'test' | 'live'
  readonly accountId: string

  constructor(
    private readonly config: { secretKey: string; webhookSecret: string; accountId?: string },
  ) {
    this.environment = config.secretKey.startsWith('sk_live_') ? 'live' : 'test'
    this.accountId = config.accountId || 'default'
  }

  async createCheckout(input: Parameters<PaymentGateway['createCheckout']>[0]) {
    const form: Record<string, string> = {
      mode: 'payment',
      locale: 'ja',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'jpy',
      'line_items[0][price_data][unit_amount]': String(input.amount),
      'line_items[0][price_data][product_data][name]': input.description,
      'payment_method_types[0]': input.method,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: String(Math.floor(input.expiresAt.getTime() / 1000)),
    }
    if (input.customerEmail) form.customer_email = input.customerEmail
    for (const [key, value] of Object.entries(input.metadata)) {
      form[`metadata[${key}]`] = value
      form[`payment_intent_data[metadata][${key}]`] = value
    }
    const session = await this.call<StripeSession>(
      'POST',
      '/checkout/sessions',
      form,
      input.idempotencyKey,
    )
    if (!session.url) throw new Error('Stripe returned a checkout session without a URL')
    return { checkoutId: session.id, url: session.url }
  }

  async getCheckout(checkoutId: string): Promise<CheckoutState> {
    const s = await this.call<StripeSession>(
      'GET',
      `/checkout/sessions/${encodeURIComponent(checkoutId)}`,
    )
    return {
      status: s.status,
      paid: s.payment_status === 'paid',
      externalPaymentId: s.payment_intent,
      amount: s.amount_total ?? 0,
    }
  }

  async expireCheckout(checkoutId: string) {
    await this.call('POST', `/checkout/sessions/${encodeURIComponent(checkoutId)}/expire`, {})
  }

  async refund(input: { externalPaymentId: string; amount: number; idempotencyKey: string }) {
    const refund = await this.call<{ id: string }>(
      'POST',
      '/refunds',
      { payment_intent: input.externalPaymentId, amount: String(input.amount) },
      input.idempotencyKey,
    )
    return { refundId: refund.id }
  }

  async parseWebhook(rawBody: string, signatureHeader: string | null) {
    await this.verifySignature(rawBody, signatureHeader)
    const payloadSha256 = hex(await crypto.subtle.digest('SHA-256', encoder.encode(rawBody)))
    const event = JSON.parse(rawBody) as {
      id: string
      type: string
      data: { object: StripeSession }
    }
    const session = event.data.object
    const base = { eventId: event.id, eventType: event.type, payloadSha256 }

    const paid =
      (event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
      event.type === 'checkout.session.async_payment_succeeded'
    if (paid) {
      return {
        ...base,
        kind: 'checkout_paid',
        checkoutId: session.id,
        externalPaymentId: session.payment_intent,
        amount: session.amount_total ?? 0,
      } satisfies PaymentEvent & typeof base
    }
    if (
      event.type === 'checkout.session.expired' ||
      event.type === 'checkout.session.async_payment_failed'
    ) {
      return { ...base, kind: 'checkout_failed', checkoutId: session.id } satisfies PaymentEvent &
        typeof base
    }
    return { ...base, kind: 'ignored', type: event.type } satisfies PaymentEvent & typeof base
  }

  /** Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">[,v1=…] */
  private async verifySignature(rawBody: string, header: string | null) {
    if (!header) throw new Error('missing Stripe-Signature header')
    const parts = header.split(',').map((p) => p.split('=') as [string, string])
    const timestamp = parts.find(([k]) => k === 't')?.[1]
    const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
    if (!timestamp || signatures.length === 0) throw new Error('malformed Stripe-Signature header')
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
      throw new Error('Stripe webhook timestamp outside tolerance')
    }
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.config.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const expected = hex(
      await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`)),
    )
    if (!signatures.some((s) => constantTimeEqual(s, expected))) {
      throw new Error('invalid Stripe webhook signature')
    }
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.config.secretKey}` }
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: form ? new URLSearchParams(form).toString() : undefined,
    })
    const body = (await response.json()) as T & { error?: { message?: string; code?: string } }
    if (!response.ok) {
      throw new Error(
        `Stripe ${method} ${path} failed: ${body.error?.code ?? response.status} ${body.error?.message ?? ''}`,
      )
    }
    return body
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
