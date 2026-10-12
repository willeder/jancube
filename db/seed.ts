/**
 * Development seed data — NOT confirmed master data.
 * Stores/rooms follow the Figma wireframes; prices follow ActPro prototype v0.6 (A-16, JC001 現行).
 * Real stores/rooms/prices are pending from ActPro (tracker #5/#16). Safe to re-run.
 */
import 'dotenv/config'
import { createConnection } from 'mysql2/promise'

const url = process.env.DATABASE_URL ?? 'mysql://root:jancube@127.0.0.1:3306/jancube'

type Rm = { code: string; group: GroupCode; status?: 'active' | 'paused' | 'broken' }
type GroupCode = '4MA' | '3MA' | 'CONCEPT' | 'VIP'

const roomTypes = [
  { code: '4MA', name: '4麻', capacity: 4 },
  { code: '3MA', name: '3麻', capacity: 3 },
  { code: 'CONCEPT', name: 'コンセプト', capacity: 4 },
  { code: 'VIP', name: 'VIP', capacity: 4 },
] as const

const groups: { code: GroupCode; name: string; mode: 'group' | 'named'; sort: number }[] = [
  { code: '4MA', name: '4麻ルーム', mode: 'group', sort: 1 },
  { code: '3MA', name: '3麻ルーム', mode: 'group', sort: 2 },
  { code: 'CONCEPT', name: 'コンセプトルーム', mode: 'named', sort: 3 },
  { code: 'VIP', name: 'VIPルーム', mode: 'named', sort: 4 },
]

const range = (from: number, to: number, group: GroupCode): Rm[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ code: `Room${from + i}`, group }))

const stores: {
  code: string
  name: string
  address: string
  access_text: string
  rooms: Rm[]
}[] = [
  {
    code: 'JC001',
    name: '大阪本町店',
    address: '大阪市中央区瓦町3-2-7 グリーンビル2階',
    access_text: '大阪メトロ「本町駅」徒歩5分(淀屋橋・堺筋本町・北浜も徒歩圏)',
    rooms: [
      { code: 'Room1', group: '4MA' },
      { code: 'Room2', group: '4MA' },
      { code: 'Room3', group: '3MA' },
      { code: 'Room4', group: '3MA' },
      { code: 'Room5', group: 'CONCEPT' },
      { code: 'Room6', group: '4MA' },
      { code: 'Room7', group: '4MA', status: 'paused' },
      { code: 'Room8', group: '4MA' },
      { code: 'Room9', group: '4MA' },
      { code: 'Room10', group: '3MA' },
      { code: 'Room11', group: 'CONCEPT', status: 'broken' },
      { code: 'Room12', group: 'VIP' },
    ],
  },
  {
    code: 'JC002',
    name: 'なんば店',
    address: '大阪市浪速区難波中2丁目1番7号 なんば東ビル2F',
    access_text: 'なんば駅 徒歩4分',
    rooms: [...range(1, 10, '4MA'), ...range(11, 16, '3MA'), ...range(17, 18, 'VIP')],
  },
  {
    code: 'JC003',
    name: '梅田店',
    address: '大阪市北区太融寺町5-8 ダイヤモンドレジャービル8F',
    access_text: '梅田エリア',
    rooms: [...range(1, 1, 'VIP'), ...range(2, 8, '4MA'), ...range(9, 13, '3MA')],
  },
]

const priceProfiles = [
  {
    code: 'STANDARD',
    name: 'スタンダード(JC001現行・サンプル)',
    hourly: 1_500,
    packages: [
      [240, 5_800],
      [300, 7_000],
      [360, 8_200],
      [480, 10_800],
      [600, 13_500],
      [840, 16_000],
    ],
  },
  {
    code: 'VIP_X',
    name: 'VIP - Xタイプ(サンプル)',
    hourly: 2_500,
    packages: [
      [240, 9_500],
      [360, 13_500],
      [480, 17_800],
      [840, 26_000],
    ],
  },
] as const

