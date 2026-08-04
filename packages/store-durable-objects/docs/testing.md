# Testing (Durable Object adapter)

**Package:** `@paykernel/store-durable-objects`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md)

Default CI path uses **mock DO SQL** (no Workers runtime). Live/miniflare suites **skip cleanly** when env is unset.

---

## Mock DO SQL (default CI)

`src/test-utils/mock-do-sql.ts` backs `DoStorageLike` with **bun:sqlite** (test-only; production root never imports `bun:sqlite`).

| Behavior | Mock policy |
| -------- | ----------- |
| `sql.exec` | Sync query/write with `?` binds |
| `transactionSync` | `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` |
| Promise return from txn callback | **Rejected** (sync-only policy) |
| Alarms | Optional mock `setAlarm` / `getAlarm` / `deleteAlarm` |
| Cursor | Fully consumed before return (cursor-before-await) |

## Mock namespace (sharding / partitions)

`createMockDoNamespace` materializes one mock storage + `PaymentsStoreObject` per object name for:

- **Same-key concurrency** — one winner under concurrent reserve
- **Cross-partition isolation** — different shards do not share rows
- **Worker client path** — async stub RPC over mock namespace

## FakeClock / leases

Stores accept an injectable **clock** (`now` / FakeClock-compatible). Conformance and restart tests advance time to reclaim expired leases without wall-clock waits.

```ts
import { FakeClock } from "@paykernel/testkit";

const clock = new FakeClock();
// createDoIdempotencyStore({ executor, clock, … })
// clock.advance(leaseMs + 1)
```

## Conformance

```ts
await migrateDoAdapter(executor, { namespace: { tablePrefix } });
await runIdempotencyStoreConformanceSuite({
  /* createDoIdempotencyStore + FakeClock */
});
await runWebhookInboxStoreConformanceSuite({ /* … */ });
await runReconciliationStoreConformanceSuite({ /* … */ });
```

Also covered in-package (17.5 matrix):

| File | Coverage |
| ---- | -------- |
| `conformance.do.test.ts` | All three Phase 9 suites + live skip-clean |
| `concurrency.do.test.ts` | Same-key winner, multi-instance, stale lease, FakeClock reclaim, recon claim |
| `partitions.do.test.ts` | Hash partition isolation, key serialization, tenant isolation |
| `transaction.do.test.ts` | Rollback, no BEGIN/COMMIT via exec, sync-only, external-work-outside-txn static |
| `restart.do.test.ts` | File reopen durability + FakeClock reclaim after eviction |
| `alarms.do.test.ts` | One alarm/queue, backoff, maxRetries, at-least-once, default-off |
| `import-no-migrate.test.ts` | Import does not migrate |

Use unique `tablePrefix` per test via `uniqueTablePrefix()`.

## Live / miniflare env flags

Clean skip when unset (`hasLiveDo`, `hasDoBindingRuntime` in `src/test-utils/do-env.ts`):

| Variable | Purpose |
| -------- | ------- |
| `PAYMENTS_DO_LIVE=1` / `CLOUDFLARE_DO_LIVE=1` | Optional live DO path |
| `PAYMENTS_SDK_DO_BINDING_AVAILABLE=1` | Custom miniflare / vitest-pool-workers harness |
| `MINIFLARE=1` / `VITEST_POOL_WORKERS=1` | Runtime presence flags |

No `CLOUDFLARE_API_TOKEN` / account ID required for mock or normal Worker binding operation.  
Do not fail CI when Workers/miniflare is not configured.

## Live Wrangler smoke (real DO binding — Manhali.official)

A Workers smoke harness lives in `smoke/` and exercises the **Workers Durable Object
binding** (SQLite-backed `new_sqlite_classes`) on the Manhali.official Cloudflare account.

```bash
export CLOUDFLARE_ACCOUNT_ID=7829eb5cf7fce3400fe7aa222a942682
cd packages/store-durable-objects/smoke
bunx wrangler deploy
curl -sS https://paykernel-do-smoke.<subdomain>.workers.dev/health
curl -sS https://paykernel-do-smoke.<subdomain>.workers.dev/smoke
```

Smoke covers: DO binding, hash/key sharding, atomic reserve/complete, fingerprint
conflict, parallel same-key single winner, partition isolation, short-lease reclaim,
stale lease rejection, webhook/recon claim paths, optional alarm enqueue + drain.

Notes:

- DO RPC must call methods as `stub.method(...)` — never `Function.prototype.apply/call`
  (Workers treats `apply` as an RPC method name).
- Platform method name `alarm` is reserved — use an app RPC like `drainAlarms` for
  deterministic tests; do not call `stub.alarm()` over RPC.
- `setAlarm(past)` can fire the platform `alarm()` before a follow-up RPC returns;
  smoke platform `alarm()` only re-schedules so explicit `drainAlarms` remains testable.

## Related

- [transactions.md](./transactions.md) — sync-only `transactionSync`  
- [sharding.md](./sharding.md) — partition strategies under test  
- [alarms.md](./alarms.md) — at-least-once alarm handler rules  
- [migrations.md](./migrations.md) — explicit migrate only  
