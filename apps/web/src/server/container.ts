import 'server-only'
import { createDb } from '@jancube/infrastructure'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { buildDeps } from './deps'
import { adminFeatures } from './features/admin'
import { adminBookingFeatures } from './features/admin-bookings'
import { adminMasterFeatures } from './features/admin-masters'
import { customerBookingFeatures } from './features/customer-booking'
import { customerMyPageFeatures } from './features/customer-mypage'
import { lineReportsFeatures } from './features/line-reports'
import { operationsFeatures } from './features/operations'
import { runtimeConfig } from './runtime-config'

/**
 * Composition root: the only place where the framework/runtime meets the business logic.
 * Pages, route handlers and server actions call use cases from here; they never touch the database
 * or SDKs directly. `server-only` makes the build fail if this is imported into client code.
 *
 * Shared adapters are built in `deps.ts`; each feature area wires its use cases in
 * `features/<area>.ts` and is spread in here.
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
  const deps = buildDeps(db, runtimeConfig())
  return {
    ...customerBookingFeatures(deps),
    ...customerMyPageFeatures(deps),
    ...adminFeatures(deps),
    ...adminBookingFeatures(deps),
    ...operationsFeatures(deps),
    ...lineReportsFeatures(deps),
    ...adminMasterFeatures(deps),
  }
}

export type Container = ReturnType<typeof buildContainer>
