import {
  bookingConfirmedHandler,
  makeDispatchNotifications,
  makeNotify,
  makeNotifyBooking,
  makeProcessOutbox,
  type OutboxHandler,
  systemClock,
} from '@jancube/application'
import {
  AesGcmSecretBox,
  ConsoleEmailSender,
  ConsoleLineSender,
  ConsoleSmsSender,
  createDb,
  KyselyAlertRepository,
  KyselyAuditLog,
  KyselyBatchRunRepository,
  KyselyNotificationRepository,
  KyselyOutboxRepository,
  LineMessagingSender,
  ResendEmailSender,
  SmslinkSmsSender,
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
  }
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

  /** Business events → follow-up work. Each handler is idempotent. */
  const handlers: Record<string, OutboxHandler> = {
    'booking.confirmed': bookingConfirmedHandler(notifyBooking),
  }

  return {
    db,
    clock,
    alerts,
    audit: new KyselyAuditLog(db),
    batchRuns: new KyselyBatchRunRepository(db),
    notifyBooking,
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
