# @paykernel/testkit

Test kit for [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core): scriptable mock gateway, capability-gated gateway conformance, lease-aware store contracts + harnesses, fixture safety, **NON-PRODUCTION** in-memory stores, and optional dual-type integration with [`@paykernel/webhooks`](../webhooks/README.md) (Phase 10) and [`@paykernel/reconciliation`](../reconciliation/README.md) (Phase 19).

> **Portable.** No Node-only imports in production entrypoints. Runtime: Bun / Node ≥ 18 / Deno / Workers (Web APIs). Core `PaymentRuntime` / injected `fetch`+`clock` are used when you build gateways via `createDefaultGatewayContext` / `createPaymentClient({ runtime })` — mock gateways accept the same context shape. See core [runtime.md](../core/docs/runtime.md).

## Install

```bash
bun add -d @paykernel/testkit
# or
npm install -D @paykernel/testkit
```

Depends on `@paykernel/core`, `@paykernel/webhooks`, and `@paykernel/reconciliation` (workspace/link in monorepo; dual-type assignability proofs).

## Quickstart — mock gateway

```typescript
import { mockGateway, runGatewayConformanceSuite } from "@paykernel/testkit";
import { defineGatewayCapabilities, money } from "@paykernel/core";

const gateway = mockGateway({
  name: "demo",
  createPayment: [{ outcome: "succeeded" }, { outcome: "declined" }],
});

const result = await gateway.createPayment({
  // Prefer money(); plain number majors still work in 0.x (deprecated)
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://merchant.example/callback",
});
// result.status === "paid"
// result.outcome === "succeeded"          (Phase 6 dual-write)
// result.references.providerObjectId      (structured provider refs)
// result.rawResponse.amountMinor === 1050  (via shared core conversion)
// Prefer isPaidOutcome(result) over result.success for fulfillment tests
```

### Phase 7 mock webhooks (`PaymentEvent` dual-write)

`generateWebhookEvent`, `mockPayloadToWebhookEvent`, and `mockGateway().parseWebhookEvent`
return a 0.x `WebhookEvent` **and** attach Phase 7 fields via core
`attachPaymentEvent` (no local remapping of stable names):

| Field | Behavior |
| --- | --- |
| `type` | Free-form (default mock `payment_paid`) or pass a stable name |
| `rawPayload` | Still required (request-local) |
| `schemaVersion` / `event` / `provider` / `stableType` | Dual-write when mappable |

```typescript
import { generateWebhookEvent, mockGateway } from "@paykernel/testkit";
import { isPaymentSucceededEvent } from "@paykernel/core";

const { event } = generateWebhookEvent({
  type: "payment_paid", // free-form; dual-writes stableType payment.succeeded
  status: "paid",
});
// event.type === "payment_paid"
// event.stableType === "payment.succeeded"
// event.event.schemaVersion === "1"
if (event.event && isPaymentSucceededEvent(event.event)) {
  // fulfill from event.event.payment
}

// Stable name option (type is already the Phase 7 discriminant):
const stable = generateWebhookEvent({ type: "payment.succeeded", status: "paid" });
// stable.event.type === "payment.succeeded"

// Prefer core envelopes for persistence tests (never store raw by default):
// toPersistedPaymentEventEnvelope(event.event!, { rawForHash: event.rawPayload })
```

See core [webhook-events.md](../core/docs/webhook-events.md).

### Phase 6 mock outcomes

Scripted outcomes map to the same dual-write shape as production gateways
([operation-results.md](../core/docs/operation-results.md)):

| Scripted `outcome` | Result fields (high level) |
| --- | --- |
| `succeeded` | `outcome: 'succeeded'`, `status: 'paid'`, `success: true` |
| `requires_action` | `outcome: 'requires_action'`, pending + `redirectUrl` / `nextAction` |
| `indeterminate` | `outcome: 'indeterminate'`, `reconciliationRequired: true`, `success: false` (not a decline) |
| `failed` | `outcome: 'failed'`, `status: 'failed'`, `success: false` |
| `declined` / `insufficient_funds` | throws typed card/funds errors |
| `timeout` / `network_error` | throws `NetworkError` (reconcile before re-mutating) |
| `provider_ok_client_timeout` | provider-side paid retained; client throws `NetworkError` |

```typescript
import { isPaidOutcome, isRequiresActionOutcome } from "@paykernel/core";

const g = mockGateway({
  createPayment: [
    { outcome: "requires_action" },
    { outcome: "succeeded" },
    { outcome: "indeterminate" },
  ],
});

const a = await g.createPayment(params);
// a.success === true but isPaidOutcome(a) === false
expect(isRequiresActionOutcome(a)).toBe(true);

const b = await g.createPayment(params);
expect(isPaidOutcome(b)).toBe(true);
expect(b.references?.gateway).toBe("demo");
```

