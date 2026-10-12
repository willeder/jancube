import { withContainer } from '@/server/container'

/**
 * Stripe webhook (checkout.session.completed / async_payment_succeeded / async_payment_failed /
 * expired). The raw body is needed for signature verification. A 5xx makes Stripe retry.
 */
export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  try {
    const result = await withContainer((c) => c.handlePaymentWebhook(body, signature))
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const unauthentic = /signature|tolerance|missing|malformed/i.test(message)
    console.error('stripe webhook failed:', message)
    return Response.json(
      { error: unauthentic ? 'invalid signature' : 'processing failed' },
      {
        status: unauthentic ? 400 : 500,
      },
    )
  }
}