async function main() {
  const db = await createConnection({ uri: url, timezone: 'Z' })
  const id = async (sql: string, params: unknown[]) => {
    const [rows] = (await db.query(sql, params)) as unknown as [{ id: number }[]]
    const row = rows[0]
    if (!row) throw new Error(`not found: ${sql} ${JSON.stringify(params)}`)
    return row.id
  }

  await db.beginTransaction()
  try {
    for (const t of roomTypes) {
      await db.query(
        `INSERT INTO room_types (code, name, capacity) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), capacity = VALUES(capacity)`,
        [t.code, t.name, t.capacity],
      )
    }

    const versionIds: Record<string, number> = {}
    for (const p of priceProfiles) {
      await db.query(
        `INSERT INTO price_profiles (code, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [p.code, p.name],
      )
      const profileId = await id('SELECT id FROM price_profiles WHERE code = ?', [p.code])
      await db.query(
        `INSERT INTO price_profile_versions
           (price_profile_id, version_no, status, hourly_amount, minimum_minutes, valid_from, tax_rate, published_at)
         VALUES (?, 1, 'published', ?, 60, '2026-01-01 00:00:00', 10.00, UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE hourly_amount = VALUES(hourly_amount), status = 'published'`,
        [profileId, p.hourly],
      )
      const versionId = await id(
        'SELECT id FROM price_profile_versions WHERE price_profile_id = ? AND version_no = 1',
        [profileId],
      )
      versionIds[p.code] = versionId
      for (const [minutes, amount] of p.packages) {
        await db.query(
          `INSERT INTO price_packages (price_version_id, duration_minutes, package_amount) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE package_amount = VALUES(package_amount)`,
          [versionId, minutes, amount],
        )
      }
    }

    for (const s of stores) {
      await db.query(
        `INSERT INTO stores
           (code, name, address, access_text, timezone, booking_open_date, booking_horizon_days,
            hold_minutes, proxy_hold_minutes, cleaning_buffer_minutes, key_before_minutes,
            key_after_minutes, status, is_active)
         VALUES (?, ?, ?, ?, 'Asia/Tokyo', '2026-10-19', 60, 10, 30, 15, 15, 15, 'open', 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address),
           access_text = VALUES(access_text), status = 'open', is_active = 1`,
        [s.code, s.name, s.address, s.access_text],
      )
      const storeId = await id('SELECT id FROM stores WHERE code = ?', [s.code])

      for (let weekday = 0; weekday <= 6; weekday++) {
        await db.query(
          `INSERT INTO store_business_hours (store_id, weekday, opens_minute, closes_minute)
           VALUES (?, ?, 600, 1440)
           ON DUPLICATE KEY UPDATE opens_minute = 600, closes_minute = 1440, is_closed = 0`,
          [storeId, weekday],
        )
      }

      const groupIds: Partial<Record<GroupCode, number>> = {}
      for (const g of groups) {
        if (!s.rooms.some((r) => r.group === g.code)) continue
        const typeId = await id('SELECT id FROM room_types WHERE code = ?', [g.code])
        await db.query(
          `INSERT INTO room_groups (store_id, room_type_id, code, name, booking_mode, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), booking_mode = VALUES(booking_mode),
             sort_order = VALUES(sort_order)`,
          [storeId, typeId, g.code, g.name, g.mode, g.sort],
        )
        groupIds[g.code] = await id('SELECT id FROM room_groups WHERE store_id = ? AND code = ?', [
          storeId,
          g.code,
        ])
      }

      for (const [index, r] of s.rooms.entries()) {
        const typeId = await id('SELECT id FROM room_types WHERE code = ?', [r.group])
        const named = r.group === 'CONCEPT' || r.group === 'VIP' ? 1 : 0
        await db.query(
          `INSERT INTO rooms (store_id, room_group_id, room_type_id, code, name, operating_status,
             cleaning_status, is_named_booking, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, 'clean', ?, ?)
           ON DUPLICATE KEY UPDATE room_group_id = VALUES(room_group_id), room_type_id = VALUES(room_type_id),
             operating_status = VALUES(operating_status), is_named_booking = VALUES(is_named_booking),
             sort_order = VALUES(sort_order)`,
          [
            storeId,
            groupIds[r.group],
            typeId,
            r.code,
            r.code,
            r.status ?? 'active',
            named,
            index + 1,
          ],
        )
        const roomId = await id('SELECT id FROM rooms WHERE store_id = ? AND code = ?', [
          storeId,
          r.code,
        ])
        await db.query('DELETE FROM price_assignments WHERE room_id = ?', [roomId])
        await db.query(
          `INSERT INTO price_assignments (price_version_id, room_id, valid_from) VALUES (?, ?, '2026-01-01 00:00:00')`,
          [r.group === 'VIP' ? versionIds.VIP_X : versionIds.STANDARD, roomId],
        )
      }
    }
    await db.commit()
  } catch (err) {
    await db.rollback()
    throw err
  }
  const rooms = stores.reduce((n, s) => n + s.rooms.length, 0)
  console.log(
    `seeded ${stores.length} stores, ${rooms} rooms, ${priceProfiles.length} price profiles (dummy data)`,
  )
  await db.end()
}

main().catch((err) => {
  console.error('seed failed:', err.message)
  process.exit(1)
})
