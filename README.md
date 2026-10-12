# 雀CUBE 予約システム (Phase 1)

Next.js 16.3.8 (App Router) on Cloudflare Workers via OpenNext · TiDB Cloud (MySQL-compatible) via Hyperdrive · Resend (email) · SMSLINK (SMS)

## Architecture

Business logic is kept independent of the framework, as agreed with the client.

```
apps/web                 Next.js App Router (pages, route handlers, server actions). Composition root: src/server/container.ts
apps/jobs                Cloudflare Worker for cron batches / queues
packages/domain          Pure business rules: pricing, cancellation, time ranges. No dependencies.
packages/application     Use cases + ports (interfaces for DB, SMS, email, payments, lock)
packages/infrastructure  Adapters: Kysely repositories, Resend, SMSLINK, dev console senders
db/                      SQL migrations, seed data, migration runner, DB compatibility check
```

Dependency direction (enforced by `pnpm check:boundaries`):

```
domain  ←  application  ←  infrastructure  ←  apps
```

- `domain` imports nothing (no npm packages, no other layers).
- `application` imports only `domain`. It defines ports; it never imports Kysely, Stripe, Cloudflare, etc.
- `infrastructure` implements ports. Apps wire everything together per request.

Pages, route handlers and server actions call use cases from the container (`server-only`); they never
query the database directly. `check:boundaries` fails if anything under `apps/web/src/app` imports the
infrastructure package, Kysely or mysql2.

## Prerequisites

- Node 24, pnpm 10
- Docker Desktop (local MySQL / TiDB, and Linux production-build preview)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm db:up          # MySQL 8.4 on :3306
pnpm db:migrate     # apply db/migrations
pnpm db:seed        # dummy stores from the wireframes
pnpm dev            # http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web app (`next dev`, Cloudflare bindings via OpenNext; Hyperdrive → local MySQL) |
| `pnpm preview:linux` | Production build with OpenNext, served in workerd on http://localhost:8790 (runs in Docker) |
| `pnpm dev:jobs` | Jobs Worker; trigger crons via `/__scheduled?cron=...` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm check:boundaries` | Fails if a layer imports something it must not |
| `pnpm check` | All of the above |
| `pnpm db:migrate` / `db:seed` / `db:reset` | Local database |
| `pnpm db:codegen` | Regenerate Kysely types from the local DB after a migration |
| `pnpm db:verify` | Check tables, foreign keys, CHECK constraints, generated columns, collation on MySQL |
| `pnpm db:tidb:up` / `db:tidb:check` | Apply the schema to a local TiDB container and run the same checks |
| `pnpm line:rich-menu` | Create the LINE rich menu (L-01); see docs/line-setup.md |

## Next.js / OpenNext notes

- Next.js is pinned to **16.3.8**. Next.js 16.4.0 currently returns HTTP 500 on Cloudflare with OpenNext
  1.20.10 (`Unexpected loadManifest(/.next/server/preview-props.json)`). Upgrade only after OpenNext
  supports the new version, and verify with `pnpm preview:linux`.
- **The OpenNext build does not run on native Windows** (it creates symlinks, which Windows blocks without
  admin/Developer Mode). `next dev` works on Windows; production builds run on Linux: `pnpm preview:linux`
  locally, GitHub Actions in CI, or WSL.
- Cloudflare bindings are read with `getCloudflareContext()`; types come from
  `wrangler types --env-interface CloudflareEnv` (run automatically by `build` and `typecheck`).
- Node.js middleware is not supported by OpenNext on Cloudflare; use the default (edge) middleware if needed.

## Database notes

- Schema: `db/migrations/0001_phase1_schema.sql` = client file `jancube_phase1.sql` (v0.2) with the
  `weekday IN (0,1)` constraint removed (tracker #19).
- **TiDB silently ignores CHECK constraints unless `tidb_enable_check_constraint = ON`.** Verified on
  TiDB v8.5.7: with it ON, all 158 CHECKs are created and enforced; 116 foreign keys, 5 generated
  columns and `utf8mb4_0900_ai_ci` work as on MySQL. `db/migrate.ts` refuses to run on TiDB if the
  setting is OFF. Confirm it can be enabled on the TiDB Cloud Starter cluster before the first deploy.
- TiDB reports CHECK constraints in `SHOW CREATE TABLE`, not in `information_schema.table_constraints`.
- Times are stored in UTC (`DATETIME(6)`); business-day rules are evaluated in the store's timezone.

## Not yet wired

- SMSLINK adapter: waiting for the API specification (`SmslinkSmsSender` throws until implemented).
- Stripe/PayPay, smart lock (SmartRooming Connect API): ports to be added with each feature.
- LINE / LIFF: implemented; switched on by environment variables (docs/line-setup.md). Deployment,
  monitoring, backups, reports/CSV definitions: docs/operations.md.
- Hyperdrive id in `wrangler.jsonc` is a placeholder until the production Hyperdrive config exists.
