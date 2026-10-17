#!/usr/bin/env bash
# Build merged sources in Linux, then upload only the two named beta Workers.
# Mount repository read-only at /src and credential JSON files read-only under /run/secrets/.
set -euo pipefail
mkdir /work
cd /src
tar --exclude=node_modules --exclude=.git --exclude=.next --exclude=.open-next \
  --exclude=.wrangler --exclude=dist --exclude='.env*' --exclude='.dev.vars*' --exclude='*.log' \
  -cf - . | (cd /work && tar xf -)
corepack enable
cd /work
pnpm install --frozen-lockfile
pnpm --filter @jancube/web cf:build
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const auth = JSON.parse(readFileSync('/run/secrets/auth.json', 'utf8'))
for (const app of ['web', 'jobs']) {
  // Only an explicit first-time bootstrap uploads placeholder files. Preserve dashboard updates
  // during subsequent deployments rather than silently replacing real provider credentials.
  const secretArgs = process.env.JANCUBE_UPLOAD_SECRETS === '1'
    ? ['--secrets-file', `/run/secrets/${app}.json`]
    : []
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', 'wrangler.beta.jsonc', ...secretArgs], {
    cwd: `/work/apps/${app}`,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: auth.token, CLOUDFLARE_ACCOUNT_ID: auth.accountId, WRANGLER_SEND_METRICS: 'false' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
JS
