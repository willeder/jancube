/**
 * Applies db/migrations/*.sql in filename order and records them in `schema_migrations`.
 *
 *   pnpm db:migrate                 → local MySQL (DATABASE_URL)
 *   pnpm db:migrate --reset         → drop and recreate the database first (local only)
 *   pnpm db:tidb:check              → apply everything to the local TiDB container (TIDB_URL)
 */
import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createConnection } from 'mysql2/promise'

const args = new Set(process.argv.slice(2))
const target = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : 'mysql'
const reset = args.has('--reset')

const url =
  target === 'tidb'
    ? (process.env.TIDB_URL ?? 'mysql://root@127.0.0.1:4000/jancube')
    : (process.env.DATABASE_URL ?? 'mysql://root:jancube@127.0.0.1:3306/jancube')

const parsed = new URL(url)
const database = parsed.pathname.replace(/^\//, '')
if (!database) throw new Error('Connection URL must include a database name')

const isLocal = ['127.0.0.1', 'localhost'].includes(parsed.hostname)
if (reset && !isLocal) throw new Error('--reset is only allowed against a local database')

const migrationsDir = join(import.meta.dirname, 'migrations')

async function main() {
  const server = await createConnection({
    uri: url.replace(parsed.pathname, '/'),
    multipleStatements: true,
  })
  if (reset) {
    await server.query(`DROP DATABASE IF EXISTS \`${database}\``)
    console.log(`dropped ${database}`)
  }
  await server.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  )
  await server.end()

  const db = await createConnection({ uri: url, multipleStatements: true, timezone: 'Z' })
  await assertCheckConstraintsEnforced(db)
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(191) NOT NULL PRIMARY KEY,
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`)
  const [rows] = await db.query('SELECT version FROM schema_migrations')
  const applied = new Set((rows as { version: string }[]).map((r) => r.version))

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  let count = 0
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    process.stdout.write(`applying ${file} … `)
    await db.query(sql)
    await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [file])
    console.log('ok')
    count++
  }
  console.log(
    `${target}: ${count} migration(s) applied, ${files.length - count} already up to date`,
  )
  await db.end()
}

/**
 * TiDB accepts CHECK constraints but silently drops them unless tidb_enable_check_constraint is ON
 * (verified locally on v8.5.7). The schema relies on 158 CHECKs, so refuse to migrate without it.
 */
async function assertCheckConstraintsEnforced(db: Awaited<ReturnType<typeof createConnection>>) {
  const [[row]] = (await db.query('SELECT VERSION() AS v')) as unknown as [[{ v: string }]]
  if (!row.v.includes('TiDB')) return
  const [vars] = (await db.query(
    "SHOW GLOBAL VARIABLES LIKE 'tidb_enable_check_constraint'",
  )) as unknown as [{ Value: string }[]]
  if (vars[0]?.Value !== 'ON') {
    throw new Error(
      'TiDB has tidb_enable_check_constraint=OFF, so CHECK constraints would be silently dropped. ' +
        'Run: SET GLOBAL tidb_enable_check_constraint = ON;',
    )
  }
}

main().catch((err) => {
  console.error(`\nmigration failed on ${target}:`, err.message)
  process.exit(1)
})