### Amount conversion (shared money model)

`majorToMinor` / `minorToMajor` and the mock ledger use
[`@paykernel/core`](../core/docs/money.md) money helpers (bigint minor
units, strict precision by default). There is **no** silent
`Math.round(amount * 100)` path. Capture/refund remaining balances are tracked
as integer minor units internally; `getPaymentState` still returns major-unit
numbers for assertions.

```typescript
import { majorToMinor, minorToMajor } from "@paykernel/testkit";
import { money } from "@paykernel/core";

majorToMinor(10.5, "SAR"); // 1050
majorToMinor(money("1.234", "KWD"), "KWD"); // 1234
// majorToMinor(0.1 + 0.2, "SAR") → throws InvalidRequestError (float noise)
```

Capability-gated conformance (golden path for custom adapters):

```typescript
import { mockGateway, runGatewayConformanceSuite } from "@paykernel/testkit";
import { defineGatewayCapabilities } from "@paykernel/core";

const report = await runGatewayConformanceSuite({
  name: "demo",
  mode: "full", // full | structural | applicable
  createGateway: () =>
    mockGateway({
      name: "demo",
      capabilities: defineGatewayCapabilities({
        payments: true,
        immediateCapture: true,
        authorization: true,
        partialCapture: true,
        refunds: true,
        partialRefunds: true,
        voids: true,
      }),
    }),
  capabilities: defineGatewayCapabilities({
    payments: true,
    immediateCapture: true,
    authorization: true,
    partialCapture: true,
    refunds: true,
    partialRefunds: true,
    voids: true,
  }),
});

if (!report.ok) {
  console.error(report.failed);
  throw new Error("conformance failed");
}
// report.passed: string[]
// report.failed: Array<{ case: string; error: string }>
// report.skipped: Array<{ case: string; reason: string }>
```

## Built-in offline runners

Never hit live provider APIs. Use `applicable` (default) or `structural` mode:

```typescript
import { runBuiltinGatewayConformance } from "@paykernel/testkit";

const report = await runBuiltinGatewayConformance("stripe", {
  mode: "applicable",
});
// Always runs capabilities_parity + claim_method_presence.
// Skips createPayment/network cases (no injectable fetch on built-ins).
```

## Store contracts (Phase 9)

Lease-aware **store contracts**, error taxonomy, adapter manifests, memory
reference stores, and shared conformance suites live in **testkit**. Phase 10
**`@paykernel/webhooks`** owns the inbox **engine** and dual-owns a
structurally compatible `WebhookInboxStore` (engine must not import testkit).
Phase 19 **`@paykernel/reconciliation`** owns domain primitives
(lookup, policy, scheduler wrappers, `createPaymentReconciler`) and dual-owns a
structurally compatible `ReconciliationStore` (domain must not import testkit).
Durable adapters implement stores via testkit conformance. Core 0.x
`IdempotencyStore` (`get`/`set`/optional `reserve`) is a **different** API for
gateway mutation guards — do not mix the two. Prefer
`LeaseAwareIdempotencyStore` when both packages are in scope.

**Full contract doc (atomicity, fencing, crashes, A4/A5, manifests):**
[docs/store-contracts.md](./docs/store-contracts.md)

**Domain packages (not this package):**
[webhook-inbox.md](../webhooks/docs/webhook-inbox.md) ·
[webhooks crash-boundaries](../webhooks/docs/crash-boundaries.md) ·
[reconciliation overview](../reconciliation/docs/overview.md) ·
[reconciliation crash-boundaries](../reconciliation/docs/crash-boundaries.md)

Three separate interfaces (not one universal store):

| Contract | Atomic claim | Token-gated mutators |
| --- | --- | --- |
| `IdempotencyStore` / `LeaseAwareIdempotencyStore` | `reserve` | `renew`, `complete`, `markIndeterminate` |
| `WebhookInboxStore` | `claim` | `renew`, `complete`, `fail` |
| `ReconciliationStore` | `claim` | `renew`, `complete`, `fail`, `markManualReview` |

Claims **must** be engine-level atomic operations. Non-atomic get-then-set is
**forbidden** as a multi-process claim strategy. Future Postgres/D1/SQLite
adapters implement the same interfaces and **must** pass the shared suites.

### Adapter manifest (machine-readable guarantees)

