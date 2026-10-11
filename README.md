# 雀CUBE 予約システム (Phase 1)

TanStack Start on Cloudflare Workers · TiDB Cloud (MySQL-compatible) via Hyperdrive · Resend (email) · SMSLINK (SMS)

## Architecture

Business logic is kept independent of the framework, as agreed with the client.

```
apps/web                 TanStack Start (UI, server functions). Composition root: src/server/container.ts
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

Routes and server functions call use cases from the container; they never query the database directly.

## Prerequisites

- Node 24, pnpm 10
- Docker Desktop (local MySQL / TiDB)

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
| `pnpm dev` | Web app (Vite + workerd, Hyperdrive → local MySQL) |
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
- Stripe/PayPay, LINE, smart lock (SmartRooming Connect API): ports to be added with each feature.
- Hyperdrive id in `wrangler.jsonc` is a placeholder until the production Hyperdrive config exists.
