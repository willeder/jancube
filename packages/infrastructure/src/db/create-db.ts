import { Kysely, MysqlDialect, type MysqlPool } from 'kysely'
import { createPool } from 'mysql2'
import type { DB } from './schema.generated'

export type Database = Kysely<DB>

/**
 * Creates a Kysely instance over a MySQL-compatible connection string.
 * - Cloudflare Workers: pass `env.HYPERDRIVE.connectionString` (Hyperdrive pools to TiDB).
 * - Node scripts/tests: pass DATABASE_URL.
 * `disableEval` is required in the Workers runtime, where mysql2 cannot use eval-based parsers.
 */
export function createDb(
  connectionString: string,
  options: { maxConnections?: number } = {},
): Database {
  const pool = createPool({
    uri: connectionString,
    disableEval: true,
    connectionLimit: options.maxConnections ?? 5,
    timezone: 'Z',
    dateStrings: false,
  })
  // mysql2 ≥3.20 typings no longer match Kysely's structural MysqlPool type; the runtime API is the same.
  return new Kysely<DB>({ dialect: new MysqlDialect({ pool: pool as unknown as MysqlPool }) })
}
