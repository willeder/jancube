/**
 * Concurrency check for holds against the local database (QA tool, not a unit test).
 * Fires N simultaneous holds for the same 4麻 slot and verifies that no more holds succeed than
 * there are rooms, and that the losers fail cleanly with `unavailable` (no deadlock errors).
 *
 *   pnpm db:check:concurrency            (needs `pnpm db:up && pnpm db:seed`)
 *
 * Holds created by the check are expired afterwards.
 */
import 'dotenv/config'
import { makeCreateHold, systemClock } from '../packages/application/src/index'
import { addDays, utcToLocal } from '../packages/domain/src/index'
import {
  createDb,
  KyselyBookingRepository,
  KyselyInventoryRepository,
  KyselyPricingRepository,
  KyselyStoreRepository,
} from '../packages/infrastructure/src/index'

const url = process.env.DATABASE_URL ?? 'mysql://root:jancube@127.0.0.1:3306/jancube'
const BURST = 12

async function main() {
  const db = createDb(url, { maxConnections: BURST })
  const stores = new KyselyStoreRepository(db)
  const createHold = makeCreateHold({
    stores,
    inventory: new KyselyInventoryRepository(db),
    pricing: new KyselyPricingRepository(db, { combinationRule: 'cheapest-combination' }),
    bookings: new KyselyBookingRepository(db),
    clock: systemClock,
    newRequestKey: () => `concurrency-check-${crypto.randomUUID()}`,
  })

  const store = await stores.findActiveByCode('JC001')
  if (!store) throw new Error('JC001 not found — run pnpm db:seed')
  const today = utcToLocal(new Date(), store.timezone).date
  const date = addDays(store.booking.openDate > today ? store.booking.openDate : today, 3)
  const start = new Date(`${date}T13:00:00+09:00`).toISOString()
  const end = new Date(`${date}T17:00:00+09:00`).toISOString()

  const results = await Promise.allSettled(
    Array.from({ length: BURST }, () =>
      createHold({ storeCode: 'JC001', date, laneKey: 'g:4MA', start, end, source: 'web' }),
    ),
  )
  const ok = results.filter((r) => r.status === 'fulfilled').length
  const errors = results.flatMap((r) =>
    r.status === 'rejected' ? [(r.reason as { code?: string }).code ?? String(r.reason)] : [],
  )

  const rooms = await db
    .selectFrom('rooms as r')
    .innerJoin('room_groups as g', 'g.id', 'r.room_group_id')
    .innerJoin('stores as s', 's.id', 'r.store_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('s.code', '=', 'JC001')
    .where('g.code', '=', '4MA')
    .where('r.operating_status', '=', 'active')
    .executeTakeFirstOrThrow()

  await db
    .updateTable('bookings')
    .set({ status: 'expired' })
    .where('client_request_key', 'like', 'concurrency-check-%')
    .where('status', '=', 'draft')
    .execute()
  await db.destroy()

  const unexpected = errors.filter((e) => e !== 'unavailable')
  console.log(`${BURST} simultaneous holds on ${date} 13:00–17:00, 4麻 rooms: ${rooms.n}`)
  console.log(`succeeded: ${ok}, rejected: ${errors.length}`, [...new Set(errors)])
  if (ok > Number(rooms.n) || unexpected.length > 0) {
    console.error('FAIL: overbooking or unexpected errors')
    process.exit(1)
  }
  console.log('OK: no overbooking, losers rejected cleanly')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
