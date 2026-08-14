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
| 4 | Calculate payload hash | Prefer gateway `event.payloadHash`; else `resolveInboxPayloadHash` / same object shape as gateway (`hashWebhookPayload` — **not** interchangeable with raw body string) |
| 5 | Derive event key | `deriveWebhookEventKey(gateway, providerEventId)` → `gateway:providerEventId` |
| 6 | Atomically claim | `store.claim` only (engine never get-then-set) |
| 7 | Conflict / non-acquired | Map claim kinds → `WebhookProcessingOutcome` (no handler) |
| 8 | Run application handler | Under lease; `ctx.renew` available |
| 9 | Complete | `store.complete` with current lease token → `processed` |
| 10 | Fail / retry | Sanitized `store.fail` → mode-specific outcome |

### Code sample

```typescript
import { toPersistedPaymentEventEnvelope } from "@paykernel/core";
import {
  createWebhookInboxEngine,
  resolveInboxPayloadHash,
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
  // WEBHOOKS-2: prefer gateway payloadHash; fallback hashes the same object
  // shape the gateway used — never mix rawBody string with object digests.
  const payloadHash = resolveInboxPayloadHash({
    eventPayloadHash: webhookEvent.payloadHash,
    payloadForHash:
      webhookEvent.rawPayload ?? webhookEvent.event ?? webhookEvent,
  });

  // Optional sanitized envelope for durable_retry workers (never raw secrets)
  const envelope =
    webhookEvent.event !== undefined
      ? toPersistedPaymentEventEnvelope(webhookEvent.event as never, {
          payloadHash,
          // rawForHash only if you intentionally want that digest in the envelope;
          // prefer the same payloadHash used for claim.
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
5. Mode branch: `durable_retry` + `ackAfterClaim` → require `envelope`, park as `scheduled_for_retry { reason: "parked" }`; else require `handler`.
6. Run handler under lease (`ctx.renew` rotates token).
7. Success → `store.complete` → `{ outcome: "processed" }`.
8. Throw → sanitize → `store.fail` → `handler_failed` / `scheduled_for_retry { reason: "handler_retry" }`.
9. `complete` loses lease after handler success → `{ outcome: "handler_failed", retryable: true }` (**not** `processed`).

---

## 3. Verify via `PaymentClient` or gateway, then process

### Recommended: verify with core, process with webhooks (claim before fulfill)

**WEBHOOKS-2 invariant:** claim/lease **before** money side effects. Never run
`onWebhookVerified` fulfillment (or any order/inventory mutation) inside
`handleWebhook` when the inbox engine owns dedupe — put fulfillment in the
engine `handler` after `processVerified` acquires a lease, or in
`processRetryable` after re-claim.

```typescript
// 1) Verify + normalize ONLY. Disable fulfillment hooks for this path
//    (or leave onWebhookVerified empty) so side effects cannot run pre-claim.
const event = await client.handleWebhook("moyasar", body);
// handleWebhook: verify + normalize (+ hooks) — no inbox claim

