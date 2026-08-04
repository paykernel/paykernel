# Testing the D1 adapter

## Mock D1 (default CI path)

`src/test-utils/mock-d1.ts` implements `D1DatabaseLike` on **bun:sqlite** with:

- `prepare` / `bind` / `first` / `all` / `run`
- `batch` as `BEGIN IMMEDIATE` … `COMMIT` / `ROLLBACK` (mirrors D1 batch atomicity)
- optional `withSession` (constraint recorded for assertions)
- **prepare/bind traces** (`prepareCount`, `bindCount`, `statementTraces`) for proving no param string-concat

### Batch fidelity (mock vs real D1)

| Behavior | Mock (bun:sqlite) | Real D1 |
| -------- | ----------------- | ------- |
| Multi-statement atomicity | `BEGIN IMMEDIATE` … rollback on error | SQL transaction; failure aborts sequence |
| RETURNING via `.all()` / `.first()` | Yes | Yes (prefer over plain writes) |
| Remote latency / size limits | Not modeled | Enforced by platform |
| Read replicas / stale reads | Not modeled (single local DB) | Possible without Sessions |

Prefer **single-statement UPSERT claims** so batch is rarely needed for claim paths.

Mock is **test-only** — production `src/**` (excluding test-utils) never imports `bun:sqlite`.

## Suites (16.6 matrix)

| File | Covers |
| ---- | ------ |
| `public-api.test.ts` | Export freeze, forbidden drivers, manifest honesty |
| `import-no-migrate.test.ts` | No migrate on import / factories |
| `errors.test.ts` | StoreError mapping + secret redaction |
| `stores/stores.unit.test.ts` | Fake executor claim/complete paths |
| `prepared-bind.d1.test.ts` | Binding path + prepare/bind-only (no REST creds) |
| `migrate.d1.test.ts` | migrate/verify + TEXT columns + no BEGIN/COMMIT in packaging |
| `conformance.d1.test.ts` | All three testkit conformance suites + live skip-clean |
| `concurrency.d1.test.ts` | Parallel / multi-instance claims + FakeClock + stale lease |
| `batch.d1.test.ts` | batch commit + rollback (+ fidelity notes) |
| `sessions.d1.test.ts` | withSession / first-primary + stale-read honesty |
| `restart.d1.test.ts` | Durable reopen + lease reclaim / complete after restart |

Unique `tablePrefix` per test run via `uniqueTablePrefix()` from `test-utils/d1-env.ts`.

## Live / miniflare / REST env

`test-utils/d1-env.ts` documents flags:

| Env | Purpose |
| --- | ------- |
| `PAYMENTS_SDK_D1_BINDING_AVAILABLE=1` | Custom Workers/miniflare harness has a real binding |
| `PAYMENTS_SDK_D1_DATABASE_ID` / `D1_DATABASE_ID` | Optional remote D1 id (REST probes only) |
| `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID` | Optional REST account (not for normal binding use) |
| `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` | Optional REST token (never required for unit/conformance) |

Live binding suites **skip cleanly** when env is unset so CI without Workers/D1 stays green. REST account tokens are **not** required for unit/conformance or normal Worker binding operation.

## Run

```bash
cd packages/store-d1
bun test
bun run typecheck
bun run build
```

From monorepo root (safety net including D1):

```bash
bun test packages/store-d1
bun test packages/core packages/testkit packages/webhooks internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite \
  packages/store-turso packages/store-d1
```

## Live Wrangler smoke (real D1 binding)

A Workers smoke harness lives in `smoke/` and exercises the **Workers D1 binding**
path end-to-end (not REST):

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
# create once: bunx wrangler d1 create paykernel-store-smoke
cd packages/store-d1/smoke
# set database_id in wrangler.toml, then:
bunx wrangler deploy
curl -sS https://paykernel-d1-smoke.<subdomain>.workers.dev/health
curl -sS -X POST https://paykernel-d1-smoke.<subdomain>.workers.dev/smoke
```

The `/smoke` endpoint runs migrate, idempotency/webhook/recon claims, batch
commit+rollback, Sessions (`first-primary`), FakeClock lease reclaim, and
parallel reserve single-winner on the real D1 binding.

**Verified live (2026-08-03):** 22/22 steps pass against D1
`paykernel-store-smoke` on the manhali project Cloudflare account
(`createD1PaymentStores({ db: env.PAYMENTS_DB })`).
