/**
 * L-01 リッチメニュー: creates the rich menu of the official account with the Messaging API and makes
 * it the default for every user (docs/line-setup.md).
 *
 *   pnpm line:rich-menu --dry-run                      → print the menu that would be created
 *   pnpm line:rich-menu --image path/to/menu.png       → validate, create, upload image, set default
 *   pnpm line:rich-menu --image menu.png --replace     → also delete older menus with the same name
 *
 * Environment: LINE_CHANNEL_ACCESS_TOKEN (Messaging API channel), LIFF_ID.
 * Image: 2500×843 px, PNG or JPEG, at most 1 MB, three equal columns (予約する / 予約確認 / お問い合わせ).
 */
import 'dotenv/config'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

const API = 'https://api.line.me/v2/bot'
const DATA_API = 'https://api-data.line.me/v2/bot'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set (see docs/line-setup.md)`)
  return value
}

async function call(url: string, init: RequestInit & { token: string }) {
  const { token, ...rest } = init
  const res = await fetch(url, {
    ...rest,
    headers: { Authorization: `Bearer ${token}`, ...(rest.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} failed: ${res.status} ${text}`)
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

async function main() {
  const liffId = required('LIFF_ID')
  if (!/^[0-9]+-[A-Za-z0-9]+$/.test(liffId))
    throw new Error('LIFF_ID looks wrong (e.g. 1234567890-AbCdEfGh)')
  const template = await readFile(join(import.meta.dirname, 'line-rich-menu.json'), 'utf8')
  const menu = JSON.parse(
    template.replaceAll('{{LIFF_URL}}', `https://liff.line.me/${liffId}`),
  ) as {
    name: string
  }
  if (flag('--dry-run')) {
    console.log(JSON.stringify(menu, null, 2))
    return
  }

  const token = required('LINE_CHANNEL_ACCESS_TOKEN')
  const image = option('--image')
  if (!image) throw new Error('pass --image <png|jpeg file> (2500x843, max 1 MB)')
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[
    extname(image).toLowerCase()
  ]
  if (!type) throw new Error('the image must be .png or .jpg')
  if ((await stat(image)).size > 1024 * 1024) throw new Error('the image must be 1 MB or smaller')

  const json = { 'Content-Type': 'application/json' }
  await call(`${API}/richmenu/validate`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(menu),
    token,
  })
  const { richMenuId } = (await call(`${API}/richmenu`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(menu),
    token,
  })) as { richMenuId: string }
  console.log(`created rich menu ${richMenuId}`)

  await call(`${DATA_API}/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: await readFile(image),
    token,
  })
  console.log('uploaded image')

  await call(`${API}/user/all/richmenu/${richMenuId}`, { method: 'POST', token })
  console.log('set as default rich menu')

  if (flag('--replace')) {
    const { richmenus } = (await call(`${API}/richmenu/list`, { token })) as {
      richmenus: { richMenuId: string; name: string }[]
    }
    for (const old of richmenus.filter(
      (m) => m.name === menu.name && m.richMenuId !== richMenuId,
    )) {
      await call(`${API}/richmenu/${old.richMenuId}`, { method: 'DELETE', token })
      console.log(`deleted old rich menu ${old.richMenuId}`)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
