# Crash boundaries (Phase 10.6)

**Package:** [`@paykernel/webhooks`](../README.md)  
**Engine:** [`createWebhookInboxEngine`](../src/engine.ts) · **Overview:** [webhook-inbox.md](./webhook-inbox.md)

This document is the authoritative description of process crashes and abandonments relative to the webhook inbox pipeline. It answers, for each boundary:

1. What is the **store state**?
2. Did the **handler** run?
3. Will the **provider** typically retry (HTTP-level)?
4. What **outcome** should the app surface if the request is still in flight (or on the next delivery)?
5. Why **handler idempotency** is mandatory.

The inbox **cannot** atomically couple an arbitrary external side effect with its completion row unless both share a single transaction. Reclaims after lease expiry **re-run** the handler. Design fulfillment to be safe under at-least-once execution.

**Silent acknowledgment of failed or uncertain work is forbidden.** Never treat claim-without-success as `processed`.

---

## Pipeline positions

```text
 receive → verify → normalize → hash → derive key
     → [A] claim
     → [B] handler start … handler body … handler end
     → [C] store.complete
     → [D] done (terminal completed)
```

| Label | Boundary |
| ----- | -------- |
| Before claim | Crash/abandon after verify, before `store.claim` returns `acquired` |
| After claim, before handler | `acquired` held; handler not invoked yet (includes crash before `handler()`) |
| During handler | Handler running; side effects may be partial |
| After side effect, before complete | External work may have committed; `store.complete` not yet successful |
| After completion | `status === "completed"`; terminal |

Lease expiry / process death while claimed is treated like abandon: another worker may **reclaim** after `leaseExpiresAt`.

---

## 1. Crash before claim

### Store state

- No inbox mutation for this delivery (or prior terminal/pending row from an earlier delivery only).
- If this is the first delivery of the key: key is **absent**.
- If a previous attempt already completed: row remains `completed`.
- If a previous attempt left `pending` (retryable after fail): unchanged until a later claim. (Engine never writes status `failed`; that enum member is vestigial for custom stores.)

### Handler

- **Did not run** for this in-flight request.

### Provider retry

- Depends on HTTP response from your adapter.
- If the process died before responding: provider typically **retries** (timeout / connection reset).
- If you already returned 5xx: provider **retries**.
- If you incorrectly returned 200 without processing: provider may **not** retry — **do not do this**.

### Outcome to surface

- No engine outcome was produced for the crashed request.
- On redelivery: normal `processVerified` path.
  - Fresh key → claim `acquired` → run handler.
  - Prior `completed` → `{ outcome: "duplicate_completed" }` (handler not re-run).

### Idempotency

- N/A for this delivery (handler never ran). Still implement idempotent handlers for later boundaries.

---

## 2. Crash after claim, before handler

### Store state

- Row exists with `status: "claimed"` (or equivalent active lease).
- `leaseToken` / `leaseOwner` / `leaseExpiresAt` set; `attempts` incremented by claim.
- Handler has **not** been entered.
- On lease expiry without a handler outcome, soft-release (get/listRetryable) restores that unfinished attempt so pure crash/deploy reclaim does not burn `maxAttempts` before a real handler outcome.
- If the handler ran and called `fail` after expiry (WEBHOOKS-2), the matching token still records the attempt — `maxAttempts` remains effective for hang/timeout paths.

### Handler

- **Did not run.**

### Provider retry

- Usually yes if HTTP never completed successfully, or if you returned 5xx / timed out.
- Concurrent redelivery while lease is live → claim `in_progress` → `{ outcome: "already_processing", retryAfterMs? }`.
- After lease **expires**, a redelivery (or `processRetryable`) can **reclaim** (`acquired` again).

### Outcome to surface

- Crashed request: no reliable success outcome — **do not** invent `processed`.
- Concurrent peer while lease held: `already_processing` (not success).
- After reclaim: proceed as a new acquired attempt (handler will run for the first time on that worker).

### Idempotency

- Still required: reclaim after expiry will run the handler later. If you had started non-inbox side effects outside the engine before claim (anti-pattern), those could already exist — keep side effects **inside** the handler after claim.

