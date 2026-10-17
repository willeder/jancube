import {
  type AccessKeyProvider,
  bookingConfirmedHandler,
  makeDispatchNotifications,
  makeExpireHolds,
  makeNotify,
  makeNotifyBooking,
  makeOperations,
  makeProcessOutbox,
  makeUsageCompletedNotice,
  type OutboxHandler,
  type PaymentGateway,
  systemClock,
} from '@jancube/application'
import {
  AesGcmSecretBox,
  ConsoleAccessKeyProvider,
  ConsoleEmailSender,
  ConsoleLineSender,
  ConsoleSmsSender,
  createDb,
  DevPaymentGateway,
  KyselyAccessKeyRepository,
  KyselyAlertRepository,
  KyselyAuditLog,
  KyselyBatchRunRepository,
  KyselyBookingRepository,
  KyselyCleaningRepository,
  KyselyLockDeviceRepository,
  KyselyNotificationRepository,
  KyselyOperationsRepository,
  KyselyOutboxRepository,
  KyselyStoreRepository,
  LineMessagingSender,
  ResendEmailSender,
  SmartRoomingAccessKeyProvider,
  SmslinkSmsSender,
  StripePaymentGateway,
  UnconfiguredAccessKeyProvider,
} from '@jancube/infrastructure'

/** Development-only key so local runs need no secrets; never used when APP_ENV is not development. */
const DEV_DATA_KEY = 'ZGV2LW9ubHktZGF0YS1rZXktMzItYnl0ZXMtbG9uZyE='

export interface JobsConfig {
  readonly isDevelopment: boolean
  readonly appUrl: string
  readonly dataKey: string
  readonly emailFrom: string
  readonly resendApiKey: string | null
  readonly lineChannelAccessToken: string | null
  readonly smslink: { apiToken: string; endpoint: string } | null
  /** Same Stripe account as apps/web; null in development without keys (dev gateway). */
  readonly stripe: { secretKey: string; webhookSecret: string; accountId: string } | null
  /** SmartRooming Connect API (entrance lock); null → development stand-in. */
  readonly smartRooming: {
    apiToken: string
    baseUrl: string | null
    timeZone: string | null
  } | null
}

export function jobsConfig(env: Record<string, unknown>): JobsConfig {
  const str = (name: string) =>
    typeof env[name] === 'string' && env[name] ? (env[name] as string) : null
  const isDevelopment = str('APP_ENV') === 'development'
  const required = (name: string, devValue: string) => {
    const value = str(name)
    if (value) return value
    if (isDevelopment) return devValue
    throw new Error(`${name} is not configured`)
  }
  return {
    isDevelopment,
    appUrl: required('APP_URL', 'http://localhost:3010'),
    dataKey: required('DATA_ENCRYPTION_KEY', DEV_DATA_KEY),
    emailFrom: str('EMAIL_FROM') ?? '雀CUBE <no-reply@jancube.net>',
    resendApiKey: str('RESEND_API_KEY'),
    lineChannelAccessToken: str('LINE_CHANNEL_ACCESS_TOKEN'),
    smslink: str('SMSLINK_ENDPOINT')
      ? { apiToken: str('SMSLINK_API_TOKEN') ?? '', endpoint: str('SMSLINK_ENDPOINT') ?? '' }
      : null,
    stripe: str('STRIPE_SECRET_KEY')
      ? {
          secretKey: str('STRIPE_SECRET_KEY') ?? '',
          // Webhooks are received by apps/web; the jobs worker only expires sessions.
          webhookSecret: str('STRIPE_WEBHOOK_SECRET') ?? '',
          accountId: str('STRIPE_ACCOUNT_ID') ?? 'default',
        }
      : isDevelopment
        ? null
        : missingSecret('STRIPE_SECRET_KEY'),
    smartRooming: str('SMARTROOMING_API_TOKEN')
      ? {
          apiToken: str('SMARTROOMING_API_TOKEN') ?? '',
          baseUrl: str('SMARTROOMING_BASE_URL'),
          timeZone: str('SMARTROOMING_TIME_ZONE'),
        }
      : null,
  }
}

function missingSecret(name: string): never {
  throw new Error(`${name} is not configured`)
}

/**
 * Composition root of the jobs worker. Built per invocation (Workers cannot share I/O objects
 * between requests); the database pool is closed afterwards.
 */
