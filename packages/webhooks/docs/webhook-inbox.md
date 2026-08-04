# Webhook Inbox Engine

**Package:** [`@paykernel/webhooks`](../README.md)  
**Source:** [`engine.ts`](../src/engine.ts), [`types.ts`](../src/types.ts), [`store.ts`](../src/store.ts)  
**Related:** [crash-boundaries.md](./crash-boundaries.md) · [core webhooks](../../core/docs/webhooks.md) · [PaymentEvent](../../core/docs/webhook-events.md) · [store contracts (testkit)](../../testkit/docs/store-contracts.md)

Storage-agnostic **claim / dedupe / retry / audit** for verified webhook deliveries. The engine is gateway-agnostic: verification and normalization are injected; HTTP status codes are never hardcoded.

---

## 1. Purpose

Providers redeliver webhooks. Concurrent deliveries race. Handlers can crash after a side effect but before the inbox marks work complete. Applications need:

1. **Atomic claim** of a stable event key (no get-then-set races).
2. **Payload-hash conflict** detection when the same id arrives with a different body.
3. **Lease fencing** so stale workers cannot complete reclaimed work.
4. **Explicit outcomes** so framework adapters map results to HTTP without silent ACK of failures.
5. **Modes** (`inline` vs `durable_retry`) that never mix implicitly.

This package owns the **inbox engine** and the domain **`WebhookInboxStore`** interface. Durable database adapters are **Phase 11+** and must pass testkit `runWebhookInboxStoreConformanceSuite`. For unit tests, inject testkit’s `createMemoryWebhookInboxStore` (structurally compatible).

**Does not** implement Express/Hono routes, Node-only I/O, Redis, or PSP signature algorithms. PSP verify stays on `PaymentClient` / gateways.

---

## 2. Processing model (steps 1–10)

Roadmap §10.1 maps to the engine as follows. Steps 1–3 happen **outside** or via `processWithVerifier`; `processVerified` starts at validated verified input.

| # | Step | Who |
| - | ---- | --- |
| 1 | Receive raw request | Your HTTP framework |
| 2 | Verify signature / authenticity | `PaymentClient.handleWebhook`, `gateway.verifyWebhook`, or injected `verifyAndNormalize` |
| 3 | Normalize event | Same path; dual-write `PaymentEvent` preferred (Phase 7) |
| 4 | Calculate payload hash | Core `hashWebhookPayload` / package `computePayloadHash` |
| 5 | Derive event key | `deriveWebhookEventKey(gateway, providerEventId)` → `gateway:providerEventId` |
| 6 | Atomically claim | `store.claim` only (engine never get-then-set) |
| 7 | Conflict / non-acquired | Map claim kinds → `WebhookProcessingOutcome` (no handler) |
| 8 | Run application handler | Under lease; `ctx.renew` available |
| 9 | Complete | `store.complete` with current lease token → `processed` |
| 10 | Fail / retry | Sanitized `store.fail` → mode-specific outcome |

### Code sample

```typescript
import {
  hashWebhookPayload,
  toPersistedPaymentEventEnvelope,
} from "@paykernel/core";
import {
  createWebhookInboxEngine,
  type WebhookInboxStore,
  type WebhookProcessingOutcome,
} from "@paykernel/webhooks";

declare const store: WebhookInboxStore;
declare const client: {
  handleWebhook: (
    gateway: string,
    payload: unknown,
    signatureOrHeaders?: unknown,
  ) => Promise<{
    id: string;
    event?: unknown;
    payloadHash?: string;
    rawPayload?: unknown;
  }>;
};

const engine = createWebhookInboxEngine({
  store,
  mode: "inline", // fixed at construction — never implicit
  owner: "api-worker-1",
  defaultLeaseMs: 30_000,
});

async function onStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<WebhookProcessingOutcome> {
  // Steps 1–3: verify + normalize (core; not the inbox engine)
  const webhookEvent = await client.handleWebhook("stripe", rawBody, signature);
  const providerEventId = webhookEvent.id;
  const payloadHash =
    webhookEvent.payloadHash ?? hashWebhookPayload(rawBody);

  // Optional sanitized envelope for durable_retry workers (never raw secrets)
  const envelope =
    webhookEvent.event !== undefined
      ? toPersistedPaymentEventEnvelope(webhookEvent.event as never, {
          payloadHash,
          rawForHash: rawBody,
        })
      : undefined;

  // Steps 4–10 inside processVerified
  return engine.processVerified({
    gateway: "stripe",
    providerEventId,
    payloadHash,
    event: webhookEvent.event ?? webhookEvent,
    ...(envelope !== undefined ? { envelope } : {}),
    handler: async (ctx) => {
      // Long work: await ctx.renew(30_000);
      await fulfillOrder(ctx.event);
    },
  });
}
```

