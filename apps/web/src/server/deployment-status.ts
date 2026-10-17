/**
 * Keep an account-bootstrap deployment usable before external credentials and TiDB exist.
 * This gate runs before Next.js, including admin routes, server actions and payment webhooks.
 * A missing database binding always closes the gate, even if setup mode was cleared too early.
 */
export function deploymentSetupResponse(
  request: Request,
  env: Readonly<Record<string, unknown>>,
): Response | null {
  if (env.BETA_SETUP_MODE !== '1' && env.HYPERDRIVE) return null
  const headers = {
    'Cache-Control': 'no-store',
    'Retry-After': '3600',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  }
  if (new URL(request.url).pathname === '/healthz') {
    return Response.json({ status: 'setup_required', ready: false }, { status: 503, headers })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ error: 'beta_setup_required' }, { status: 503, headers })
  }
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>雀CUBE — ベータ版準備中</title><style>body{margin:0;background:#f7faf8;color:#16342b;font:16px/1.7 system-ui,sans-serif}main{max-width:560px;margin:12vh auto;padding:32px}small{color:#4d685e}h1{font-size:28px}section{padding:28px;background:white;border:1px solid #dbe7df;border-radius:16px}</style><main><small>JANCUBE · BETA</small><section><h1>ベータ版を準備しています</h1><p>ただいま環境設定を行っています。予約受付はまだ開始していません。</p><p lang="en">Deployment is online. Database and service configuration is pending; bookings are not open yet.</p></section></main></html>`
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  })
}
