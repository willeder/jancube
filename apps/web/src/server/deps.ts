import 'server-only'
import {
  type BookingDeps,
  type CheckoutDeps,
  type HoldDeps,
  makeNotify,
  makeNotifyBooking,
  type SignInDeps,
  systemClock,
} from '@jancube/application'
import {
  AesGcmSecretBox,
  ConsoleEmailSender,
  ConsoleSmsSender,
  type createDb,
  DevPaymentGateway,
  HmacSecretHasher,
  KyselyAlertRepository,
  KyselyAuditLog,
  KyselyAuthChallengeRepository,
  KyselyBookingRepository,
  KyselyCheckoutRepository,
  KyselyCouponRepository,
  KyselyInventoryRepository,
  KyselyLegalDocumentRepository,
  KyselyMemberRepository,
  KyselyNotificationRepository,
  KyselyOutboxRepository,
  KyselyPricingRepository,
  KyselyStaffRepository,
  KyselyStoreRepository,
  KyselyWebhookRepository,
  Pbkdf2PasswordHasher,
  ResendEmailSender,
  SmslinkSmsSender,
  StripePaymentGateway,
  WebCryptoRandom,
} from '@jancube/infrastructure'
import type { RuntimeConfig } from './runtime-config'

/** Adapters shared by every feature area, built once per request. */
export function buildDeps(db: ReturnType<typeof createDb>, config: RuntimeConfig) {
  const clock = systemClock
  const stores = new KyselyStoreRepository(db)
  const booking: BookingDeps = {
    stores,
    inventory: new KyselyInventoryRepository(db),
    // Tracker #6: "cheapest eligible combination". Mixing packages with hourly time is assumed allowed.
    pricing: new KyselyPricingRepository(db, { combinationRule: 'cheapest-combination' }),
    clock,
  }
  const bookings = new KyselyBookingRepository(db)
  const hold: HoldDeps = { ...booking, bookings, newRequestKey: () => crypto.randomUUID() }
  const members = new KyselyMemberRepository(db)
  const coupons = new KyselyCouponRepository(db)
  const legalDocuments = new KyselyLegalDocumentRepository(db)
  const random = new WebCryptoRandom()
  const hasher = new HmacSecretHasher(config.authPepper)
  // Development logs SMS/email to the server console instead of sending.
  const sms = config.isDevelopment ? new ConsoleSmsSender() : new SmslinkSmsSender(config.smslink)
  const email = config.resendApiKey
    ? new ResendEmailSender({ apiKey: config.resendApiKey, from: config.emailFrom })
    : new ConsoleEmailSender()
  const signIn: SignInDeps = {
    challenges: new KyselyAuthChallengeRepository(db),
    members,
    legalDocuments,
    coupons,
    sms,
    hasher,
    random,
    clock,
  }
  const audit = new KyselyAuditLog(db)
  const checkout: CheckoutDeps = {
    bookings,
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
    clock,
    newKey: () => crypto.randomUUID(),
  }
  const notifications = new KyselyNotificationRepository(db)
  const secrets = new AesGcmSecretBox(config.dataKey)
  const notify = makeNotify({ notifications, secrets, clock })
  return {
    db,
    config,
    clock,
    stores,
    booking,
    bookings,
    hold,
    members,
    coupons,
    legalDocuments,
    signIn,
    checkout,
    random,
    hasher,
    sms,
    email,
    audit,
    alerts: new KyselyAlertRepository(db),
    outbox: new KyselyOutboxRepository(db),
    secrets,
    notifications,
    notify,
    notifyBooking: makeNotifyBooking({ bookings: notifications, notify, appUrl: config.appUrl }),
    staff: new KyselyStaffRepository(db),
    passwords: new Pbkdf2PasswordHasher(),
  }
}

export type Deps = ReturnType<typeof buildDeps>
