# Webhook Inbox Engine (cheat sheet)

Package: `@paykernel/webhooks` (Phase 10).

Full guide: **[webhook-inbox.md](./webhook-inbox.md)** · Crash matrix: **[crash-boundaries.md](./crash-boundaries.md)**

## Pipeline (10.1)

1. Validate inputs (`gateway`, `providerEventId`, `payloadHash`).
2. Derive key: `deriveWebhookEventKey(gateway, providerEventId)` → `gateway:providerEventId`.
3. Atomic `store.claim` (never get-then-set in the engine).
4. Map claim kinds to outcomes (no handler on non-`acquired`).
5. Mode branch (`inline` / `durable_retry` / `ackAfterClaim`).
6. Run application handler under lease (`ctx.renew` available).
7. Success → `store.complete` → `{ outcome: "processed" }`.
8. Handler throw → sanitize error → `store.fail` → mode-specific outcome.
9. `complete` throws lease_lost after handler success → `{ outcome: "handler_failed", retryable: true }` (not `processed`).

Verification/normalization is **injected** (`processWithVerifier` or `PaymentClient.handleWebhook` then `processVerified`); the engine does not hardcode PSP signature checks.

## Modes (10.3)

| Mode | Fixed at construction | On handler failure |
| --- | --- | --- |
| `inline` | yes | `handler_failed { retryable }` |
| `durable_retry` | yes | `scheduled_for_retry { reason: "handler_retry" }` if retryable; else `handler_failed` |
| `durable_retry` + `ackAfterClaim` | yes | N/A — parks with `scheduled_for_retry { reason: "parked" }`; requires `envelope`; worker via `processRetryable` |

Modes are never mixed implicitly inside `process*`. `processRetryable` throws on `inline` engines.

## Outcomes (10.4)

Outcomes are framework-agnostic. **Silent ACK of failed work is forbidden.** Map outcomes to HTTP only in your adapter — and **always read `scheduled_for_retry.reason`**:

| `reason` | Meaning | Safe 200? |
| --- | --- | --- |
| `parked` | `ackAfterClaim` released for worker | Only if `processRetryable` worker is guaranteed |
| `handler_retry` | Handler threw; fail recorded with backoff | Yes with durable worker; else 5xx |
| `not_available` | Claim backoff; no handler ran | Prefer **5xx** (provider redelivery) |

Store claim `duplicate_failed` → `handler_failed { retryable: false }`.
Store claim `not_available` (pending, `availableAt` in future) → `scheduled_for_retry { reason: "not_available" }` (no attempt burn).

## Lean record vs 10.2 fields

See [webhook-inbox.md §5](./webhook-inbox.md#5-inbox-record-fields-and-what-must-not-be-stored). Phase 9 lean row stores gateway/event-id in `key`, envelope snapshot in optional `payloadRef`, timestamps via `createdAt` / `updatedAt` / `availableAt`. Do not store raw signatures, auth headers, secrets, or unredacted payloads. Object envelopes are force-redacted via core `redactWebhookPayloadSecrets` before `JSON.stringify` into `payloadRef`; still prefer `toPersistedPaymentEventEnvelope` so raw never enters.

## Crash boundaries (10.6)

See **[crash-boundaries.md](./crash-boundaries.md)** for store state, handler status, provider retry, and outcomes per boundary.

| Boundary | Engine / store effect |
| --- | --- |
| Before claim | No mutation; safe redelivery |
| After claim, before handler | Lease held; reclaim after expiry |
| During handler | Lease held; reclaim re-runs handler — **handler must be idempotent** |
| After external side effect, before complete | Stale complete rejected; outcome is not `processed` |
| After complete | Terminal; redelivery → `duplicate_completed` |

## Lease renewal (10.5)

`ctx.renew(leaseMs?)` and `engine.renewLease(key, token, leaseMs?)` call `store.renew`, which **rotates** `leaseToken` and increments `generation`. Stale tokens fail.

## Dependencies

- Depends on: `@paykernel/core` only.
- Must not depend on: testkit, adapter-\*, Redis, Express/Hono.
- Durable adapters must pass testkit `runWebhookInboxStoreConformanceSuite`.