### Engine notes

- `durable_retry` + `ackAfterClaim`: claim then intentional release to pending returns `scheduled_for_retry` **only if** `store.fail({ restoreAttempt: true })` succeeds — that is **not** a crash; workers must run `processRetryable`. A crash after claim but before that release leaves the row claimed until expiry/reclaim.
- Park `lease_lost` (WEBHOOKS-5): if park `fail({ restoreAttempt: true })` hits `StoreLeaseLostError`, the engine does **not** emit `scheduled_for_retry` / `parked`. It returns `already_processing` (when a retry-after is known) or `handler_failed { retryable: true }`. The row stays claimed — **do not HTTP 200** that park. See [webhook-inbox.md §6](./webhook-inbox.md#6-modes-inline-vs-durable_retry).

---

## 3. Crash during handler

### Store state

- Still `claimed` under the active lease until expiry or fail/complete.
- No terminal `completed` / `dead_letter` yet (unless another worker already took over after expiry — see fencing).

### Handler

- **Partially ran.** External side effects may be zero, partial, or fully applied depending on where the process died.

### Provider retry

- Typically **yes** if the HTTP response was not a successful ACK (timeout, 5xx).
- In `durable_retry` with deliberate ACK-after-schedule policies, provider may not retry; **your worker** must still complete via `processRetryable`. Do not ACK the provider unless durable persistence and a worker path are real.

### Outcome to surface

- No `processed` unless `store.complete` succeeded.
- Concurrent delivery while lease live: `already_processing`.
- After lease expiry + reclaim: handler runs again on the new lease → **at-least-once**.
- If the original worker later wakes and calls `complete`/`fail` with a **stale** token: `StoreLeaseLostError` / engine maps complete-after-success loss to `handler_failed { retryable: true }` — never `processed` on lease_lost after handler success.

### Idempotency

- **Mandatory.** Reclaim re-executes the handler. Use stable provider event ids / business keys so re-entry is a no-op when work already applied.

```typescript
handler: async (ctx) => {
  if (await db.isDone(ctx.providerEventId)) return;
  await db.applyOnce(ctx.providerEventId, ctx.event);
},
```

---

## 4. Crash after external side effect, before inbox complete

### Store state

- Still `claimed` (or lease expired → reclaimable).
- External system (orders DB, email, inventory) may already reflect success.
- Inbox **not** `completed`.

### Handler

- Finished application logic on this worker **or** finished enough that the side effect committed, but `store.complete` did not succeed (crash, network, or lease_lost).

### Provider retry

- Likely **yes** if HTTP incomplete / 5xx.
- Redelivery after expiry → reclaim → handler **runs again** even though the side effect already happened once.

### Outcome to surface

| Situation | Engine outcome |
| --- | --- |
| `complete` succeeds | `processed` |
| `complete` throws lease_lost (stale worker) | `handler_failed { retryable: true }` — **not** `processed` |
| Process dies before complete | No outcome; next path reclaim / retry |

**Never convert uncertain complete into `processed`.** Reporting success when the inbox is not terminal invites lost retries and double-fulfillment bugs in the opposite direction (ops thinking it is done when the row is still claimed).

### Idempotency

- **This is the critical boundary.** Handler re-run after reclaim must not double-charge, double-ship, or double-notify. Prefer:

  1. Idempotent writes keyed by `providerEventId` / inbox `key`.
  2. Outbox / transactional patterns when the side-effect store and inbox share a DB.
  3. Explicit “already applied” checks at the start of the handler.

### Stale worker (A4)

After reclaim, the **old** worker’s `complete`/`fail`/`renew` with the pre-reclaim token must fail fencing checks. Only the holder of the current `leaseToken` may terminalize the row.

---

## 5. Crash after completion

### Store state

- `status: "completed"` (terminal).
- Further `claim` → `already_completed`.

### Handler

- Ran to success on the completing worker; complete persisted.

### Provider retry

- Provider may still redeliver (at-least-once delivery is normal).
- App should return a **successful ACK** for duplicates per provider policy (example: HTTP 200) so noise stops — mapped from `duplicate_completed`, **not** by re-running fulfillment.

### Outcome to surface

- Redelivery → `{ outcome: "duplicate_completed" }`.
- Handler is **not** executed again for that claim path.

### Idempotency

- Still good practice (defense in depth if a bug re-enters the handler), but the engine’s completed fence is the primary guard against re-execution on this path.

---

## Summary table

| Boundary | Store | Handler ran? | Provider may retry? | Typical next outcome | Idempotent handler? |
| --- | --- | --- | --- | --- | --- |
| Before claim | Unchanged / absent | No | Yes (if no success ACK) | New `processVerified` | Best practice |
| After claim, before handler | `claimed` | No | Yes; peers see `already_processing` until expiry | Reclaim → run handler | Yes (for reclaim) |
| During handler | `claimed` | Partial | Yes | Reclaim → re-run | **Required** |
| After side effect, before complete | `claimed` | Yes (effect maybe done) | Yes | Reclaim re-run; stale complete rejected | **Required** |
| After complete | `completed` | Yes (prior) | Redeliver possible | `duplicate_completed` | Defense in depth |

---

## Modes and crashes

### `inline`

- Request usually waits for handler + complete.
- Crash mid-pipeline → no success HTTP → provider retries.
- Failure outcomes (`handler_failed`) should map to provider-visible retry (e.g. 5xx) when `retryable: true`.

### `durable_retry`

- Retryable handler failure → `store.fail` + `scheduled_for_retry { reason: "handler_retry" }` (row becomes pending after delay).
- `ackAfterClaim: true`: returns `scheduled_for_retry { reason: "parked" }` after durable claim/release **without** running the handler **only if** `store.fail({ restoreAttempt: true })` succeeds. Requires a materializable `envelope` / `event` (else retryable `handler_failed` before claim — WEBHOOKS-2, not `invalid_webhook`). Parking claim does not consume `maxAttempts` (`restoreAttempt`). Crash after that ACK is OK only if a **worker** runs `processRetryable`. ACK without a worker = lost work. Park `lease_lost` → `already_processing` / retryable `handler_failed` (never `parked`).
- Claim backoff (`not_available`) → durable `scheduled_for_retry { reason: "not_available" }`. **Inline maps `not_available` to `handler_failed { retryable: true }`** (WEBHOOKS-5). Adapters should prefer **5xx** so the provider redelivers when no durable scheduler owns the row (do not blind-ACK 200).
- **Hash source (WEBHOOKS-5):** `hashWebhookPayload` does **not** JSON-parse non-object strings. `hashWebhookPayload(rawBodyString)` and `hashWebhookPayload(parsedObject)` are different digests. Prefer `resolveInboxPayloadHash({ eventPayloadHash, payloadForHash })` with the same object shape the gateway hashed. Mixing sources on an **idle** row supersedes; an **active lease** returns `payload_conflict`. Do not treat those hashes as interchangeable under a live lease.
- Max **handler** attempts / default `NonRetryableHandlerError` → dead letter → `handler_failed { retryable: false }`. `{ deadLetter: false }` leaves pending until `maxAttempts` (prefer default).
- `processRetryable` is **only** valid on `durable_retry` engines (throws if the engine was built with `inline`).

---

## Related engine guarantees (acceptance A1–A6)

| ID | Guarantee |
| -- | --------- |
| A1 | Concurrent deliveries do not run the same handler concurrently (atomic claim). |
| A2 | Completed events do not re-run the handler (`duplicate_completed`). |
| A3 | Expired leases can be reclaimed; work may re-run under a new lease. |
| A4 | Stale workers cannot complete after reclaim (token fencing). |
| A5 | Conflicting payload hashes → `payload_conflict`. |
| A6 | `inline` vs `durable_retry` are explicit constructor modes. |

---

## See also

- [webhook-inbox.md](./webhook-inbox.md) — full engine guide
- [inbox-engine.md](./inbox-engine.md) — short pipeline cheat sheet
- [testkit store-contracts.md](../../testkit/docs/store-contracts.md) — store-level fencing and conformance
