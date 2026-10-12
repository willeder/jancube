#!/usr/bin/env bash
# Builds apps/web with OpenNext inside Linux and serves it in the Workers runtime (workerd).
# OpenNext's build creates symlinks, which native Windows does not allow without admin rights,
# so production builds run here (or in CI) instead of on the Windows host.
set -euo pipefail

echo "› copying sources (excluding host node_modules/build output)"
rm -rf /work && mkdir -p /work
cd /src
tar --exclude=node_modules --exclude=.next --exclude=.open-next --exclude=.wrangler --exclude=dist -cf - . |
  (cd /work && tar xf -)

corepack enable >/dev/null 2>&1
cd /work
echo "› installing dependencies"
pnpm install --frozen-lockfile

echo "› building with OpenNext"
cd apps/web
pnpm exec opennextjs-cloudflare build

echo "› serving production build on http://localhost:8790"
exec pnpm exec wrangler dev --ip 0.0.0.0 --port 8790
