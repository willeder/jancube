import { env } from 'cloudflare:workers'
import { makeListStores } from '@jancube/application'
import { createDb, KyselyStoreRepository } from '@jancube/infrastructure'

/**
 * Composition root: the only place where the framework/runtime meets the business logic.
 * Routes and server functions call use cases from here; they never touch the database or SDKs.
 *
 * Workers cannot share I/O objects between requests, so a container is built per request and its
 * database pool is closed afterwards. Hyperdrive does the real connection pooling.
 */
export async function withContainer<T>(fn: (c: Container) => Promise<T>): Promise<T> {
  const db = createDb(env.HYPERDRIVE.connectionString)
  try {
    return await fn(buildContainer(db))
  } finally {
    await db.destroy()
  }
}

function buildContainer(db: ReturnType<typeof createDb>) {
  return {
    listStores: makeListStores({ stores: new KyselyStoreRepository(db) }),
  }
}

export type Container = ReturnType<typeof buildContainer>
