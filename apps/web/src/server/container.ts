import 'server-only'
import {
  type BookingDeps,
  type HoldDeps,
  makeCreateHold,
  makeGetActiveHold,
  makeGetBookingCalendar,
  makeGetDayAvailability,
  makeGetEndOptions,
  makeListStores,
  makeReleaseHold,
  makeSetGuestCount,
  systemClock,
} from '@jancube/application'
import {
  createDb,
  KyselyBookingRepository,
  KyselyInventoryRepository,
  KyselyPricingRepository,
  KyselyStoreRepository,
} from '@jancube/infrastructure'
import { getCloudflareContext } from '@opennextjs/cloudflare'

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
    return await fn(buildContainer(db))
  } finally {
    await db.destroy()
  }
}

function buildContainer(db: ReturnType<typeof createDb>) {
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
  return {
    listStores: makeListStores({ stores }),
    getBookingCalendar: makeGetBookingCalendar(booking),
    getDayAvailability: makeGetDayAvailability(booking),
    getEndOptions: makeGetEndOptions(booking),
    createHold: makeCreateHold(hold),
    getActiveHold: makeGetActiveHold(hold),
    setGuestCount: makeSetGuestCount(hold),
    releaseHold: makeReleaseHold(hold),
  }
}

export type Container = ReturnType<typeof buildContainer>