// 2) Claim under lease, then fulfill
const outcome = await engine.processVerified({
  gateway: "moyasar",
  providerEventId: event.id,
  payloadHash: resolveInboxPayloadHash({
    eventPayloadHash: event.payloadHash,
    payloadForHash: event.rawPayload ?? event.event ?? event,
  }),
  event: event.event ?? event,
  handler: async (ctx) => {
    // 3) Money / fulfillment side effects ONLY here (post-claim)
    await fulfill(ctx.event);
  },
});
```

Core `PaymentClient.handleWebhook` **does not** claim the inbox. Deduplication and lease fencing belong in this package. Core docs require `onWebhookVerified` throws → **5xx** so providers retry; with the inbox, map engine `handler_failed { retryable: true }` the same way — and keep fulfillment out of verify.

### Injected verifier wrapper (verify-only path)

```typescript
const outcome = await engine.processWithVerifier({
  raw: { body, headers },
  // VERIFY ONLY — no fulfill / onWebhookVerified money work (WEBHOOKS-2).
  verifyAndNormalize: async (raw) => {
    // Let throws propagate. processWithVerifier classifies (WEBHOOKS-1/5/6):
    // - InvalidWebhookError (verify-false only) / ok:false → invalid_webhook (~400 forgery)
    // - InvalidRequestError / post-verify parse → handler_failed { retryable: true }
    //   (~5xx; signature-valid paid events must redeliver — never permanent 400)
    // - RateLimitError / TypeError / NetworkError / unknown Error →
    //   handler_failed { retryable: true } (~5xx; redeliver paid events)
    // - Permanent structure GatewayApiError → handler_failed { retryable: false }
    // Never map infrastructure/parse throws to ok:false (that stops redelivery).
    const event = await client.handleWebhook(
      "stripe",
      raw.body,
      raw.headers["stripe-signature"],
    );
    return {
      ok: true,
      gateway: "stripe",
      providerEventId: event.id,
      payloadHash: resolveInboxPayloadHash({
        eventPayloadHash: event.payloadHash,
        payloadForHash: event.rawPayload ?? event.event ?? event,
      }),
      event: event.event ?? event,
    };
  },
  // Fulfill after claim (or park with ackAfterClaim + processRetryable).
  handler: async (ctx) => {
    await fulfill(ctx.event);
  },
});
// Signature forgery / ok:false → { outcome: "invalid_webhook" } — never claims
// Parse / InvalidRequestError / verify infra / unknown → handler_failed retryable
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
  // Prefer normalized.payloadHash when computePayloadHash was used on parse
  payloadHash: resolveInboxPayloadHash({
    eventPayloadHash: normalized.payloadHash,
    payloadForHash: normalized.rawPayload ?? normalized,
  }),
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
- **Gateway must not contain `:`** (colon is the key separator). Rejecting colon-in-gateway prevents collisions such as `a:b`+`c` vs `a`+`b:c`. `providerEventId` may still contain colons.
- Format: `{gateway}:{providerEventId}` (first colon splits for parse).

### Payload hash (one canonical source — WEBHOOKS-2)

```typescript
import { hashWebhookPayload } from "@paykernel/core";
import {
  computePayloadHash,
  resolveInboxPayloadHash,
} from "@paykernel/webhooks";

// Canonical for inbox claim:
const payloadHash = resolveInboxPayloadHash({
  eventPayloadHash: webhookEvent.payloadHash, // prefer when gateway set it
  payloadForHash: webhookEvent.rawPayload ?? webhookEvent, // same shape as gateway
});

// computePayloadHash === hashWebhookPayload (thin wrapper). Shape matters:
// hashWebhookPayload does NOT JSON-parse non-object strings, so
// hashWebhookPayload(rawBodyString) !== hashWebhookPayload(parsedObject)
// even when rawBodyString is JSON of that object. Mixing them → permanent
// payload_conflict on redelivery.
const objectHash = computePayloadHash({ id: "evt_1" });
const stringHash = computePayloadHash(JSON.stringify({ id: "evt_1" }));
// objectHash !== stringHash — never interchange them for the same event key
void objectHash;
void stringHash;
void hashWebhookPayload;
```

Pass a **precomputed** hash into `processVerified`.

**Hash conflict policy (WEBHOOKS-3 / WEBHOOKS-4):**

| Existing row | New hash | Claim result |
| --- | --- | --- |
| `completed` / `dead_letter` / `failed` | any | terminal (`already_completed` / `duplicate_failed`) — no re-run |
| Active lease + **same** hash | same | `in_progress` → `already_processing` |
| Active lease + **different** hash | different | `payload_hash_conflict` → `payload_conflict` |
| Idle non-terminal (pending / expired lease) + different hash | different | **supersede** — acquire with new hash (paid redrive recovers) |
| Pending + future `availableAt` + **same** hash | same | `not_available` → `scheduled_for_retry` |

Idle supersede prevents hash-source mistakes (raw body string vs parsed object) from permanently sticking a pending paid event. Prefer one canonical source via `resolveInboxPayloadHash` so supersede is rare.

### Ops recovery for stuck `payload_conflict` / hash mistakes

1. **Idle pending:** redeliver with the corrected `payloadHash` — engine/store supersedes and reclaims (WEBHOOKS-3).
2. **Active lease conflict:** wait for lease expiry, then redeliver with the correct hash (supersede), or coordinate the holding worker.
3. **Terminal wrong state / adapter without supersede:** delete the inbox row for `gateway:providerEventId` in your durable store (or age it into `deleteExpired` after `dead_letter`/`completed`), then allow provider redelivery. Document the delete in your runbook — never silent-ACK 200 on `payload_conflict` without a recovery path.
4. **Going forward:** always use `resolveInboxPayloadHash({ eventPayloadHash, payloadForHash })` with the same object shape the gateway hashed.