Pipeline detail (engine-internal after claim):

1. Validate `gateway`, `providerEventId`, `payloadHash` (empty → `invalid_webhook`).
2. `deriveWebhookEventKey`.
3. `store.claim({ key, payloadHash, owner, leaseMs, payloadRef? })`.
4. Non-`acquired` → outcome without running the handler.
5. Mode branch: `durable_retry` + `ackAfterClaim` → schedule worker path; else require `handler`.
6. Run handler under lease (`ctx.renew` rotates token).
7. Success → `store.complete` → `{ outcome: "processed" }`.
8. Throw → sanitize → `store.fail` → `handler_failed` / `scheduled_for_retry`.
9. `complete` loses lease after handler success → `{ outcome: "handler_failed", retryable: true }` (**not** `processed`).

---

## 3. Verify via `PaymentClient` or gateway, then process

### Recommended: verify with core, process with webhooks

```typescript
const event = await client.handleWebhook("moyasar", body);
// handleWebhook: verify + normalize + hooks only — no inbox claim

const outcome = await engine.processVerified({
  gateway: "moyasar",
  providerEventId: event.id,
  payloadHash: event.payloadHash ?? hashWebhookPayload(body),
  event: event.event ?? event,
  handler: async (ctx) => {
    await fulfill(ctx.event);
  },
});
```

Core `PaymentClient.handleWebhook` **does not** claim the inbox. Deduplication and lease fencing belong in this package.

### Injected verifier wrapper

```typescript
const outcome = await engine.processWithVerifier({
  raw: { body, headers },
  verifyAndNormalize: async (raw) => {
    try {
      const event = await client.handleWebhook(
        "stripe",
        raw.body,
        raw.headers["stripe-signature"],
      );
      return {
        ok: true,
        gateway: "stripe",
        providerEventId: event.id,
        payloadHash: hashWebhookPayload(raw.body),
        event: event.event ?? event,
      };
    } catch {
      return { ok: false, reason: "verification_failed" };
    }
  },
  handler: async (ctx) => {
    await fulfill(ctx.event);
  },
});
// Verify failure → { outcome: "invalid_webhook" } — never claims
```

### Gateway-only verify

```typescript
const gateway = client.gateway("stripe"); // registered gateway instance
if (!gateway.verifyWebhook(rawBody, signature)) {
  // map to invalid_webhook yourself, or use processWithVerifier
}
const normalized = gateway.parseWebhookEvent(rawBody);
await engine.processVerified({
  gateway: "stripe",
  providerEventId: normalized.id,
  payloadHash: hashWebhookPayload(rawBody),
  event: normalized,
  handler: async (ctx) => {
    await fulfill(ctx.event);
  },
});
```

The engine **never** hardcodes PSP signature verification.

---

## 4. Event key and payload hash

### Key derivation

```typescript
import { deriveWebhookEventKey, parseWebhookEventKey } from "@paykernel/webhooks";

deriveWebhookEventKey("stripe", "evt_123"); // "stripe:evt_123"
parseWebhookEventKey("stripe:evt_123");     // { gateway: "stripe", providerEventId: "evt_123" }
```

- Both parts must be non-empty after trim; otherwise `deriveWebhookEventKey` throws and `processVerified` returns `invalid_webhook`.
- Format: `{gateway}:{providerEventId}` (first colon splits for parse).

### Payload hash

```typescript
import { hashWebhookPayload } from "@paykernel/core";
import { computePayloadHash } from "@paykernel/webhooks";

// Prefer core helper (redacts known secret keys, portable SHA-256)
const h1 = hashWebhookPayload(rawBody);
// Thin wrapper used by the package:
const h2 = computePayloadHash(rawBody); // === hashWebhookPayload(rawBody)
```

Pass a **precomputed** hash into `processVerified`. Same key + different hash → store `payload_hash_conflict` → engine `{ outcome: "payload_conflict" }`.

---

## 5. Inbox record fields and what must NOT be stored

### Lean record (`WebhookInboxRecord`)

Domain-owned in this package; structurally compatible with Phase 9 testkit.