Adapters declare scope and durability honestly (roadmap §9.5). Do not overclaim
multi-host or durable safety for process-local stores:

```typescript
import {
  MEMORY_STORAGE_ADAPTER_MANIFEST,
  assertStorageAdapterManifest,
  createMemoryStores,
  createFakeClock,
  isProductionSafeCoordination,
  type StorageAdapterManifest,
} from "@paykernel/testkit";

assertStorageAdapterManifest(MEMORY_STORAGE_ADAPTER_MANIFEST);
// MEMORY_STORAGE_ADAPTER_MANIFEST.name === "memory"
// coordinationScope: "single-process", durability: "ephemeral"
// contracts: idempotency + webhookInbox + reconciliation
isProductionSafeCoordination(MEMORY_STORAGE_ADAPTER_MANIFEST); // false

const stores = createMemoryStores({ clock: createFakeClock() });
// stores.manifest === MEMORY_STORAGE_ADAPTER_MANIFEST
// stores.NON_PRODUCTION === true
// stores.NON_DISTRIBUTED === true
```

See [docs/store-contracts.md §7](./docs/store-contracts.md#7-storageadaptermanifest--machine-readable-guarantees)
for the full field table and honesty rules (engine-level claims only; get-then-set
must not publish `claims: "strong"`).

### Conformance + memory self-proof

```typescript
import {
  createMemoryStores,
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
} from "@paykernel/testkit";

const clock = createFakeClock();
const stores = createMemoryStores({ clock });
// stores.manifest.name === "memory"

await runIdempotencyStoreConformanceSuite({
  name: "memory-idempotency",
  createStore: ({ clock }) =>
    createMemoryStores({ clock }).idempotency,
});
await runWebhookInboxStoreConformanceSuite({
  name: "memory-webhook-inbox",
  createStore: ({ clock }) =>
    createMemoryStores({ clock }).webhookInbox,
});
await runReconciliationStoreConformanceSuite({
  name: "memory-reconciliation",
  createStore: ({ clock }) =>
    createMemoryStores({ clock }).reconciliation,
});
```

Future durable adapters pass the same runners with their own `createStore`.
Default suite concurrency is **same-isolate only** — it does not prove multi-host
get-then-set races. Phase 11 multi-connection claim proofs belong in the adapter
package (see [docs/store-contracts.md §13](./docs/store-contracts.md#13-conformance-suites-how-future-adapters-prove-compliance)).

## ⚠️ NON-PRODUCTION / NON-DISTRIBUTED memory stores

`createMemoryWebhookInboxStore`, `createMemoryIdempotencyStore`, `createMemoryReconciliationStore`, and `createMemoryStores` are:

| Marker                   | Meaning                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| **NON_PRODUCTION**       | Not for live merchant traffic, durability, or compliance retention.     |
| **NON_DISTRIBUTED**      | Single-isolate only. Atomicity is in-process Map ops, not multi-node.   |
| **MEMORY_STORE_WARNING** | `"NON-PRODUCTION: in-memory store is for tests only"`                   |
| **Crash boundary**       | Process exit loses all state. Crash hooks simulate drop for tests only. |

Do **not** use these stores behind a production payment path. They exist for unit tests, local examples, and conformance self-proof. See [docs/store-contracts.md §10–§11](./docs/store-contracts.md#10-memory-adapter-non-production).

### Crash boundaries (memory)

- All data is process-local heap. Kill / OOM / restart = empty store.
- There is no WAL, snapshot, or multi-process locking.
- Concurrent callers in one isolate share one Map; claim check+set is a synchronous critical section (no `await` between check and set).
- Worker abandon model: acquire lease, never complete; after lease expiry another worker reclaims with a new fencing token (`generation++`, new `leaseToken`).
- External side effect then crash before complete → indeterminate / reconciliation path — never invent terminal failure.
- `simulateCrash()` arms the next mutation to throw (mid-request failure injection).
- Fake-clock lease expiry is deterministic only when all code uses the injected clock.
- `withTransaction` clones Map state and restores on throw (memory only). SQL adapters must not `await` external I/O inside a synchronous engine transaction callback.

## Fixture safety

Committed offline fixtures must not leak live secrets or PANs. Use the helpers
before writing snapshots or packing fixture JSON:

```typescript
import {
  sanitizeFixture,
  assertFixtureSafe,
  redactSecretsFromFixture,
  findSecretLeaks,
  FIXTURE_SCHEMA_VERSION,
  REDACTED,
} from "@paykernel/testkit";

// Deep-clone + redact sensitive keys (Authorization, card*, token, …)
// and string values that match live secret / PAN patterns.
const scrubbed = redactSecretsFromFixture({
  amount: 10,
  headers: { Authorization: "Bearer sk_live_…" },
  cardNumber: "4242424242424242",
});
// scrubbed.headers.Authorization === REDACTED ("[REDACTED]")

// Wrap with schema version for versioned offline fixtures
const envelope = sanitizeFixture(
  { amount: 10, currency: "SAR", note: "ok" },
  { id: "capture-ok", gateway: "mock" },
);
// envelope.schemaVersion === FIXTURE_SCHEMA_VERSION (1)
// envelope.redacted === true
assertFixtureSafe(envelope);

// Reject unsafe fixtures in tests / CI (hard-fail live keys and PANs)
assertFixtureSafe({ key: "sk_live_abc…" }); // throws
assertFixtureSafe({ key: "sk_test_placeholder" }); // ok — test keys allowed
assertFixtureSafe({ webhookSecret: "whsec_test_only" }); // ok
assertFixtureSafe({ password: "test_secret" }); // ok — explicit placeholder

// Paths of remaining leaks (empty when safe)
const leaks = findSecretLeaks(someFixture);
```

| Check | Behavior |
| ----- | -------- |
| `sk_live_` / `pk_live_` / `rk_live_` | Hard fail |
| Live `whsec_` (not `whsec_test…`) | Hard fail |
| PAN-like 13–19 digit strings | Hard fail |
| `sk_test_` / `pk_test_` / `whsec_test…` / `test_secret` | Allowed |
| Sensitive keys (`Authorization`, `password`, …) | Redacted by `redactSecretsFromFixture`; cleartext rejected by `assertFixtureSafe` unless placeholder |

## Package boundary

- **Core must not depend on testkit, webhooks, or reconciliation.**
- Testkit depends on `@paykernel/core`, `@paykernel/webhooks`, and
  `@paykernel/reconciliation` (dual-type assignability proofs) via
  `workspace:*` / published range.
- **Webhooks and reconciliation production code must not import testkit.**
- **Phase 9 store contracts** (lease-aware idempotency, webhook inbox,
  reconciliation, error taxonomy, manifests) and conformance suites live here.
  Phase 10 inbox **engine** is `@paykernel/webhooks`; Phase 19 domain
  **primitives** are `@paykernel/reconciliation`. See
  [docs/store-contracts.md](./docs/store-contracts.md) and
  [workspace boundaries](../../docs/workspace-boundaries.md).

## Exports

| Area        | Symbols                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Mock        | `mockGateway`, `MockGateway`, `MockGatewayOptions`, scripted outcome types                       |
| Gateway     | `runGatewayConformanceSuite`, `GATEWAY_CONFORMANCE_CASES`, modes `full`/`structural`/`applicable` |
| Built-ins   | `runBuiltinGatewayConformance`, `BUILTIN_GATEWAY_NAMES`, `BUILTIN_TEST_CREDENTIALS`              |
| Storage     | `run*StoreConformanceSuite`, `WebhookInboxStore`, `IdempotencyStore` / `LeaseAwareIdempotencyStore`, `ReconciliationStore`, `StoreError*` / `STORE_ERROR_CODES`, … |
| Manifest    | `StorageAdapterManifest`, `MEMORY_STORAGE_ADAPTER_MANIFEST`, `assertStorageAdapterManifest`, `getMemoryStorageAdapterManifest`, `isProductionSafeCoordination`, `isStrongClaimAdapter` |
| Memory      | `createMemory*Store`, `createMemoryStores` (incl. `.manifest`), `createFakeClock`, `FakeClock`, `NON_PRODUCTION`, `NON_DISTRIBUTED`, `MEMORY_STORE_WARNING` |
| Fixtures    | `sanitizeFixture`, `assertFixtureSafe`, `redactSecretsFromFixture`, `findSecretLeaks`, `FIXTURE_SCHEMA_VERSION`, `FixtureEnvelope` |

## Development (monorepo)

```bash
# from repo root
bun install
bun run --filter @paykernel/testkit typecheck
bun run --filter @paykernel/testkit test
bun run --filter @paykernel/testkit build
```

## Related

- **Store contracts (Phase 9):** [docs/store-contracts.md](./docs/store-contracts.md)
- Core SDK: `packages/core` (0.x `IdempotencyStore` is **not** the lease-aware testkit contract)
- Workspace boundaries: [`docs/workspace-boundaries.md`](../../docs/workspace-boundaries.md)
- Roadmap Phase 4 / Phase 9: monorepo `roadmap.md`