---

## 5. Inbox record fields and what must NOT be stored

### Lean record (`WebhookInboxRecord`)

Domain-owned in this package; structurally compatible with Phase 9 testkit.

| Field | Role |
| --- | --- |
| `key` | Stable claim key (`gateway:providerEventId`) |
| `status` | `pending` \| `claimed` \| `completed` \| `dead_letter` (engine-written). Type also allows `failed` for 0.x/custom stores — **engine never writes `failed`**; fail always → `pending` or `dead_letter` |
| `payloadHash` | Hash for duplicate / conflict detection |
| `payloadRef?` | Optional **sanitized** snapshot for durable workers (JSON string) |
| `leaseOwner?` / `leaseToken?` / `leaseExpiresAt?` | Lease fencing |
| `attempts` | Handler attempt budget counter (parking `ackAfterClaim` + expired-lease soft-release restore so crash reclaim does not consume `maxAttempts`) |
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

**Honesty (envelope → `payloadRef`):** object/array envelopes are deep-redacted via core `redactWebhookPayloadSecrets` (known secret keys → `"[REDACTED]"`) then `JSON.stringify`'d into `payloadRef`. **JSON string** envelopes that parse as object/array are also redacted then re-stringified; opaque non-JSON strings have known secret/signature patterns redacted (`redactOpaquePayloadRefString`, WEBHOOKS-6) before store — plain opaque refs without secret shapes pass through. On `durable_retry`, if `envelope` is omitted a redacted snapshot of `event` is stored so redrive has payment fields. Values that still carry `rawPayload` or `headers` are converted via core `toPersistedPaymentEventEnvelope` when a PaymentEvent is present; otherwise the engine refuses with `invalid_webhook` (P610-SNAP-1). Redaction is defense-in-depth — apps should still use core `toPersistedPaymentEventEnvelope` (or strip signatures, secrets, and raw provider payloads themselves) before claim. Do not pass `rawPayload` / signature headers / webhook secrets into `envelope`.

Use core `toPersistedPaymentEventEnvelope` / redacted `payloadHash` for anything persisted. Recommended dual-write envelopes stored as `payloadRef` are **auto-unwrapped** by default `processRetryable` materialization (handlers receive `.event`). **Missing `payloadRef` never stubs** `{ key, payloadHash }` — workers dead-letter with `handler_failed { retryable: false }`. Engine `sanitizeWebhookError` strips common secret patterns before `store.fail`.

---

## 6. Modes: `inline` vs `durable_retry`

Mode is **required** on `createWebhookInboxEngine` and is **fixed for the life of the engine**. Process methods never switch modes.

| Mode | Behavior |
| --- | --- |
| `inline` | Await handler under lease. Retryable throw → `store.fail` with `retryAfterMs: 0` → `{ outcome: "handler_failed", retryable: true }`. Non-retryable / dead letter → `handler_failed { retryable: false }`. **Never** emits `scheduled_for_retry` (claim `not_available` → `handler_failed { retryable: true }`). |
| `durable_retry` | Await handler by default. Retryable throw → `store.fail` with delay → `{ outcome: "scheduled_for_retry", reason: "handler_retry" }`. |
| `durable_retry` + `ackAfterClaim: true` | After successful claim, release to pending (`retryAfterMs: 0`, `restoreAttempt: true`) and return `{ outcome: "scheduled_for_retry", reason: "parked" }` **without** running the handler. Parking claim does **not** consume `maxAttempts`. Workers call `processRetryable`. **Requires non-empty `envelope`** (refuses with `invalid_webhook` otherwise). |

```typescript
// Explicit — never omit mode
const inlineEngine = createWebhookInboxEngine({ store, mode: "inline" });

const durableEngine = createWebhookInboxEngine({
  store,
  mode: "durable_retry",
  maxAttempts: 5, // finite integer >= 1
  defaultRetryAfterMs: 5_000, // finite number >= 0
  // Optional: ACK after durable claim; worker processes later
  ackAfterClaim: true,
});
```

`ackAfterClaim` is only valid with `mode: "durable_retry"` (constructor throws otherwise). Per-call `ackAfterClaim` on `processVerified` may override the engine default in durable mode only. Parking **requires** `envelope` so `payloadRef` is materializable by workers.

