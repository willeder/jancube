import 'server-only'
import {
  type BookingDeps,
  type HoldDeps,
  makeAttachMemberToHold,
  makeCreateHold,
  makeGetActiveHold,
  makeGetBookingCalendar,
  makeGetDayAvailability,
  makeGetEndOptions,
  makeGetSignInChallenge,
  makeListStores,
  makeRegisterMember,
  makeReleaseHold,
  makeResendSignInCode,
  makeSendSignInCode,
  makeSetGuestCount,
  makeVerifySignInCode,
  type SignInDeps,
  systemClock,
} from '@jancube/application'
import {
  ConsoleSmsSender,
  createDb,
  HmacSecretHasher,
  KyselyAuthChallengeRepository,
  KyselyBookingRepository,
  KyselyInventoryRepository,
  KyselyLegalDocumentRepository,
  KyselyMemberRepository,
  KyselyPricingRepository,
  KyselyStoreRepository,
  SmslinkSmsSender,
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
  const signIn: SignInDeps = {
    challenges: new KyselyAuthChallengeRepository(db),
    members,
    legalDocuments: new KyselyLegalDocumentRepository(db),
    // Development logs the code to the server console instead of sending an SMS.
    sms: config.isDevelopment ? new ConsoleSmsSender() : new SmslinkSmsSender(config.smslink),
    hasher: new HmacSecretHasher(config.authPepper),
    random: new WebCryptoRandom(),
    clock: systemClock,
  }
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
  }
}

export type Container = ReturnType<typeof buildContainer>
