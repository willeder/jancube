import 'server-only'
import {
  type BookingDeps,
  type CheckoutDeps,
  type HoldDeps,
  makeAttachMemberToHold,
  makeClaimCouponCode,
  makeConfirmCheckout,
  makeCreateHold,
  makeFailCheckout,
  makeGetActiveHold,
  makeGetBookingCalendar,
  makeGetCompletedBooking,
  makeGetDayAvailability,
  makeGetEndOptions,
  makeGetPaymentOptions,
  makeGetSignInChallenge,
  makeHandlePaymentWebhook,
  makeListStores,
  makeRegisterMember,
  makeReleaseHold,
  makeResendSignInCode,
  makeSendSignInCode,
  makeSetGuestCount,
  makeStartCheckout,
  makeSyncCheckout,
  makeVerifySignInCode,
  type SignInDeps,
  systemClock,
} from '@jancube/application'
import {
  ConsoleSmsSender,
  createDb,
  DevPaymentGateway,
  HmacSecretHasher,
  KyselyAuthChallengeRepository,
  KyselyBookingRepository,
  KyselyCheckoutRepository,
  KyselyCouponRepository,
  KyselyInventoryRepository,
  KyselyLegalDocumentRepository,
  KyselyMemberRepository,
  KyselyPricingRepository,
  KyselyStoreRepository,
  KyselyWebhookRepository,
  SmslinkSmsSender,
  StripePaymentGateway,
  WebCryptoRandom,
} from '@jancube/infrastructure'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { type RuntimeConfig, runtimeConfig } from './runtime-config'

/**
 * Composition root: the only place where the framework/runtime meets the business logic.
 * Pages, route handlers and server actions call use cases from here; they never touch the database
 * or SDKs directly. `server-only` makes the build fail if this is imported into client code.
 *
 * Workers cannot share I/O objects between requests, so a container is built per request and its
 * database pool is closed afterwards. Hyperdrive does the real connection pooling.
 */
export async function withContainer<T>(fn: (c: Container) => Promise<T>): Promise<T> {
  const { env } = getCloudflareContext()
  const db = createDb(env.HYPERDRIVE.connectionString)
  try {
    return await fn(buildContainer(db, runtimeConfig()))
  } finally {
    await db.destroy()
  }
}

function buildContainer(db: ReturnType<typeof createDb>, config: RuntimeConfig) {
  const stores = new KyselyStoreRepository(db)
  const booking: BookingDeps = {
    stores,
    inventory: new KyselyInventoryRepository(db),
    // Tracker #6: "cheapest eligible combination". Mixing packages with hourly time is assumed allowed.
    pricing: new KyselyPricingRepository(db, { combinationRule: 'cheapest-combination' }),
    clock: systemClock,
  }
  const hold: HoldDeps = {
    ...booking,
    bookings: new KyselyBookingRepository(db),
    newRequestKey: () => crypto.randomUUID(),
  }
  const members = new KyselyMemberRepository(db)
  const coupons = new KyselyCouponRepository(db)
  const legalDocuments = new KyselyLegalDocumentRepository(db)
  const signIn: SignInDeps = {
    challenges: new KyselyAuthChallengeRepository(db),
    members,
    legalDocuments,
    coupons,
    // Development logs the code to the server console instead of sending an SMS.
    sms: config.isDevelopment ? new ConsoleSmsSender() : new SmslinkSmsSender(config.smslink),
    hasher: new HmacSecretHasher(config.authPepper),
    random: new WebCryptoRandom(),
    clock: systemClock,
  }
  const checkout: CheckoutDeps = {
    bookings: hold.bookings,
    checkouts: new KyselyCheckoutRepository(db),
    coupons,
    members,
    stores,
    legalDocuments,
    gateway: config.stripe
      ? new StripePaymentGateway(config.stripe)
      : // Development without Stripe test keys: local stand-in checkout page.
        new DevPaymentGateway(),
    webhooks: new KyselyWebhookRepository(db),
    clock: systemClock,
    newKey: () => crypto.randomUUID(),
  }
  const confirmCheckout = makeConfirmCheckout(checkout)
  const failCheckout = makeFailCheckout(checkout)
  return {
    listStores: makeListStores({ stores }),
    getBookingCalendar: makeGetBookingCalendar(booking),
    getDayAvailability: makeGetDayAvailability(booking),
    getEndOptions: makeGetEndOptions(booking),
    createHold: makeCreateHold(hold),
    getActiveHold: makeGetActiveHold(hold),
    setGuestCount: makeSetGuestCount(hold),
    releaseHold: makeReleaseHold(hold),
    sendSignInCode: makeSendSignInCode(signIn),
    resendSignInCode: makeResendSignInCode(signIn),
    getSignInChallenge: makeGetSignInChallenge(signIn),
    verifySignInCode: makeVerifySignInCode(signIn),
    registerMember: makeRegisterMember(signIn),
    attachMemberToHold: makeAttachMemberToHold({
      bookings: hold.bookings,
      members,
      clock: systemClock,
    }),
    findMember: (id: number) => members.findById(id),
    getPaymentOptions: makeGetPaymentOptions(checkout),
    claimCouponCode: makeClaimCouponCode(checkout),
    startCheckout: makeStartCheckout(checkout),
    syncCheckout: makeSyncCheckout(checkout),
    handlePaymentWebhook: makeHandlePaymentWebhook(checkout),
    getCompletedBooking: makeGetCompletedBooking(checkout),
    /** Development only: the local checkout page reports success or cancellation. */
    completeDevCheckout: async (checkoutId: string, outcome: 'paid' | 'canceled') => {
      if (checkout.gateway.provider !== 'dev') throw new Error('dev checkout is disabled')
      if (outcome === 'canceled') return failCheckout(checkoutId, 'canceled on dev checkout')
      const record = await checkout.checkouts.findByCheckout(checkoutId)
      if (!record) throw new Error('unknown checkout')
      return confirmCheckout(checkoutId, {
        externalPaymentId: `dev_pi_${record.paymentId}`,
        amount: record.amount,
      })
    },
  }
}

export type Container = ReturnType<typeof buildContainer>