### Attempt budget and backoff

- `maxAttempts` is max **handler** attempts before `dead_letter` on `durable_retry` (default 5). Must be a finite integer **`>= 1`** (constructor throws otherwise).
- Each successful store `claim` acquire increments `attempts`.
- The `ackAfterClaim` parking path calls `fail({ restoreAttempt: true })` so the parking claim is free.
- **Crash reclaim:** soft-release of an expired `claimed` lease (via get/listRetryable) restores one attempt (floor 0) before the row is reclaimable. Deploy/process death after claim therefore does **not** burn the dead-letter budget.
- **WEBHOOKS-2 (lease timeout / hang):** `store.fail` with a matching token succeeds even after lease expiry so handler hang/timeout still records an attempt. Soft-release alone must not make `maxAttempts` a no-op — poison/long handlers eventually dead-letter.
- `fail({ retryAfterMs })` sets `availableAt`. Key-addressed `claim` on a pending row with `availableAt > now` returns `{ kind: "not_available" }` (no attempt++). **durable_retry** maps that to `scheduled_for_retry { reason: "not_available" }`. **inline** maps it to `handler_failed { retryable: true }` (P610-ACK-1 — no worker path). Adapters should map these to **5xx** (provider redelivery) unless a durable scheduler owns the row — **never silent-ACK 200** when no worker will run (WEBHOOKS-3).
- `listRetryable` only returns rows with `availableAt <= now` (same gate). Soft-release on list/get/claim restores unfinished claim attempts.
- `defaultLeaseMs` / per-call `leaseMs` must be finite and **`> 0`** (constructor / process throws a clear config error otherwise). Default remains **30_000**.
- `defaultRetryAfterMs` must be a finite number **`>= 0`** (constructor throws otherwise). Default remains **5_000**.

#### `ackAfterClaim` + `fail(restoreAttempt)` lease_lost (P610-ACK-2)

`scheduled_for_retry { reason: "parked" }` is returned **only if** `store.fail({ restoreAttempt: true })` succeeds. If that fail throws `StoreLeaseLostError` (pathological lease/clock skew: lease already expired or reclaimed before park completes), the engine returns `already_processing` (when lease expiry is still in the future) or `handler_failed { retryable: true }` — **never** parked. The row may still be `claimed` and the parking attempt may remain burned; adapters must 5xx so the provider redelivers. Prefer positive lease durations and NTP-aligned clocks across hosts.

### `NonRetryableHandlerError`

- **Default** (`deadLetter` omitted / `true`): mark `dead_letter` immediately — preferred for poison messages.
- **`{ deadLetter: false }` (opt-in footgun):** outcome is still `handler_failed { retryable: false }`, but the row stays **pending**. Redelivery / `processRetryable` can re-run the handler (poison spin) until `maxAttempts` is exhausted in `durable_retry`, at which point the engine dead-letters. Prefer the default.


### Worker path

`processRetryable` is **only valid on `durable_retry` engines** (throws if `mode === "inline"`). Use a dedicated durable worker engine; do not mix modes via the retry path.

**Default event materialization:** when `payloadRef` parses as a core
`PersistedPaymentEventEnvelope` (`schemaVersion` + `event` + `payloadHash`),
`processRetryable` **auto-unwraps** `.event` so `ctx.event` is the nested
PaymentEvent — recommended dual-write workers can `fulfill(ctx.event)` without
a custom `resolveEvent`. Plain PaymentEvent JSON (or any non-envelope shape) is
passed through unchanged. Override `resolveEvent` for custom stores.

```typescript
const result = await durableEngine.processRetryable({
  limit: 10,
  handler: async (ctx) => {
    // With toPersistedPaymentEventEnvelope on claim, ctx.event is already PaymentEvent
    await fulfill(ctx.event);
  },
  // Optional override for custom payloadRef layouts:
  // resolveEvent: (rec) => ({ gateway, providerEventId, payloadHash, event }),
});
// result.items: { key, outcome }[]
```

---

## 7. `WebhookProcessingOutcome` and HTTP mapping (examples only)

The engine **never** hardcodes Express/Hono status codes. Your framework adapter owns HTTP policy.

