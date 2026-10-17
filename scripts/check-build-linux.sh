#!/usr/bin/env bash
# Build-only Cloudflare verification in an isolated Linux container. Never deploys or reads secrets.
# Mount the repository read-only at /src in a fresh node:24-bookworm container.
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
cd apps/jobs
pnpm exec wrangler deploy --dry-run --outdir /work/jobs-build
