# @paykernel/webhooks

Storage-agnostic **webhook inbox engine** for [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core): atomic claim, payload-hash conflict detection, lease-fenced complete/fail, explicit processing modes, and framework-agnostic outcomes.

> **Portable.** No Node-only imports. No Express/Hono HTTP status hardcoding. Runtime: Bun / Node ≥ 18 / Deno / Workers (Web APIs). Depends only on `@paykernel/core`.

## Install

```bash
bun add @paykernel/webhooks
# peer / workspace: @paykernel/core
```

## Quickstart

Inject any `WebhookInboxStore` (testkit memory in tests; Phase 11+ durable adapters in production).

```typescript
import { hashWebhookPayload } from "@paykernel/core";
import {
  createWebhookInboxEngine,
  type WebhookInboxStore,
} from "@paykernel/webhooks";

declare const store: WebhookInboxStore;

const engine = createWebhookInboxEngine({
  store,
  mode: "inline", // or "durable_retry" — fixed at construction
  owner: "api-worker-1",
  defaultLeaseMs: 30_000,
});

// Prefer: verify with PaymentClient.handleWebhook (core), then processVerified.
const outcome = await engine.processVerified({
  gateway: "stripe",
  providerEventId: "evt_123",
  payloadHash: hashWebhookPayload(rawBody),
  event: normalizedPaymentEvent,
  // Optional sanitized envelope only (never raw signatures / secrets):
  // envelope: { schemaVersion: "1", type: "payment.succeeded" },
  handler: async (ctx) => {
    // Long work: await ctx.renew(30_000);
    await fulfill(ctx.event);
  },
});

// Map outcome → HTTP in YOUR framework adapter — not inside this package.
switch (outcome.outcome) {
  case "processed":
  case "duplicate_completed":
    // typically 200
    break;
  case "already_processing":
  case "scheduled_for_retry":
  case "handler_failed":
    // typically 5xx / retry per provider policy — never silent-ACK failures
    break;
  case "payload_conflict":
  case "invalid_webhook":
    // typically 400
    break;
}
```

### Tests with memory store

```typescript
import { createMemoryWebhookInboxStore, createFakeClock } from "@paykernel/testkit";
import { createWebhookInboxEngine } from "@paykernel/webhooks";

const clock = createFakeClock();
const store = createMemoryWebhookInboxStore({ clock });
const engine = createWebhookInboxEngine({ store, mode: "inline", clock });
```

(`@paykernel/webhooks` does **not** depend on testkit — import memory stores only from test code.)

### With injected verifier

```typescript
const outcome = await engine.processWithVerifier({
  raw: { body, headers },
  verifyAndNormalize: async (raw) => {
    const event = await client.handleWebhook("stripe", raw.body, raw.headers["stripe-signature"]);
    return {
      ok: true,
      gateway: "stripe",
      providerEventId: event.id,
      payloadHash: hashWebhookPayload(raw.body),
      event,
    };
  },
  handler: async (ctx) => {
    await fulfill(ctx.event);
  },
});
```

## Processing modes (explicit)

| Mode | Behavior |
| --- | --- |
| `inline` | Await handler under lease. Failure → `handler_failed { retryable }`. |
| `durable_retry` | Await handler by default; retryable failure → `store.fail` + `scheduled_for_retry`. |
| `durable_retry` + `ackAfterClaim: true` | After durable claim, release to pending and return `scheduled_for_retry` **without** running the handler. Workers call `processRetryable`. |

Mode is fixed at `createWebhookInboxEngine` construction. Process methods never switch modes implicitly.
`processRetryable` is valid **only** on `durable_retry` engines (throws on `inline`).
`ackAfterClaim` is valid **only** with `durable_retry` (constructor throws otherwise).

**Silent acknowledgment of failed work is forbidden.** Always inspect `WebhookProcessingOutcome`.

## Outcomes (no HTTP hardcoding)

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

Policy notes:

- Store claim `duplicate_failed` → `handler_failed { retryable: false }` (terminal dead_letter/failed).
- Handler success but `complete` loses lease → `handler_failed { retryable: true }` (do **not** report `processed`).
- **Handlers must be idempotent** — reclaim after crash re-runs work under a new lease.

## Event key

```ts
import { deriveWebhookEventKey } from "@paykernel/webhooks";

deriveWebhookEventKey("stripe", "evt_123"); // "stripe:evt_123"
```

Empty gateway or providerEventId throws / yields `invalid_webhook`.

## Store contract

`WebhookInboxStore` is **owned by this package** (roadmap domain ownership). Phase 9 testkit types remain structurally compatible for `createMemoryWebhookInboxStore` and conformance suites.

Atomic claim only — never get-then-set in the engine. Lease tokens fence complete/fail/renew; renew rotates token + generation.

### 10.2 field mapping (lean record)

| Roadmap concept | Lean field |
| --- | --- |
| event key | `key` |
| gateway + provider event id | encoded in `key` (`gateway:id`) |
| provider type / schema version / envelope | optional JSON in `payloadRef` |
| payload hash | `payloadHash` |
| state / attempts | `status` / `attempts` |
| lease owner, token, expiry | `leaseOwner`, `leaseToken`, `leaseExpiresAt` |
| first / last received | `createdAt` / `updatedAt` |
| next attempt | `availableAt` |
| completion time | `updatedAt` when `status === "completed"` |
| sanitized error | `lastError` |

**Do not** persist raw signatures, authorization headers, secret tokens, or unredacted provider payloads.

Durable adapters must pass testkit `runWebhookInboxStoreConformanceSuite`.

## Lease renewal

```ts
await ctx.renew(30_000); // rotates leaseToken for subsequent complete
// or
const r = await engine.renewLease(key, token, 30_000);
```

Stale token → renew fails (`lease_lost`); complete/fail with old token throw `StoreLeaseLostError`.

## Documentation

| Doc | Contents |
| --- | --- |
| **[docs/webhook-inbox.md](./docs/webhook-inbox.md)** | Full guide: pipeline 1–10, modes, outcomes, store, boundaries |
| **[docs/crash-boundaries.md](./docs/crash-boundaries.md)** | Phase 10.6 crash matrix (store / handler / provider / outcome) |
| [docs/inbox-engine.md](./docs/inbox-engine.md) | Short pipeline cheat sheet |
| [core webhooks.md](../core/docs/webhooks.md) | Verify + normalize (`handleWebhook`) |
| [testkit store-contracts.md](../testkit/docs/store-contracts.md) | Lease-aware store semantics + conformance |

## Engineering rules

1. Atomic claim via `store.claim` only.
2. Never convert uncertain outcomes into failure masquerading as success (lease_lost after success → retryable `handler_failed`, not `processed`).
3. Sanitize all `lastError` values (default strips `sk_live_`, `whsec_`, Bearer, etc.).
4. No framework coupling; no Node-only assumptions.
5. Core must not depend on this package; this package must not depend on testkit/adapters.

## License

MIT