| Field | Role |
| --- | --- |
| `key` | Stable claim key (`gateway:providerEventId`) |
| `status` | `pending` \| `claimed` \| `completed` \| `failed` \| `dead_letter` |
| `payloadHash` | Hash for duplicate / conflict detection |
| `payloadRef?` | Optional **sanitized** snapshot for durable workers (JSON string) |
| `leaseOwner?` / `leaseToken?` / `leaseExpiresAt?` | Lease fencing |
| `attempts` | Handler/claim attempt count (parking `ackAfterClaim` restores so it does not consume budget) |
| `lastError?` | **Sanitized** error only |
| `createdAt` / `updatedAt` / `availableAt` | ISO-8601 strings |
| `generation` | Monotonic; increments on claim/renew |

### Roadmap 10.2 mapping (honesty)

First-class columns for gateway, provider type, schema version, etc. are **not** required on the lean row. Map as follows:

| Roadmap 10.2 concept | Lean field |
| --- | --- |
| Event key | `key` |
| Gateway + provider event id | Encoded in `key` via `deriveWebhookEventKey` |
| Provider event type / schema version / normalized envelope | Optional JSON in `payloadRef` (caller-supplied `envelope`) |
| Payload hash | `payloadHash` |
| State / attempts | `status` / `attempts` |
| Lease owner, token, expiry | `leaseOwner`, `leaseToken`, `leaseExpiresAt` |
| First received | `createdAt` |
| Last received / updated | `updatedAt` |
| Next attempt / claim gate | `availableAt` (key-addressed `claim` + `listRetryable`) |
| Completion timestamp | `updatedAt` when `status === "completed"` |
| Sanitized last error | `lastError` |

Adapters **may** add first-class columns later without breaking this lean contract.

### Forbidden to store (by default)

- Raw provider **payloads** (unredacted)
- Signature headers (`stripe-signature`, PayPal transmission sigs, HMAC strings)
- Authorization headers, Bearer tokens, API keys
- Webhook secrets (`whsec_…`, Moyasar `secret_token`, …)
- Unsanitized exception messages that may embed secrets

Use core `toPersistedPaymentEventEnvelope` / redacted `payloadHash` for anything persisted. Engine `sanitizeWebhookError` strips common secret patterns before `store.fail`.

---

## 6. Modes: `inline` vs `durable_retry`

Mode is **required** on `createWebhookInboxEngine` and is **fixed for the life of the engine**. Process methods never switch modes.

| Mode | Behavior |
| --- | --- |
| `inline` | Await handler under lease. Retryable throw → `store.fail` → `{ outcome: "handler_failed", retryable: true }`. Non-retryable / dead letter → `handler_failed { retryable: false }`. |
| `durable_retry` | Await handler by default. Retryable throw → `store.fail` with delay → `{ outcome: "scheduled_for_retry" }`. |
| `durable_retry` + `ackAfterClaim: true` | After successful claim, release to pending (`retryAfterMs: 0`, `restoreAttempt: true`) and return `scheduled_for_retry` **without** running the handler. Parking claim does **not** consume `maxAttempts`. Workers call `processRetryable`. |

```typescript
// Explicit — never omit mode
const inlineEngine = createWebhookInboxEngine({ store, mode: "inline" });

const durableEngine = createWebhookInboxEngine({
  store,
  mode: "durable_retry",
  maxAttempts: 5,
  defaultRetryAfterMs: 5_000,
  // Optional: ACK after durable claim; worker processes later
  ackAfterClaim: true,
});
```

`ackAfterClaim` is only valid with `mode: "durable_retry"` (constructor throws otherwise). Per-call `ackAfterClaim` on `processVerified` may override the engine default in durable mode only.

### Attempt budget and backoff

- `maxAttempts` is max **handler** attempts before `dead_letter` on `durable_retry` (default 5).
- Each successful store `claim` acquire increments `attempts`. The `ackAfterClaim` parking path calls `fail({ restoreAttempt: true })` so the parking claim is free.
- `fail({ retryAfterMs })` sets `availableAt`. Key-addressed `claim` on a pending row with `availableAt > now` returns `{ kind: "not_available" }` (no attempt++). The engine maps that to `scheduled_for_retry`.
- `listRetryable` only returns rows with `availableAt <= now` (same gate).

### `NonRetryableHandlerError`