```ts
type ScheduledForRetryReason = "parked" | "handler_retry" | "not_available";

type WebhookProcessingOutcome =
  | { outcome: "processed" }
  | { outcome: "duplicate_completed" }
  | { outcome: "already_processing"; retryAfterMs?: number }
  | {
      outcome: "scheduled_for_retry";
      reason: ScheduledForRetryReason;
      /** When the row becomes claimable again (ISO), when known (WEBHOOKS-5). */
      availableAt?: string;
      /** ms until `availableAt` from engine clock, when computable. */
      retryAfterMs?: number;
    }
  | { outcome: "handler_failed"; retryable: boolean }
  | { outcome: "payload_conflict" }
  | { outcome: "invalid_webhook"; reason?: string };
```

| Outcome | Meaning | Example HTTP mapping* |
| --- | --- | --- |
| `processed` | Handler ran; inbox completed | 200 |
| `duplicate_completed` | Already terminal success; handler not re-run | 200 |
| `already_processing` | Another worker holds lease; optional `retryAfterMs` | 503 / 409 + Retry-After |
| `scheduled_for_retry` `reason: "parked"` | Durable `ackAfterClaim` park; worker owns work; optional timing fields | **200 only if a worker runs `processRetryable`** |
| `scheduled_for_retry` `reason: "handler_retry"` | Retryable handler fail recorded with backoff; includes `availableAt` / `retryAfterMs` when known | **200** if durable worker will re-drive; else **5xx** |
| `scheduled_for_retry` `reason: "not_available"` | Claim backoff (`availableAt` still future); no handler ran; exposes `availableAt` / `retryAfterMs` | **5xx** (provider redelivery) unless a durable scheduler owns the row |
| `handler_failed` `retryable: true` | Handler failed **or** verify infra/unknown/parse/`InvalidRequestError` throw (WEBHOOKS-1/5); may retry | 5xx (provider redelivery) |
| `handler_failed` `retryable: false` | Dead letter / non-retryable / terminal store fail / permanent verify structure (WEBHOOKS-6) | 200 or 4xx per policy (do not infinite-retry forever) |
| `payload_conflict` | Same key, different hash **while lease active only** (idle pending supersedes and reclaims — not permanent; WEBHOOKS-3/4) | 409 / 400 while lease held — not silent 200; redeliver after expiry with correct hash |
| `invalid_webhook` | Bad input, `{ ok: false }` (reason sanitized), or verify-false `InvalidWebhookError` only (not parse / `InvalidRequestError`) | 400 |

\*Examples only — providers differ (Stripe vs PayPal retry semantics). **The engine is HTTP-agnostic.**

**`scheduled_for_retry` recommended HTTP policy (must use `reason`):**

| `reason` | Suggested HTTP | Why |
| --- | --- | --- |
| `parked` | **200** | Durable claim/fail already persisted **and** a worker will process (`processRetryable`). Without a worker, do **not** 200 — you will drop money-moving webhooks. |
| `handler_retry` | **200** with worker / **5xx** without | Fail was recorded; durable worker re-drives after `availableAt`, or provider redelivers. |
| `not_available` | **5xx** | No work processed this delivery; prefer provider redelivery (or 200 only when a durable scheduler is guaranteed). **Never silent-ACK 200 on inline engines with no worker.** |

**Silent ACK of failed work is forbidden:** do not return success for `handler_failed` retryable work or for `scheduled_for_retry` without a real recovery path (worker or provider redelivery).

Store claim kind mapping:

| Claim kind | Outcome |
| --- | --- |
| `acquired` | Continue pipeline |
| `already_completed` | `duplicate_completed` |
| `in_progress` | `already_processing` (+ `retryAfterMs` when lease expiry known) |
| `payload_hash_conflict` | `payload_conflict` |
| `duplicate_failed` | `handler_failed { retryable: false }` |
| `not_available` | **durable_retry:** `scheduled_for_retry` `{ reason: "not_available", availableAt?, retryAfterMs? }` (backoff before `availableAt`; no attempt++). **inline:** `handler_failed { retryable: true }` (P610-ACK-1) |

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
      // Discriminate reason — never blind-ACK 200 when no worker will process.
      switch (o.reason) {
        case "parked":
          // 200 only when processRetryable worker is guaranteed.
          return { status: 200 };
        case "handler_retry":
          // Durable worker owns re-drive → 200; else ask provider to redeliver.
          return { status: 200 }; // or 500 if no worker
        case "not_available":
          // Backoff window; no handler ran this delivery → provider redelivery.
          return { status: 503 };
      }
      break;
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
