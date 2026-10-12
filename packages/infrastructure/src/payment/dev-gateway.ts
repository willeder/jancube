import type { PaymentGateway } from '@jancube/application'

/**
 * Development stand-in for Stripe: "checkout" is a local page (/booking/payment/dev-checkout) where
 * the developer chooses success or cancel. Never wire this outside APP_ENV=development.
 */
export class DevPaymentGateway implements PaymentGateway {
  readonly provider = 'dev'
  readonly environment = 'test' as const
  readonly accountId = 'local'

  async createCheckout(input: Parameters<PaymentGateway['createCheckout']>[0]) {
    const checkoutId = `dev_cs_${crypto.randomUUID().replaceAll('-', '')}`
    const params = new URLSearchParams({
      session: checkoutId,
      success: input.successUrl.replace('{CHECKOUT_SESSION_ID}', checkoutId),
      cancel: input.cancelUrl,
    })
    return { checkoutId, url: `/booking/payment/dev-checkout?${params}` }
  }

  async getCheckout() {
    // Completion is driven by the dev checkout page, which confirms directly.
    return { status: 'open' as const, paid: false, externalPaymentId: null, amount: 0 }
  }

  async expireCheckout() {}

  async refund() {
    return { refundId: `dev_re_${Date.now()}` }
  }

  async parseWebhook(): Promise<never> {
    throw new Error('webhook signature cannot be verified: Stripe is not configured')
  }
}