- **Default** (`deadLetter` omitted / `true`): mark `dead_letter` immediately — preferred for poison messages.
- **`{ deadLetter: false }` (opt-in footgun):** outcome is still `handler_failed { retryable: false }`, but the row stays **pending**. Redelivery / `processRetryable` can re-run the handler (poison spin) until `maxAttempts` is exhausted in `durable_retry`, at which point the engine dead-letters. Prefer the default.


### Worker path

`processRetryable` is **only valid on `durable_retry` engines** (throws if `mode === "inline"`). Use a dedicated durable worker engine; do not mix modes via the retry path.

```typescript
const result = await durableEngine.processRetryable({
  limit: 10,
  handler: async (ctx) => {
    await fulfill(ctx.event);
  },
  // Optional: map record → gateway/id/event/hash
  // resolveEvent: (rec) => ({ ... }),
});
// result.items: { key, outcome }[]
```

---

## 7. `WebhookProcessingOutcome` and HTTP mapping (examples only)

The engine **never** hardcodes Express/Hono status codes. Your framework adapter owns HTTP policy.

```ts
type WebhookProcessingOutcome =
  | { outcome: "processed" }
  | { outcome: "duplicate_completed" }
  | { outcome: "already_processing"; retryAfterMs?: number }
  | { outcome: "scheduled_for_retry" }
  | { outcome: "handler_failed"; retryable: boolean }
  | { outcome: "payload_conflict" }
  | { outcome: "invalid_webhook"; reason?: string };
```

| Outcome | Meaning | Example HTTP mapping* |
| --- | --- | --- |
| `processed` | Handler ran; inbox completed | 200 |
| `duplicate_completed` | Already terminal success; handler not re-run | 200 |
| `already_processing` | Another worker holds lease; optional `retryAfterMs` | 503 / 409 + Retry-After |
| `scheduled_for_retry` | Durable path scheduled / retryable fail recorded | 200 **only if** app policy deliberately ACKs after durable claim; else 5xx so provider retries |
| `handler_failed` `retryable: true` | Handler failed; may retry | 5xx (provider redelivery) |
| `handler_failed` `retryable: false` | Dead letter / non-retryable / terminal store fail | 200 or 4xx per policy (do not infinite-retry forever) |
| `payload_conflict` | Same key, different payload hash | 400 / 409 |
| `invalid_webhook` | Bad input or verify failed | 400 |

\*Examples only — providers differ (Stripe vs PayPal retry semantics). **Silent ACK of failed work is forbidden:** do not return success for `handler_failed` retryable work unless you have an explicit durable-retry + worker design and accept provider-level non-retry.

Store claim kind mapping:

| Claim kind | Outcome |
| --- | --- |
| `acquired` | Continue pipeline |
| `already_completed` | `duplicate_completed` |
| `in_progress` | `already_processing` (+ `retryAfterMs` when lease expiry known) |
| `payload_hash_conflict` | `payload_conflict` |
| `duplicate_failed` | `handler_failed { retryable: false }` |

### Illustrative adapter (not part of this package)

```typescript
function mapOutcomeToHttp(o: WebhookProcessingOutcome): { status: number } {
  switch (o.outcome) {
    case "processed":
    case "duplicate_completed":
      return { status: 200 };
    case "invalid_webhook":
    case "payload_conflict":
      return { status: 400 };
    case "already_processing":
      return { status: 503 };
    case "scheduled_for_retry":
      // Policy choice: durable ACK vs provider retry
      return { status: 200 };
    case "handler_failed":
      return { status: o.retryable ? 500 : 200 };
  }
}
```

---

## 8. Lease renewal for long handlers

```typescript
handler: async (ctx) => {
  for (const chunk of work) {
    await processChunk(chunk);
    await ctx.renew(30_000); // store.renew; rotates leaseToken + generation
  }
},
```

Also available on the engine:

```typescript
const r = await engine.renewLease(key, leaseToken, 30_000);
// { ok: true, record, leaseToken } | { ok: false, reason: "lease_lost" | ... }
```

- Successful renew **rotates** `leaseToken` and increments `generation`.
- Stale token → renew fails; `ctx.renew` throws `StoreLeaseLostError`.
- Complete/fail with a pre-renew token → lease lost (stale worker cannot finish).

---

## 9. Integration with `WebhookInboxStore` and memory store

### Inject any store

```typescript
import {
  createWebhookInboxEngine,
  type WebhookInboxStore,
} from "@paykernel/webhooks";

// Production (Phase 11+): durable adapter implementing WebhookInboxStore
// Tests: testkit memory (structurally assignable)
declare const store: WebhookInboxStore;

const engine = createWebhookInboxEngine({ store, mode: "inline" });
```

