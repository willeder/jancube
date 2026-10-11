/**
 * Development seed data. Values are the dummy data shown in the Figma wireframes, not confirmed
 * master data (real stores/rooms/prices are pending from ActPro, tracker #5/#16).
 */
import 'dotenv/config'
import { createConnection } from 'mysql2/promise'

const url = process.env.DATABASE_URL ?? 'mysql://root:jancube@127.0.0.1:3306/jancube'

const stores = [
  {
    code: 'JC001',
    name: '大阪本町店',
    address: '大阪市中央区瓦町3-2-7 グリーンビル2階',
    access_text: '大阪メトロ「本町駅」徒歩5分(淀屋橋・堺筋本町・北浜も徒歩圏)',
    status: 'open',
  },
  {
    code: 'JC002',
    name: 'なんば店',
    address: '大阪市浪速区難波中2丁目1番7号 なんば東ビル2F',
    access_text: 'なんば駅 徒歩4分',
    status: 'open',
  },
  {
    code: 'JC003',
    name: '梅田店',
    address: '大阪市北区太融寺町5-8 ダイヤモンドレジャービル8F',
    access_text: '梅田エリア',
    status: 'open',
  },
]

async function main() {
  const db = await createConnection({ uri: url, timezone: 'Z' })
  for (const s of stores) {
    await db.query(
      `INSERT INTO stores
         (code, name, address, access_text, timezone, booking_open_date, booking_horizon_days,
          hold_minutes, proxy_hold_minutes, cleaning_buffer_minutes, key_before_minutes,
          key_after_minutes, status, is_active)
       VALUES (?, ?, ?, ?, 'Asia/Tokyo', '2026-10-19', 60, 10, 30, 15, 15, 15, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address),
         access_text = VALUES(access_text), status = VALUES(status), is_active = 1`,
      [s.code, s.name, s.address, s.access_text, s.status],
    )
  }
  console.log(`seeded ${stores.length} stores (dummy data)`)
  await db.end()
}

main().catch((err) => {
  console.error('seed failed:', err.message)
  process.exit(1)
})
