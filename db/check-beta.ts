/**
 * Real-adapter beta acceptance check. Only runs against a named, isolated LOCAL verification DB.
 * Apply migrations and seed dummy masters first. Sends no external messages or payments.
 * DATABASE_URL=mysql://.../jancube_beta_verify pnpm exec tsx db/check-beta.ts
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import {
  type CheckoutDeps,
  type LineChatReply,
  makeConfirmCheckout,
  makeCreateHold,
  makeLineChat,
  makeNotify,
  makeNotifyBooking,
  makeRegisterLineMember,
  makeUsageCompletedNotice,
  systemClock,
} from '../packages/application/src/index'
import { addDays, localDateOf } from '../packages/domain/src/index'
import {
  AesGcmSecretBox,
  createDb,
  DevPaymentGateway,
  KyselyAlertRepository,
  KyselyBookingRepository,
  KyselyCheckoutRepository,
  KyselyCouponRepository,
  KyselyInventoryRepository,
  KyselyLegalDocumentRepository,
  KyselyLineChatRepository,
  KyselyLineLinkRepository,
  KyselyMemberRepository,
  KyselyMyPageRepository,
  KyselyNotificationRepository,
  KyselyOutboxRepository,
  KyselyPricingRepository,
  KyselyStoreRepository,
  KyselyWebhookRepository,
} from '../packages/infrastructure/src/index'

const url = new URL(process.env.DATABASE_URL ?? '')
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/jancube_beta_verify')
  throw new Error('Use the isolated local jancube_beta_verify database only')
const db = createDb(url.href, { maxConnections: 20 })
const runId = crypto.randomUUID().replaceAll('-', '')
const user = `U${runId}`
const providerId = 'beta-verification'
const clock = systemClock
const members = new KyselyMemberRepository(db)
const legalDocuments = new KyselyLegalDocumentRepository(db)
const coupons = new KyselyCouponRepository(db)
const bookings = new KyselyBookingRepository(db)
const stores = new KyselyStoreRepository(db)
const secrets = new AesGcmSecretBox(Buffer.alloc(32, 1).toString('base64'))
const hold = {
  stores,
  bookings,
  clock,
  inventory: new KyselyInventoryRepository(db),
  pricing: new KyselyPricingRepository(db, { combinationRule: 'cheapest-combination' }),
  newRequestKey: () => crypto.randomUUID(),
}
const checkouts = new KyselyCheckoutRepository(db)
const checkout: CheckoutDeps = {
  bookings,
  checkouts,
  coupons,
  members,
  stores,
  legalDocuments,
  gateway: new DevPaymentGateway(),
  webhooks: new KyselyWebhookRepository(db),
  clock,
  newKey: () => crypto.randomUUID(),
}

try {
  const store = await stores.findActiveByCode('JC001')
  assert.ok(store)
  const group = await db
    .selectFrom('room_groups')
    .select('id')
    .where('store_id', '=', store.id)
    .where('code', '=', '4MA')
    .executeTakeFirstOrThrow()
  const roomRows = await db
    .selectFrom('rooms')
    .select('id')
    .where('room_group_id', '=', group.id)
    .where('operating_status', '=', 'active')
    .execute()
  const date = addDays(localDateOf(new Date(), store.timezone), 10)
  const keys: string[] = []
  const create = makeCreateHold({
    ...hold,
    newRequestKey: () => {
      const key = `beta-${crypto.randomUUID()}`
      keys.push(key)
      return key
    },
  })
  const input = {
    storeCode: store.code,
    date,
    laneKey: 'g:4MA',
    start: new Date(`${date}T13:00:00+09:00`).toISOString(),
    end: new Date(`${date}T15:00:00+09:00`).toISOString(),
    source: 'web' as const,
  }
  try {
    for (let i = 0; i < roomRows.length - 1; i++) await create(input)
    const lastRoom = await Promise.allSettled(Array.from({ length: 12 }, () => create(input)))
    assert.equal(
      lastRoom.filter((result) => result.status === 'fulfilled').length,
      1,
      'only one customer can take the last room',
    )
    for (const result of lastRoom)
      if (result.status === 'rejected') assert.equal(result.reason.code, 'unavailable')
  } finally {
    for (const key of keys) await bookings.expireDraft(key, new Date())
  }
  let active = 0
  let maximum = 0
  await Promise.all(
    [date, addDays(date, 1)].map((businessDate) =>
      bookings.withInventoryLock(Number(group.id), businessDate, async () => {
        active++
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active--
      }),
    ),
  )
  assert.equal(maximum, 1, 'overnight inventory updates on neighboring dates must serialize')
  console.log('PASS last-room concurrency and cross-date inventory serialization')

  const register = makeRegisterLineMember({
    creator: members,
    legalDocuments,
    coupons,
    clock,
    providerId,
  })
  const registered = await Promise.all(
    Array.from({ length: 8 }, () =>
      register(
        { lineUserId: user, friendStatus: 'friend' },
        {
          familyName: '検証',
          givenName: '太郎',
          email: `qa-${runId}@example.test`,
          agreesToTerms: true,
          confirmsAdult: true,
        },
      ),
    ),
  )
  const id = registered[0]?.memberId
  assert.ok(id)
  assert.equal(
    new Set(registered.map((r) => r.memberId)).size,
    1,
    'concurrent registration must create one member',
  )
  const consents = await db
    .selectFrom('member_consents')
    .select('id')
    .where('member_id', '=', id)
    .execute()
  assert.equal(consents.length, 3)
  assert.equal((await members.findById(id))?.phone, null)
  const notifications = new KyselyNotificationRepository(db)
  assert.equal((await notifications.memberContact(id))?.notificationChannel, 'line')
  console.log(
    'PASS concurrent phone-free registration, consent versions and notification preference',
  )

  const chat = makeLineChat({
    sessions: new KyselyLineChatRepository(db, secrets),
    links: new KyselyLineLinkRepository(db),
    providerId,
    hold,
    checkout,
    alerts: new KyselyAlertRepository(db),
    appUrl: 'http://localhost:3010',
    liffId: null,
  })
  let sequence = 0
  const event = (text?: string, postbackData?: string) => ({
    eventId: `${runId}-${++sequence}`,
    timestamp: new Date(),
    type: 'message' as const,
    rawType: 'message',
    userId: user,
    replyToken: 'local-test',
    isRedelivery: false,
    text,
    postbackData,
  })
  let reply: LineChatReply | null = await chat(event('予約する'))
  for (let i = 0; i < 9; i++) {
    const first = reply?.choices[0]
    assert.ok(first && 'data' in first, `selection ${i} must offer a booking choice`)
    reply = await chat(event(undefined, first.data))
  }
  const pay = reply?.choices[0]
  assert.ok(pay && 'uri' in pay)
  const sessionId = new URL(pay.uri).searchParams.get('session')
  assert.ok(sessionId, 'development checkout link must be generated')
  const payment = await checkouts.findByCheckout(sessionId)
  assert.ok(payment)
  const confirm = makeConfirmCheckout(checkout)
  const paid = { externalPaymentId: `local-${runId}`, amount: payment.amount }
  assert.equal(await confirm(sessionId, paid), 'confirmed')
  assert.equal(await confirm(sessionId, paid), 'already_confirmed')
  const row = await db
    .selectFrom('bookings')
    .select('booking_code')
    .where('id', '=', payment.bookingId)
    .executeTakeFirstOrThrow()
  const detail = await new KyselyMyPageRepository(db).bookingDetail(row.booking_code)
  assert.equal(detail?.memberId, id)
  assert.equal(detail?.status, 'confirmed')
  console.log(
    'PASS encrypted persistent LINE choices → hold → coupon → dev checkout → duplicate confirmation → owned detail',
  )

  const notify = makeNotify({ notifications, secrets, clock })
  const notifyBooking = makeNotifyBooking({
    bookings: notifications,
    notify,
    appUrl: 'http://localhost:3010',
  })
  const outbox = new KyselyOutboxRepository(db)
  const completion = makeUsageCompletedNotice({
    booking: async () => (detail ? { end: detail.end, status: detail.status } : null),
    outbox,
    clock,
    notify: notifyBooking,
  })
  await completion.schedule(payment.bookingId)
  await completion.schedule(payment.bookingId)
  const scheduled = await db
    .selectFrom('outbox_events')
    .select(['available_at'])
    .where('aggregate_id', '=', payment.bookingId)
    .where('event_type', '=', 'booking.usage_completed')
    .execute()
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0]?.available_at.getTime(), (detail?.end.getTime() ?? 0) + 15 * 60_000)
  assert.equal((await notifications.templates('usage_completed', detail.store.id)).length, 2)
  const links = new KyselyLineLinkRepository(db)
  await links.setFriendStatus(providerId, user, 'blocked', new Date())
  assert.equal((await notifyBooking(payment.bookingId, 'usage_completed')).status, 'screen_only')
  console.log(
    'PASS delayed completion persistence, published templates and blocked-LINE no-fallback',
  )
  // These are dummy test payments; free inventory for repeated local acceptance runs.
  await db
    .updateTable('bookings')
    .set({ status: 'canceled' })
    .where('id', '=', payment.bookingId)
    .execute()
} finally {
  await db.destroy()
}
