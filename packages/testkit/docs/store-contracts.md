# Store contracts and adapter manifests (Phase 9)

**Package:** `@paykernel/testkit`  
**Source of truth:** [`contracts.ts`](../src/storage/contracts.ts), [`adapter-manifest.ts`](../src/storage/adapter-manifest.ts)  
**Conformance:** [`idempotency-conformance.ts`](../src/storage/idempotency-conformance.ts), [`webhook-inbox-conformance.ts`](../src/storage/webhook-inbox-conformance.ts), [`reconciliation-conformance.ts`](../src/storage/reconciliation-conformance.ts)  
**Memory reference impl:** [`packages/testkit/src/memory/memory-stores.ts`](../src/memory/memory-stores.ts)

This document formalizes **Phase 9 — Store Contracts and Adapter Manifests**: storage semantics are defined and self-proved **before** any production database adapter ships.

---

## 1. Purpose

Phase 9 defines **exact storage semantics BEFORE any production database adapter ships**. Three separate lease-aware store contracts underpin webhook inbox workers, mutation idempotency, and reconciliation jobs:

1. Interfaces and record shapes (methods, lease fields, result discriminants).
2. Atomic claim rules (engine-level; **not** application get-then-set).
3. Fencing (monotonic `generation` + unguessable `leaseToken`).
4. Error taxonomy (`StoreErrorCode` + subclasses).
5. Adapter guarantee declaration (`StorageAdapterManifest`).
6. Shared conformance suites every adapter must pass (memory self-proof exists today).

