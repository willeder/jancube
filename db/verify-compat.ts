/**
 * Verifies that the schema's guarantees actually hold on a target DB (not just that DDL parsed):
 * table/FK/CHECK counts, generated columns, collation, and enforcement of a CHECK and an FK.
 *   pnpm tsx db/verify-compat.ts mysql|tidb
 */
import 'dotenv/config'
import { createConnection } from 'mysql2/promise'

const target = process.argv[2] ?? 'mysql'
const url =
  target === 'tidb' ? (process.env.TIDB_URL as string) : (process.env.DATABASE_URL as string)

async function main() {
  const db = await createConnection({ uri: url })
  const one = async (sql: string) =>
    Object.values(((await db.query(sql))[0] as Record<string, unknown>[])[0] ?? {})[0]
  const schema = new URL(url).pathname.slice(1)
  const report: Record<string, unknown> = {
    version: await one('SELECT VERSION()'),
    tables: await one(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${schema}' AND table_name<>'schema_migrations'`,
    ),
    foreignKeys: await one(
      `SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='${schema}'`,
    ),
    checkConstraints: await one(
      `SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema='${schema}'`,
    ),
    generatedColumns: await one(
      `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='${schema}' AND generation_expression IS NOT NULL AND generation_expression <> ''`,
    ),
    storesCollation: await one(
      `SELECT table_collation FROM information_schema.tables WHERE table_schema='${schema}' AND table_name='stores'`,
    ),
  }
  const enforced = async (label: string, sql: string) => {
    try {
      await db.query(sql)
      report[label] = 'NOT ENFORCED'
    } catch (e) {
      report[label] = `enforced (${(e as Error).message.slice(0, 60)})`
    }
  }
  await db.query('START TRANSACTION')
  await db.query(
    `INSERT INTO stores (code, name, address, booking_open_date, booking_horizon_days, hold_minutes, proxy_hold_minutes, cleaning_buffer_minutes, key_before_minutes, key_after_minutes) VALUES ('ZZ-T','t','t','2026-01-01',60,10,30,15,15,15)`,
  )
  const [[{ id: storeId }]] = (await db.query(
    `SELECT id FROM stores WHERE code='ZZ-T'`,
  )) as unknown as [[{ id: number }]]
  await enforced(
    'checkWeekday',
    `INSERT INTO store_business_hours (store_id, weekday, opens_minute, closes_minute) VALUES (${storeId}, 9, 600, 1440)`,
  )
  await enforced('checkStoreStatus', `UPDATE stores SET status='bogus' WHERE id=${storeId}`)
  await enforced(
    'fkBusinessHours',
    `INSERT INTO store_business_hours (store_id, weekday, opens_minute, closes_minute) VALUES (999999, 1, 600, 1440)`,
  )
  await db.query('ROLLBACK')
  console.log(target, JSON.stringify(report, null, 2))
  await db.end()
  if (
    ['checkWeekday', 'checkStoreStatus', 'fkBusinessHours'].some(
      (key) => !String(report[key]).startsWith('enforced ('),
    )
  )
    throw new Error('Database constraints are not enforced')
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
