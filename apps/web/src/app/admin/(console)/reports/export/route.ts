import { DomainError } from '@jancube/domain'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { requireStaff } from '@/server/admin-session'
import { withContainer } from '@/server/container'

export const dynamic = 'force-dynamic'

/**
 * A-27 / A-24 CSV download: GET /admin/reports/export?type=…&from=…&to=…[&store=id]. The file is
 * streamed (UTF-8 with BOM, CRLF) while rows are read in pages, so long periods do not need to fit
 * in memory. Errors before the first byte return to the screen with `?error=<code>`.
 */
export async function GET(request: Request) {
  const staff = await requireStaff()
  const url = new URL(request.url)
  const p = url.searchParams
  const type = p.get('type') ?? ''
  const store = Number(p.get('store'))
  const back = new URL(type === 'audit_logs' ? '/admin/audit' : '/admin/reports', url)
  for (const key of ['from', 'to', 'actor', 'action', 'target']) {
    const value = p.get(key)
    if (value) back.searchParams.set(key, value)
  }

  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  let started: (filename: string) => void = () => {}
  const filename = new Promise<string>((resolve) => {
    started = resolve
  })

  // The container (and its database pool) stays open until the last row has been written.
  const work = withContainer(async (c) => {
    const file = await c.exportReport(staff, {
      type,
      from: p.get('from') ?? '',
      to: p.get('to') ?? '',
      storeId: Number.isSafeInteger(store) && store > 0 ? store : null,
      audit: { actor: p.get('actor'), action: p.get('action'), target: p.get('target') },
    })
    started(file.filename)
    for await (const chunk of file.chunks) {
      await writer.ready
      await writer.write(encoder.encode(chunk))
    }
    await writer.close()
  }).catch(async (error: unknown) => {
    await writer.abort(error).catch(() => {})
    throw error
  })

  let name: string
  try {
    name = await Promise.race([
      filename,
      work.then(() => {
        throw new Error('export finished without a file')
      }),
    ])
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'export_failed'
    if (!(error instanceof DomainError)) console.error('csv export failed:', error)
    back.searchParams.set('error', code)
    return Response.redirect(back, 303)
  }
  work.catch((error: unknown) => console.error('csv export stopped:', error))
  try {
    getCloudflareContext().ctx.waitUntil(work.catch(() => {}))
  } catch {
    // Not on Workers (e.g. unit tooling): the stream itself keeps the request alive.
  }

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