**Why testkit?** Lease-aware store contracts, adapter manifests, memory stores, and conformance suites live here as the **authoritative contract + proof home** for adapters and app tests. Phase 10 **`@paykernel/webhooks`** owns the inbox **engine** (`createWebhookInboxEngine`, modes, outcomes) and dual-owns a structurally compatible `WebhookInboxStore` so the engine never imports testkit. Phase 19 **`@paykernel/reconciliation`** owns reconciliation **primitives** (safe lookup, compare, decision-only policy, store-backed scheduler, `createPaymentReconciler`) and dual-owns a structurally compatible `ReconciliationStore` so domain code never imports testkit. Lease-aware `IdempotencyStore` stays interim in testkit (do **not** merge into core 0.x). Core **must not** depend on testkit, webhooks, or reconciliation. Core 0.x `IdempotencyStore` (get/set/reserve for gateway mutation guards) is intentionally a **different** API — see [§12](#12-distinction-from-core-0x-idempotencystore).

Engine / domain docs (not this package): [webhook-inbox.md](../../webhooks/docs/webhook-inbox.md) · [webhooks crash-boundaries](../../webhooks/docs/crash-boundaries.md) · [reconciliation overview](../../reconciliation/docs/overview.md) · [reconciliation scheduling](../../reconciliation/docs/scheduling.md) · [reconciliation crash-boundaries](../../reconciliation/docs/crash-boundaries.md).

**Phase 11 relational foundation (private):** shared SQL schemas, codecs, versioned migrations, and dialect-honest atomic claim templates live in monorepo-private [`internal/sql-store`](../../../internal/sql-store/README.md) (`@paykernel/internal-sql-store`). That package is **not** published and is **not** a public ORM. Phase 9 contracts and conformance suites in testkit remain the authoritative store interface home; sql-store aligns field names by convention for Phase 12+ adapters. See [relational-foundation.md](../../../internal/sql-store/docs/relational-foundation.md) · [atomic-claims.md](../../../internal/sql-store/docs/atomic-claims.md).

**Phase 12 production adapter (PostgreSQL):** durable multi-host implementations of these contracts ship as [`@paykernel/store-postgres`](../../store-postgres/README.md) (`packages/store-postgres`). It consumes sql-store templates + this package’s conformance suites (`run*StoreConformanceSuite` with injectable clock), publishes `POSTGRES_STORAGE_ADAPTER_MANIFEST`, and keeps optional drivers on isolated subpaths. Core and webhooks must **not** depend on the adapter — inject stores at the app layer. Docs: [overview](../../store-postgres/docs/overview.md) · [guarantees](../../store-postgres/docs/guarantees.md) · [testing](../../store-postgres/docs/testing.md).

**Phase 13 production adapter (Redis / Valkey / Upstash, optional):** multi-host coordination implementations ship as [`@paykernel/store-redis`](../../store-redis/README.md) (`packages/store-redis`). Atomic claims use server-side Lua (tagged results, injectable `now` ARGV for FakeClock), publish `REDIS_STORAGE_ADAPTER_MANIFEST` (`durability: configuration-dependent`), and keep optional drivers on `/bun` `/upstash` `/ioredis` `/node-redis` only. **Redis is not required** to use the SDK — PostgreSQL alone can satisfy these contracts. Core and webhooks must **not** depend on the Redis adapter. Docs: [overview](../../store-redis/docs/overview.md) · [guarantees](../../store-redis/docs/guarantees.md) · [testing](../../store-redis/docs/testing.md) · [persistence](../../store-redis/docs/persistence.md).

**Phase 14 production adapter (SQLite, single-host):** local/embedded implementations ship as [`@paykernel/store-sqlite`](../../store-sqlite/README.md) (`packages/store-sqlite`). Atomic claims use `BEGIN IMMEDIATE` (or equivalent) + sql-store sqlite templates in one **sync** transaction; publish `SQLITE_STORAGE_ADAPTER_MANIFEST` (`coordinationScope: "single-host"`, never multi-host for a local file); drivers only on `/bun` `/node` `/better-sqlite3`. Core and webhooks must **not** depend on the SQLite adapter. Docs: [overview](../../store-sqlite/docs/overview.md) · [guarantees](../../store-sqlite/docs/guarantees.md) · [deployment-limits](../../store-sqlite/docs/deployment-limits.md) · [claims](../../store-sqlite/docs/claims.md) · [testing](../../store-sqlite/docs/testing.md).

**Phase 15 production adapter (Turso / libSQL, multi-host remote):** shared remote SQLite-compatible implementations ship as [`@paykernel/store-turso`](../../store-turso/README.md) (`packages/store-turso`). Atomic claims prefer single-statement UPSERT + RETURNING (async remote; multi-step only in write txn/batch); publish `TURSO_STORAGE_ADAPTER_MANIFEST` (`coordinationScope: "multi-host"`, `durable`); drivers only on `/serverless` `/libsql` — **no** `/sync` and no untested embedded-replica local-first advertising. Not the same as single-host `adapter-sqlite`. Core and webhooks must **not** depend on the Turso adapter. Docs: [overview](../../store-turso/docs/overview.md) · [guarantees](../../store-turso/docs/guarantees.md) · [claims](../../store-turso/docs/claims.md) · [testing](../../store-turso/docs/testing.md) · [embedded-replicas](../../store-turso/docs/embedded-replicas.md).

**Phase 16 production adapter (Cloudflare D1, multi-host Workers):** shared D1 implementations ship as [`@paykernel/store-d1`](../../store-d1/README.md) (`packages/store-d1`). Atomic claims prefer single-statement UPSERT + RETURNING (async Workers binding; multi-step only via D1 `batch()`); publish `D1_STORAGE_ADAPTER_MANIFEST` (`coordinationScope: "multi-host"`, `durable`, session-dependent read-after-write); structural D1 types — no static `cloudflare:workers` in portable packages. **Not** local `adapter-sqlite`, **not** Turso/libSQL, **not** Durable Objects. Core and webhooks must **not** depend on the D1 adapter. Docs: [overview](../../store-d1/docs/overview.md) · [guarantees](../../store-d1/docs/guarantees.md) · [claims](../../store-d1/docs/claims.md) · [sessions-and-replication](../../store-d1/docs/sessions-and-replication.md) · [testing](../../store-d1/docs/testing.md).

**Phase 17 production adapter (Cloudflare Durable Objects, multi-host partitioned):** SQLite-backed DO implementations ship as [`@paykernel/store-durable-objects`](../../store-durable-objects/README.md) (`packages/store-durable-objects`). Worker client is async (stub RPC); in-object SQL is sync (`sql.exec` UPSERT + RETURNING; multi-step only via `transactionSync`). Deterministic sharding (`key` | `hash` | `tenant`) — **never** one global DO. Publishes `DO_STORAGE_ADAPTER_MANIFEST` (`coordinationScope: "multi-host"`, strong claims/RAW **within a partition**). Structural DO/SqlStorage types — no static `cloudflare:workers` on package root. **Not** shared D1, **not** local `adapter-sqlite`, **not** Turso. Core and webhooks must **not** depend on the DO adapter. Docs: [overview](../../store-durable-objects/docs/overview.md) · [sharding](../../store-durable-objects/docs/sharding.md) · [guarantees](../../store-durable-objects/docs/guarantees.md) · [claims](../../store-durable-objects/docs/claims.md) · [transactions](../../store-durable-objects/docs/transactions.md) · [testing](../../store-durable-objects/docs/testing.md).

**How to choose a production adapter (Phase 18):** this document defines contracts and manifest fields. For the **unified capability matrix, decision tree, and recommended defaults** (honest values from each `StorageAdapterManifest` + guarantees — Redis optional, SQLite single-host, D1 ≠ DO, Turso ≠ local SQLite, memory NON-PRODUCTION), see monorepo [`docs/adapter-selection.md`](../../../docs/adapter-selection.md).

---

## 2. Three separate contracts (not one universal store)

Adapters implement **only** the contracts they claim. Do not fold all three into a single “storage” bag with mixed methods.

### 2.1 Lease-aware payment mutation idempotency

Prefer the type alias `LeaseAwareIdempotencyStore` when core 0.x `IdempotencyStore` is also in scope (same interface; avoids name collision).

| Method                     | Role                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `reserve(input)`           | **Atomic** acquire (or re-acquire after lease expiry). Issues `leaseToken`, increments `generation`.          |
| `renew(input)`             | Extend active lease; **requires** current `leaseToken`. On success rotates token and increments `generation`. |
| `complete(input)`          | Terminal success + safe cached `result`; **requires** current `leaseToken`.                                   |
| `markIndeterminate(input)` | Preserve uncertain outcome; **requires** current `leaseToken`. Blocks automatic replay (A4).                  |
| `get(key)`                 | Read current row (may observe lease expiry transitions in memory impl).                                       |
| `deleteExpired(input)`     | Retention cleanup for terminal/expired rows. **Must not** delete `indeterminate` by default.                  |
| `withTransaction?(fn)`     | Optional helper only — **not** a substitute for atomic `reserve`.                                             |

`reserve` result kinds: `acquired` | `already_completed` | `in_progress` | `indeterminate` | `fingerprint_conflict`.

### 2.2 Webhook inbox

| Method                 | Role                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `claim(input)`         | **Atomic** claim (or re-claim after lease expiry). Issues `leaseToken`, increments `generation`. |
| `renew(input)`         | Extend lease; **requires** current `leaseToken`; rotates token + generation on success.          |
| `complete(input)`      | Terminal processed; **requires** current `leaseToken`.                                           |
| `fail(input)`          | Sanitized failure; optional dead-letter / retry delay; **requires** current `leaseToken`.        |
| `get(key)`             | Read row.                                                                                        |
| `listRetryable(input)` | List rows eligible for retry.                                                                    |
| `deleteExpired(input)` | Retention cleanup.                                                                               |
| `withTransaction?(fn)` | Optional helper only.                                                                            |

`claim` result kinds: `acquired` | `already_completed` | `in_progress` | `payload_hash_conflict` | `duplicate_failed`.

**Dual ownership (stability):** `@paykernel/webhooks` exports its own `WebhookInboxStore` + `StoreLeaseLostError` (engine must not import testkit). Types are **structurally compatible** with this package; memory factories here remain assignable to the webhooks interface (covered by assignability tests). Durable adapters **must** still pass `runWebhookInboxStoreConformanceSuite` from **testkit**. Do not diverge method shapes or lease fields without updating both packages and the suites.

### 2.3 Reconciliation persistence

| Method                        | Role                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `schedule(input)`             | Insert or report existing job (`scheduled` \| `already_exists`).                                    |
| `claim(input)`                | **Atomic** claim when due (or re-claim after expiry). Issues `leaseToken`, increments `generation`. |
| `renew(input)`                | Extend lease; **requires** current `leaseToken`; rotates token + generation on success.             |
| `complete(input)`             | Terminal success; **requires** current `leaseToken`.                                                |
| `fail(input)`                 | Terminal fail or reschedule via `retryAt`; **requires** current `leaseToken`.                       |
| `markManualReview(input)`     | Human review terminal; **requires** current `leaseToken`.                                           |
| `get(key)` / `listDue(input)` | Read / list due jobs. **`listDue` must soft-release or re-index expired `claimed` jobs** so poll workers rediscover abandoned work (see conformance case + [crash-boundaries](../../reconciliation/docs/crash-boundaries.md#listdue-recovery-contract-adapters)). |
| `deleteExpired(input)`        | Retention cleanup.                                                                                  |
| `withTransaction?(fn)`        | Optional helper only.                                                                               |

`claim` result kinds: `acquired` | `not_due` | `in_progress` | `already_terminal` | `not_found`.

**listDue recovery (poll path):** `createReconciliationScheduler.claimDue` / `processDue` only discover via `listDue` → `claim`. Key-addressed reclaim after expiry is necessary but **not sufficient**. Conformance requires: schedule → claim → abandon → advance past `leaseExpiresAt` → `listDue` returns the job as `scheduled` (soft-release / re-index). Memory is the reference; SQL/Redis adapters must match.

**Dual ownership (Phase 19):** `@paykernel/reconciliation` exports its own `ReconciliationStore` + `StoreLeaseLostError` (domain engine / scheduler must not import testkit). Types are **structurally compatible** with this package; memory factories here remain assignable to the reconciliation interface (covered by assignability tests). Durable adapters **must** still pass `runReconciliationStoreConformanceSuite` from **testkit**. Domain primitives (lookup, policy, scheduler wrappers, `createPaymentReconciler`) live in the reconciliation package — not here. Docs: [reconciliation overview](../../reconciliation/docs/overview.md) · [scheduling](../../reconciliation/docs/scheduling.md) · [crash-boundaries](../../reconciliation/docs/crash-boundaries.md).

---

## 3. Atomicity requirement (authoritative)

**Required:** `reserve` / `claim` MUST be a **single atomic engine-level claim**:

- Conditional `INSERT` / `UPDATE` (SQL), Redis `SET NX` + token, Durable Object transactional write, etc.
- Concurrent workers must serialize **at the storage engine**, not in application code.

**Forbidden as a claim strategy:** non-atomic get-then-set races across processes:

```text
// FORBIDDEN multi-process “claim”
const row = await store.get(key);
if (!row || expired(row)) await store.set(key, claimedRow);
```

That pattern is **not** a valid multi-host implementation of these contracts. Advertising get/set (or get-then-set) as a correct claim strategy is a Phase 9 acceptance failure.

| Scope             | What “atomic” means                                                              |
| ----------------- | -------------------------------------------------------------------------------- |
| Memory (testkit)  | Single-isolate synchronous critical section only. Marked **NON-DISTRIBUTED**.    |
| SQL / DO / Redis  | Engine conditional write or transaction that makes at most one worker the owner. |
| `withTransaction` | Optional multi-step helper. **Not** a substitute for atomic `reserve`/`claim`.   |

**Future SQL adapters:** never `await` external I/O (provider HTTP, etc.) inside a **synchronous** SQLite / Durable Object transaction callback. Keep claim/complete mutations only; do external work outside the engine transaction.

---

## 4. Lease semantics

All **claimable** records define (roadmap §9.2):

| Field                     | Meaning                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `key`                     | Opaque string id (idempotency / webhook event / reconciliation key). |
| `status`                  | Lifecycle state for that store.                                      |
| `leaseOwner`              | Worker / owner id string (when leased).                              |
| `leaseToken`              | Unguessable opaque fencing token (when leased).                      |
| `leaseExpiresAt`          | ISO-8601 lease expiry.                                               |
| `attempts`                | Attempt counter.                                                     |
| `createdAt` / `updatedAt` | ISO-8601 timestamps.                                                 |
| `generation`              | Monotonic fencing counter.                                           |

Store-specific fields (fingerprint, `payloadHash`, `subjectId`, `dueAt`, …) sit beside the lease fields — never replace them.

**Post-claim mutators require the active token:**

| Store          | Token-gated methods                             |
| -------------- | ----------------------------------------------- |
| Idempotency    | `renew`, `complete`, `markIndeterminate`        |
| Webhook inbox  | `renew`, `complete`, `fail`                     |
| Reconciliation | `renew`, `complete`, `fail`, `markManualReview` |

Wrong or stale tokens → `StoreLeaseLostError` (or renew `{ ok: false, reason: "lease_lost" }`). A stale worker **must not** complete work after a newer worker reclaims or renews the lease.

**`markIndeterminate` vs complete/renew (A4 near-expiry parking):**

| Mutator | Token check | Active lease clock |
| --- | --- | --- |
| `complete` / `renew` | Current token | Required (expired → `lease_lost`) |
| `markIndeterminate` | Current token + `status === "reserved"` | **Not required** in production SQL/Redis: expired-but-unreclaimed may still park so a worker can preserve uncertainty near/at expiry. After reclaim, prior token is fenced. |

Memory testkit soft-expires reserved rows on the read path (`expireIfNeeded`) before `markIndeterminate`, so post-expiry park can fail in tests while still succeeding on SQL/Redis if the row remains unreclaimed. That is a documented NON-PRODUCTION parity note — not a production fence hole (token fencing after reclaim still holds).

**`deleteExpired`:** terminal-only for idempotency (`completed` / `expired`). Must **not** wipe reclaimable `reserved` rows when `leaseExpiresAt <= before` (soft-release/reclaim is separate). Must not remove `indeterminate` by default.

---

## 5. Fencing tokens (dual fencing)

Phase 9 uses **both**:

1. **`generation`** — monotonic integer; **must increment** on every successful `reserve` / `claim` / `renew` that issues a new lease.
2. **`leaseToken`** — unguessable opaque string. After reclaim or renew, the **prior** token must fail subsequent mutators.

Renewal contract (all three stores):

- Success: `{ ok: true, record, leaseToken }` with a **new** token and higher `generation`.
- Failure: `{ ok: false, reason: "lease_lost" | "not_found" | "wrong_status" }` (no throw required for renew).
- The **pre-renew** token must be rejected by later `complete` / `fail` / `markIndeterminate` / `markManualReview` / `renew`.

Treat `lease_lost` as “another worker owns the work” — **not** as a definitive business failure of the payment itself (engineering rule: never convert uncertain outcomes into failure).

---

## 6. Error taxonomy (§9.4)

Normalized codes (`StoreErrorCode` / `STORE_ERROR_CODES`):

| Code                    | Typical subclass                 | Default `retryable` | When                                               |
| ----------------------- | -------------------------------- | ------------------- | -------------------------------------------------- |
| `unavailable`           | `StoreUnavailableError`          | `true`              | Store down, crash injection, connectivity.         |
| `conflict`              | `StoreConflictError`             | `false`             | Logical conflict (non-lease).                      |
| `lease_lost`            | `StoreLeaseLostError`            | `false`             | Stale/wrong/expired fencing token.                 |
| `timeout`               | `StoreTimeoutError`              | `true`              | Operation deadline exceeded.                       |
| `serialization_failure` | `StoreSerializationFailureError` | `true`              | Tx / CAS conflict; often retryable.                |
| `invalid_schema`        | `StoreInvalidSchemaError`        | `false`             | Schema incompatible.                               |
| `unsupported_feature`   | `StoreUnsupportedFeatureError`   | `false`             | Adapter does not support the call.                 |
| `corrupted_record`      | `StoreCorruptedRecordError`      | `false`             | Unreadable / corrupt row.                          |
| `payload_hash_conflict` | `StorePayloadHashConflictError`  | `false`             | Same webhook key, different body hash (extension). |

**Secrets / payloads:** `StoreError.message` and any serialized form **must never** include secrets, signatures, authorization headers, or raw provider payloads.

Base class: `StoreError` with `code` and `retryable`. Adapters may throw subclasses or set `code` on `StoreError`.

**Helper:** `isStoreLeaseLostError(error)` is `true` for `StoreLeaseLostError` **or** a plain `StoreError` with `code: "lease_lost"`. Conformance suites use this so adapters need not subclass if they throw a coded `StoreError`.

---

## 7. `StorageAdapterManifest` — machine-readable guarantees

**Source:** [`packages/testkit/src/storage/adapter-manifest.ts`](../src/storage/adapter-manifest.ts)

Adapters **must** declare what they actually guarantee. A manifest makes overclaiming (e.g. multi-host safety for a process-local Map) detectable. All fields are **required**.

Authoritative shape (roadmap §9.5 / exported type):

```ts
import type {
  StorageAdapterManifest,
  StorageCoordinationScope,
  StorageDurability,
  StorageReadAfterWrite,
} from "@paykernel/testkit";

// StorageAdapterManifest fields:
// name: string
// contracts: { idempotency, webhookInbox, reconciliation: boolean }
// consistency: {
//   claims: "strong";  // only with engine-level atomic ops
//   readAfterWrite: StorageReadAfterWrite; // "strong" | "session" | "eventual"
//   staleReadsPossible: boolean;
// }
// coordinationScope: StorageCoordinationScope
//   // "single-process" | "single-host" | "multi-host" | "multi-region"
// durability: StorageDurability
//   // "durable" | "configuration-dependent" | "ephemeral"
// supportsTransactions / supportsLeases / supportsRetentionCleanup: boolean
// notes: readonly string[]
```

### Public helpers

| Symbol                              | Role                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `StorageAdapterManifest`            | Type for declared guarantees.                                                                          |
| `MEMORY_STORAGE_ADAPTER_MANIFEST`   | Memory multi-store declaration (`name: "memory"`, all three contracts, `single-process`, `ephemeral`). |
| `getMemoryStorageAdapterManifest()` | Stable accessor for the same constant.                                                                 |
| `assertStorageAdapterManifest(m)`   | Runtime shape/enum validation; throws `TypeError` if invalid.                                          |
| `isProductionSafeCoordination(m)`   | `false` when `single-process` or `ephemeral` (heuristic).                                              |
| `isStrongClaimAdapter(m)`           | `true` when `claims === "strong"` **and** `supportsLeases`.                                            |

`createMemoryStores()` attaches `manifest: MEMORY_STORAGE_ADAPTER_MANIFEST` on the bundle for discoverability.

### How adapters declare guarantees

1. Export a constant (e.g. `MEMORY_STORAGE_ADAPTER_MANIFEST` or `POSTGRES_STORAGE_ADAPTER_MANIFEST`) of type `StorageAdapterManifest`.
2. Set `contracts.*` only for interfaces the package implements.
3. Set `coordinationScope` and `durability` honestly:
   - Memory testkit → `single-process` + `ephemeral`.
   - Shared Postgres (`@paykernel/store-postgres`) → `multi-host` + `durable`.
   - Shared Redis (`@paykernel/store-redis`) → `multi-host` + `configuration-dependent` (not sole audit store by default).
   - Local SQLite (`@paykernel/store-sqlite`) → **`single-host`** + `durable` (file-backed; never multi-host for a local file).
   - Shared Turso / libSQL remote (`@paykernel/store-turso`) → `multi-host` + `durable` (not local SQLite; no untested `/sync`).
   - Shared Cloudflare D1 (`@paykernel/store-d1`) → `multi-host` + `durable` (Workers binding; not local SQLite; not Turso; not DO; session-dependent RAW).
   - Partitioned Cloudflare Durable Objects (`@paykernel/store-durable-objects`) → `multi-host` + `durable` (strong claims/RAW **within a partition**; never one global DO; not D1/sqlite/turso).
4. `consistency.claims` is always `"strong"` for conforming manifests — **only** when claims use engine-level atomic ops. Memory may declare strong claims **only** with `coordinationScope: "single-process"` and notes that scope the claim.
5. Put crash boundaries, NON-PRODUCTION warnings, and “not multi-process” language in `notes`.
6. Do **not** advertise get/set as the claim strategy. Adapters that only implement get-then-set races **must not** publish `claims: "strong"`.

Phase 12 ships `POSTGRES_STORAGE_ADAPTER_MANIFEST` from `@paykernel/store-postgres` (see [guarantees.md](../../store-postgres/docs/guarantees.md)). Phase 13 ships optional `REDIS_STORAGE_ADAPTER_MANIFEST` from `@paykernel/store-redis` (see [guarantees.md](../../store-redis/docs/guarantees.md)). Phase 14 ships `SQLITE_STORAGE_ADAPTER_MANIFEST` from `@paykernel/store-sqlite` (see [guarantees.md](../../store-sqlite/docs/guarantees.md)). Phase 15 ships `TURSO_STORAGE_ADAPTER_MANIFEST` from `@paykernel/store-turso` (see [guarantees.md](../../store-turso/docs/guarantees.md)). Phase 16 ships `D1_STORAGE_ADAPTER_MANIFEST` from `@paykernel/store-d1` (see [guarantees.md](../../store-d1/docs/guarantees.md)). Phase 17 ships `DO_STORAGE_ADAPTER_MANIFEST` from `@paykernel/store-durable-objects` (see [guarantees.md](../../store-durable-objects/docs/guarantees.md)).

**Choosing among production adapters:** see monorepo [adapter-selection.md](../../../docs/adapter-selection.md) (Phase 18 matrix + decision tree).

Memory factories also expose runtime markers `NON_PRODUCTION` / `NON_DISTRIBUTED` / `MEMORY_STORE_WARNING` (see [§10](#10-memory-adapter-non-production)).

---

## 8. Indeterminate idempotency (A4)

When a mutation’s outcome is **uncertain** (e.g. provider may have applied the side effect, client timed out), the worker must call `markIndeterminate` while still holding a valid lease — **not** invent a failed/completed outcome.

After `status === "indeterminate"`:

| Rule             | Behavior                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `reserve`        | Returns `{ kind: "indeterminate", record }` — **no new lease**.                                                              |
| Automatic replay | **Forbidden**. Must not silently re-run the mutation.                                                                        |
| Operator path    | Reconciliation or explicit operator decision resolves the row (out-of-band admin, future resolve API, or domain package).    |
| `deleteExpired`  | **Must not** remove indeterminate rows by default (prevents immortal zombies from being “cleaned” into silent re-execution). |

Implementations **must not** convert indeterminate into failure/completed without an explicit operator decision.

---

## 9. Lease renewal (A5)

Long-running handlers renew leases without allowing stale completion:

1. Worker holds `leaseToken` from `reserve`/`claim`.
2. Before expiry, call `renew({ key, leaseToken, leaseMs })`.
3. On success, use the **new** token for later `complete`/`fail`/… .
4. On stale token, renew returns `{ ok: false, reason: "lease_lost" }`.
5. Completing with the **pre-renew** token must fail (`StoreLeaseLostError`).

Conformance suites exercise renew + post-renew token fencing for the stores that implement `renew` (all three contracts include `renew` in the interface).

---

## 10. Memory adapter (NON-PRODUCTION)

Factories:

- `createMemoryIdempotencyStore`
- `createMemoryWebhookInboxStore`
- `createMemoryReconciliationStore`
- `createMemoryStores` (all three + shared clock + `manifest`)

| Marker / field                    | Meaning                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `NON_PRODUCTION`                  | Not for live merchant traffic, durability, or compliance retention.                                                     |
| `NON_DISTRIBUTED`                 | Single-isolate only. Atomicity is in-process Map ops.                                                                   |
| `MEMORY_STORE_WARNING`            | `"NON-PRODUCTION: in-memory store is for tests only"`                                                                   |
| `MEMORY_STORAGE_ADAPTER_MANIFEST` | Machine-readable: `single-process`, `ephemeral`, all three contracts, leases + retention + transactions (Map snapshot). |
| `createMemoryStores().manifest`   | Same reference as `MEMORY_STORAGE_ADAPTER_MANIFEST`.                                                                    |
| Durability                        | **Ephemeral** — process exit loses all state.                                                                           |
| Coordination                      | **Single-process** — no multi-process locks.                                                                            |

Use only for unit tests, local examples, and conformance self-proof. Do **not** place these stores on a production payment path. `isProductionSafeCoordination(MEMORY_STORAGE_ADAPTER_MANIFEST)` is `false`.

Crash injection: `simulateCrash()` arms the next mutation to throw before apply (test-only). Real crash model remains process death = empty store.

---

## 11. Crash boundary model

| Scenario                                                  | Expected behavior                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Acquire / claim, then crash **before** complete           | Lease expires; another worker reclaims with a **new** token and higher `generation`. Old token rejected.                                        |
| Crash **after** external side effect, **before** complete | Prefer `markIndeterminate` if the worker still holds the lease; otherwise treat as uncertain and reconcile — **never** invent terminal failure. |
| Memory process exit / OOM                                 | Entire Map gone (ephemeral).                                                                                                                    |
| Concurrent same-isolate (memory)                          | Synchronous critical section between check and set (no `await` of external I/O between them).                                                   |
| Durable multi-host                                        | Engine-level claim only; reclaim after lease expiry with dual fencing.                                                                          |

Document each durable adapter’s crash boundaries in its package README and manifest `notes`. Auto schema migrations are out of scope for Phase 9 (and discouraged when durable adapters land later).

---

## 12. Distinction from core 0.x `IdempotencyStore`

|                  | Core 0.x (`@paykernel/core`)                        | Testkit lease-aware (Phase 9)                                                    |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Import           | `IdempotencyStore`, `InMemoryIdempotencyStore` from core   | `IdempotencyStore` **or** `LeaseAwareIdempotencyStore` from testkit              |
| Methods          | `get` / `set` / `delete` / optional `reserve(key, record)` | `reserve` / `renew` / `complete` / `markIndeterminate` / `get` / `deleteExpired` |
| Leases / fencing | No lease token or generation                               | `leaseToken` + `generation` required for mutators                                |
| Purpose          | Gateway mutation guards (e.g. Moyasar capture/refund/void) | Future engines + durable adapters; conformance                                   |
| 0.x stability    | **Unchanged** in Phase 9                                   | Additive in testkit only                                                         |

**Never rename** core 0.x `IdempotencyStore`. Prefer:

```ts
import type { IdempotencyStore as CoreIdempotencyStore } from "@paykernel/core";
import type { LeaseAwareIdempotencyStore } from "@paykernel/testkit";
```

---

## 13. Conformance suites (how future adapters prove compliance)

Every adapter that claims a contract **must** pass the matching suite. Memory self-proof: `packages/testkit/src/storage/storage-conformance.test.ts`.

```ts
import {
  createMemoryStores,
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
} from "@paykernel/testkit";

// Memory self-proof (NON-PRODUCTION)
await runIdempotencyStoreConformanceSuite({
  name: "memory-idempotency",
  createStore: ({ clock }) => createMemoryStores({ clock }).idempotency,
});

// Phase 12 postgres adapter (live PG; see packages/store-postgres)
// await runWebhookInboxStoreConformanceSuite({
//   name: "postgres-webhook-inbox",
//   createStore: async ({ clock }) =>
//     createPostgresWebhookInboxStore({ executor, clock, namespace }),
// });
```

Suites cover (among others): atomic acquire/claim, in-progress, fingerprint / payload-hash conflict, complete terminal, stale complete after reclaim, fail/retry/dead-letter or markManualReview, lease expiry reclaim, renew + token rotation (pre-renew token rejected), crash abandon, same-isolate concurrent claims, cleanup, and optional `withTransaction` rollback.

Options typically include `createStore`, optional `createClock` / `concurrency` / `name` / `throwOnFailure`. Use `FakeClock` for deterministic lease expiry.

**Phase 12 wiring:** `@paykernel/store-postgres` runs all three suites against live PostgreSQL when `PAYMENTS_SDK_PG_URL` or `DATABASE_URL` is set (skip-when-unset). See [adapter testing.md](../../store-postgres/docs/testing.md).

**Phase 13 wiring (optional Redis):** `@paykernel/store-redis` runs the same suites against live Redis/Valkey when `PAYMENTS_SDK_REDIS_URL` (preferred) or `REDIS_URL` / `VALKEY_URL` is set (skip-when-unset). See [redis testing.md](../../store-redis/docs/testing.md).

**Phase 14 wiring (SQLite, single-host):** `@paykernel/store-sqlite` runs the same suites against Bun `:memory:` and file-backed SQLite by default; `node:sqlite` and `better-sqlite3` suites skip cleanly when unavailable. See [sqlite testing.md](../../store-sqlite/docs/testing.md).

**Phase 15 wiring (Turso / libSQL, multi-host remote):** `@paykernel/store-turso` runs the same suites against local `@libsql/client` `file:` / `:memory:` by default; live remote multi-connection suites skip unless `TURSO_DATABASE_URL` / `LIBSQL_URL` (+ auth tokens) are set. See [turso testing.md](../../store-turso/docs/testing.md).

**Phase 16 wiring (Cloudflare D1, multi-host Workers):** `@paykernel/store-d1` runs the same suites against mock D1 (bun:sqlite test-only) by default; live/miniflare binding suites skip cleanly unless a harness env marks D1 available. See [d1 testing.md](../../store-d1/docs/testing.md).

### Concurrency scope (important)

| What suites prove today                                                        | What they do **not** prove                    |
| ------------------------------------------------------------------------------ | --------------------------------------------- |
| Same-isolate concurrent double-`reserve`/`claim` (default `concurrency: true`) | Multi-process / multi-host get-then-set races |
| Dual fencing after reclaim/renew within one store instance                     | Two-connection CAS races across hosts         |

`concurrency: true` is **same-isolate only**. It cannot mechanically fail a multi-host adapter that implements claim as non-atomic get-then-set. **Phase 11** lands the private SQL foundation and multi-connection claim **intent/templates** in [`internal/sql-store`](../../../internal/sql-store/docs/atomic-claims.md). **Phase 12 `adapter-postgres`** additionally proves multi-connection atomicity against real PostgreSQL (env-gated harness in the adapter package), for example:

1. Two independent client connections / workers against the same durable backend.
2. Concurrent `claim`/`reserve` on the same key → exactly one `acquired`, the other `in_progress` (or equivalent), with distinct fencing tokens.
3. Stale complete after the peer reclaims still throws lease-lost.

Document that extra harness in the adapter package (postgres: [testing.md](../../store-postgres/docs/testing.md); redis: [testing.md](../../store-redis/docs/testing.md); turso: [testing.md](../../store-turso/docs/testing.md); d1: [testing.md](../../store-d1/docs/testing.md); do: [testing.md](../../store-durable-objects/docs/testing.md)). Policy: advertising `claims: "strong"` with multi-host `coordinationScope` without engine-level atomic ops is a Phase 9 honesty failure regardless of suite greenness.

---

## 14. What Phase 9 does **not** include

| Out of scope                                                                                            | Phase                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox **engine** (`createWebhookInboxEngine`, modes, processing outcomes, HTTP mapping examples)        | **Phase 10** — shipped in [`@paykernel/webhooks`](../../webhooks/README.md); store contract + memory + conformance remain here |
| Shared SQL schemas / migrations / claim templates (private)                                             | **Phase 11** — [`internal/sql-store`](../../../internal/sql-store/README.md) (not published)                                           |
| Production adapters other than postgres/redis/sqlite/turso/d1/do | Later phases (postgres Phase 12: [`adapter-postgres`](../../store-postgres/README.md); redis Phase 13 optional: [`adapter-redis`](../../store-redis/README.md); sqlite Phase 14 single-host: [`adapter-sqlite`](../../store-sqlite/README.md); turso Phase 15 multi-host remote: [`adapter-turso`](../../store-turso/README.md); D1 Phase 16 multi-host Workers: [`adapter-cloudflare-d1`](../../store-d1/README.md); DO Phase 17 multi-host partitioned: [`adapter-cloudflare-do`](../../store-durable-objects/README.md)) |
| Changing core 0.x `IdempotencyStore` (get/set/reserve)                                                  | Forbidden in 0.x                                                                                                                       |
| New PSPs / extracting built-in gateways                                                                 | Separate work                                                                                                                          |
| Framework coupling (Express/Hono route handlers in testkit)                                             | Never                                                                                                                                  |
| Storing raw provider payloads or secrets by default                                                     | Forbidden                                                                                                                              |

Phase 9 ends when contracts, fencing, errors, memory self-proof, manifests, and this documentation are in place — **not** when a durable database driver lands. Phase 10 adds the engine package on top of these store contracts without replacing conformance ownership. Phase 11 adds private SQL foundation under `internal/sql-store` without publishing a public SQL API. Phase 12 implements production `@paykernel/store-postgres` on top of these contracts + sql-store templates. Phase 13 implements optional `@paykernel/store-redis` (Lua claims; configuration-dependent durability) without making Redis mandatory. Phase 14 implements single-host `@paykernel/store-sqlite` (BEGIN IMMEDIATE + sql-store sqlite templates; honest `single-host` manifest). Phase 15 implements multi-host remote `@paykernel/store-turso` (async UPSERT claims; honest multi-host remote; no untested `/sync`). Phase 16 implements multi-host Workers `@paykernel/store-d1` (async UPSERT claims on D1 binding; honest multi-host; sessions for RAW; not sqlite/turso/DO). Phase 17 implements multi-host partitioned `@paykernel/store-durable-objects` (sync in-object SQL UPSERT / `transactionSync`; deterministic sharding; strong RAW within partition; not D1/sqlite/turso; never one global DO).

---

## 15. Portable IDs, timestamps, and payload policy

| Rule           | Detail                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Timestamps     | ISO-8601 **strings** (`IsoTimestamp`), not JS `Date` or number-only APIs in the contract surface.              |
| IDs / tokens   | Opaque **strings** (`LeaseToken`, keys). Avoid JS number 64-bit IDs.                                           |
| Payloads       | Do **not** store raw provider payloads by default. Webhook `payloadRef` is optional and must not hold secrets. |
| Cached results | Idempotency `result` must be safe-to-cache (no secrets).                                                       |
| Errors / logs  | No secret leakage in messages, fixtures, or stored records.                                                    |
| Portability    | No Node-only assumptions in these contracts; memory + suites are portable.                                     |

---

## Related

- Package README: [`../README.md`](../README.md)
- **Adapter selection (Phase 18):** [`../../../docs/adapter-selection.md`](../../../docs/adapter-selection.md) — how to choose a production adapter (matrix + decision tree + defaults)
- Workspace boundaries: [`../../../docs/workspace-boundaries.md`](../../../docs/workspace-boundaries.md)
- Phase 11 private SQL foundation: [`../../../internal/sql-store/docs/relational-foundation.md`](../../../internal/sql-store/docs/relational-foundation.md)
- Phase 12 PostgreSQL adapter: [`../../store-postgres/README.md`](../../store-postgres/README.md) · [overview](../../store-postgres/docs/overview.md)
- Phase 13 Redis adapter (optional): [`../../store-redis/README.md`](../../store-redis/README.md) · [overview](../../store-redis/docs/overview.md)
- Phase 14 SQLite adapter (single-host): [`../../store-sqlite/README.md`](../../store-sqlite/README.md) · [overview](../../store-sqlite/docs/overview.md) · [deployment-limits](../../store-sqlite/docs/deployment-limits.md)
- Phase 15 Turso adapter (multi-host remote): [`../../store-turso/README.md`](../../store-turso/README.md) · [overview](../../store-turso/docs/overview.md) · [embedded-replicas](../../store-turso/docs/embedded-replicas.md)
- Phase 16 Cloudflare D1 adapter (multi-host Workers): [`../../store-d1/README.md`](../../store-d1/README.md) · [overview](../../store-d1/docs/overview.md) · [sessions-and-replication](../../store-d1/docs/sessions-and-replication.md)
- Phase 17 Cloudflare DO adapter (multi-host partitioned): [`../../store-durable-objects/README.md`](../../store-durable-objects/README.md) · [overview](../../store-durable-objects/docs/overview.md) · [sharding](../../store-durable-objects/docs/sharding.md)
- Roadmap Phase 9: monorepo `roadmap.md` § Phase 9
- Core 0.x idempotency helpers: `packages/core/src/utils/idempotency.ts`
- Core behavioral contracts (gateway mutation guards): [`../../core/docs/behavioral-contracts.md`](../../core/docs/behavioral-contracts.md)
- Core webhook envelopes (persistence guidance): [`../../core/docs/webhook-events.md`](../../core/docs/webhook-events.md)