export async function withJobs<T>(
  connectionString: string,
  config: JobsConfig,
  fn: (jobs: ReturnType<typeof buildJobs>) => Promise<T>,
): Promise<T> {
  const db = createDb(connectionString)
  try {
    return await fn(buildJobs(db, config))
  } finally {
    await db.destroy()
  }
}

function buildJobs(db: ReturnType<typeof createDb>, config: JobsConfig) {
  const clock = systemClock
  const notifications = new KyselyNotificationRepository(db)
  const secrets = new AesGcmSecretBox(config.dataKey)
  const alerts = new KyselyAlertRepository(db)
  const notify = makeNotify({ notifications, secrets, clock })
  const notifyBooking = makeNotifyBooking({
    bookings: notifications,
    notify,
    appUrl: config.appUrl,
  })

  const missing = (what: string) => () => {
    throw new Error(`${what} is not configured`)
  }
  const email = config.resendApiKey
    ? new ResendEmailSender({ apiKey: config.resendApiKey, from: config.emailFrom })
    : config.isDevelopment
      ? new ConsoleEmailSender()
      : { send: missing('RESEND_API_KEY') }
  const sms = config.smslink
    ? new SmslinkSmsSender(config.smslink)
    : config.isDevelopment
      ? new ConsoleSmsSender()
      : { send: missing('SMSLINK') }
  const line = config.lineChannelAccessToken
    ? new LineMessagingSender({ channelAccessToken: config.lineChannelAccessToken })
    : config.isDevelopment
      ? new ConsoleLineSender()
      : { push: missing('LINE_CHANNEL_ACCESS_TOKEN') }

  const gateway: PaymentGateway = config.stripe
    ? new StripePaymentGateway(config.stripe)
    : new DevPaymentGateway()
  // Development without a lock API token: codes are generated locally (never in production).
  const lockProvider: AccessKeyProvider = config.smartRooming
    ? new SmartRoomingAccessKeyProvider({
        apiToken: config.smartRooming.apiToken,
        baseUrl: config.smartRooming.baseUrl ?? undefined,
        timeZone: config.smartRooming.timeZone ?? undefined,
      })
    : config.isDevelopment
      ? new ConsoleAccessKeyProvider()
      : new UnconfiguredAccessKeyProvider()
  const audit = new KyselyAuditLog(db)
  const batchRuns = new KyselyBatchRunRepository(db)
  const operationsRepository = new KyselyOperationsRepository(db)
  const operations = makeOperations({
    ops: operationsRepository,
    bookings: new KyselyBookingRepository(db),
    cleaning: new KyselyCleaningRepository(db),
    stores: new KyselyStoreRepository(db),
    keys: new KyselyAccessKeyRepository(db),
    devices: new KyselyLockDeviceRepository(db),
    provider: lockProvider,
    secrets,
    alerts,
    audit,
    batchRuns,
    notifyBooking,
    clock,
  })

  /** Business events → follow-up work. Each handler is idempotent. */
  const confirmedNotice = bookingConfirmedHandler(notifyBooking)
  const completionNotice = makeUsageCompletedNotice({
    booking: (id) => operationsRepository.booking(id),
    outbox: new KyselyOutboxRepository(db),
    clock,
    notify: notifyBooking,
  })
  const handlers: Record<string, OutboxHandler> = {
    'booking.confirmed': async (event) => {
      await confirmedNotice(event)
      // Booked after the day-before batch: room, cleaning, code and notice right away.
      await operations.onBookingConfirmed(event)
      await completionNotice.schedule(event.aggregateId)
    },
    'booking.canceled': operations.onBookingCanceled,
    'booking.changed': async (event) => {
      await operations.onBookingChanged(event)
      await completionNotice.schedule(event.aggregateId)
    },
    'booking.usage_completed': completionNotice.handle,
  }

  return {
    db,
    clock,
    alerts,
    audit,
    batchRuns,
    notifyBooking,
    operations,
    expireHolds: makeExpireHolds({ holds: operationsRepository, gateway, clock }),
    processOutbox: makeProcessOutbox({
      outbox: new KyselyOutboxRepository(db),
      alerts,
      clock,
      handlers,
      workerId: `jobs-${crypto.randomUUID().slice(0, 8)}`,
    }),
    dispatchNotifications: makeDispatchNotifications({
      notifications,
      secrets,
      clock,
      email,
      sms,
      line,
      alerts,
    }),
  }
}