### Testkit memory (tests only)

```typescript
import { createMemoryWebhookInboxStore, createFakeClock } from "@paykernel/testkit";
import { createWebhookInboxEngine } from "@paykernel/webhooks";

const clock = createFakeClock();
const store = createMemoryWebhookInboxStore({ clock });
const engine = createWebhookInboxEngine({
  store,
  mode: "inline",
  clock, // same injectable clock for lease deltas
});
```

- **`@paykernel/webhooks` does not depend on testkit.** Import memory stores from testkit in test code only.
- Durable adapters must pass `runWebhookInboxStoreConformanceSuite` from testkit.
- This package does **not** export a production memory store from the public index (tests may use package-local helpers if present).

### Store methods the engine uses

| Method | Engine use |
| --- | --- |
| `claim` | Atomic acquire |
| `complete` | Terminal success |
| `fail` | Sanitized failure / ackAfterClaim release / no-handler release |
| `renew` | `ctx.renew` / `renewLease` |
| `listRetryable` | `processRetryable` worker poll |

---

## 10. Handler idempotency requirement

**Handlers MUST be idempotent.**

The inbox can fence concurrent workers and reject stale completions, but it **cannot** atomically commit an arbitrary external side effect (charge capture, email, inventory) together with its completion row unless both share one transaction boundary.

Crash after side effect and before `complete` → lease expires → reclaim → **handler runs again**. Design handlers around stable keys (`event.id`, order id) so re-runs are no-ops.

```typescript
handler: async (ctx) => {
  const eventId = ctx.providerEventId;
  if (await orders.alreadyFulfilled(eventId)) return;
  await orders.fulfillIdempotent(eventId, ctx.event);
},
```

Throw `NonRetryableHandlerError` (or `{ deadLetter: true }` / `{ retryable: false }`) for permanent failures so durable mode dead-letters instead of spinning forever.

Full crash matrix: **[crash-boundaries.md](./crash-boundaries.md)**.

---

## 11. Package boundary

| Allowed | Forbidden |
| --- | --- |
| Depend on `@paykernel/core` (core) | Depend on `@paykernel/testkit` |
| Inject `WebhookInboxStore` | Depend on `adapter-*`, Redis, ORMs |
| Injectable clock / sanitizer | `node:` / `bun:` in production sources |
| Framework-agnostic outcomes | Hardcoded Express/Hono HTTP statuses |
| — | Core depending on this package |

Dependency direction:

```text
@paykernel/core          (core — verify, hash, PaymentEvent)
        ↑
@paykernel/webhooks     (engine + domain WebhookInboxStore types)
        ↑ (depends for integration / assignability tests only)
@paykernel/testkit      (memory store + conformance suites)
```

- Production webhooks code **must not** import testkit.
- Testkit **may** depend on webhooks (engine-memory integration); core **must not** depend on either.
- `paymentsSdk.portable: true` — Web APIs / injectable clock only.

---

## Public API surface (quick reference)

Runtime exports are frozen by package tests. Memory stores are **not** exported from the public index.

| Export | Role |
| --- | --- |
| `createWebhookInboxEngine` | Factory; fixed mode |
| `computePayloadHash` | Core `hashWebhookPayload` wrapper |
| `deriveWebhookEventKey` / `parseWebhookEventKey` | Key helpers |
| `sanitizeWebhookError` / `DEFAULT_SANITIZE_MAX_LENGTH` | Default `lastError` sanitizer |
| `StoreLeaseLostError` / `isStoreLeaseLostError` | Portable fencing errors |
| `NonRetryableHandlerError` | Dead-letter / non-retryable throws |
| `WebhookInboxStore` + record/claim types | Domain store contract |
| `WebhookProcessingMode` / `WebhookProcessingOutcome` | Modes + outcomes |
| `WebhookInboxEngine` | `processVerified`, `processWithVerifier`, `processRetryable`, `renewLease` |

---

## Related docs

- [crash-boundaries.md](./crash-boundaries.md) — Phase 10.6 scenarios
- [inbox-engine.md](./inbox-engine.md) — short pipeline cheat sheet
- [README](../README.md) — install / quickstart
- [core webhooks.md](../../core/docs/webhooks.md) — verify path
- [testkit store-contracts.md](../../testkit/docs/store-contracts.md) — lease/store semantics + conformance
