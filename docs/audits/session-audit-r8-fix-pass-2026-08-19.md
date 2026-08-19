# PayKernel session-audit fix pass (2026-08-19, r8)

**Source of truth:** [`session-audit-2026-08-19-r8.md`](./session-audit-2026-08-19-r8.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-r8-fix-gate.rhai`  
**This document:** Stream K ownership map + residual-ID checklist.  
**Scope of this file:** `docs/audits/**` bookkeeping. Does **not** claim a post-fix gate result (that is `session-audit-r8-fix-result-2026-08-19.md` after a formal gate).  
**Working tree:** uncommitted session-audit (r8) diffs. Do **not** commit. Do **not** push. Do **not** re-open 2026-08-18 C1 / I1–I4 / I7–I9, or r7 S19 ship-gate closes, unless current code still has the **original** lie.

**Audit verdict at pass start:** **SHIP_BLOCKED**. This file is the audit start set, not a landing score. Integrate (workflow phase after A–J) updates landed-vs-remaining below. Formal gate writes `session-audit-r8-fix-result-2026-08-19.md`.

**This file is not a gate pass.**

**Blocking (must close — this pass’s ship gate):**

1. **S20-FINGERPRINT-REDACT**
2. **S20-DOCS-FULFILL**

Critic / implement streams skip any ID they prove already fixed against current code. Gate may also treat still-present money / fulfillment / fence lies from the should-fix set as blocking (see workflow: `S20-WH-FAIL-RECLAIM`, `S20-PAYPAL-REFUND-UNKNOWN`, `S20-PAYMOB-REDIR-TERM`).

Do **not** undo 2026-08-18 **C1**: unexpanded PI + `amount_received > 0` stays `paid` when there is no refund evidence.

Do **not** undo r7 **S19** closes: checkout timeout indeterminate, Paymob `parseJson`, redirect paid demote, `ifMatchPayloadHash` on `processRetryable`.

---

## Residual inventory (from session-audit 2026-08-19 r8)

Do not ship until **blocking** IDs are fixed and covered by tests that would have failed this audit.

**Counts:** 2 blocking + 12 should-fix + 5 nits = **19 residual IDs**.

### Blocking (must close)

Fingerprint identity hashes logger-style constant `[REDACTED]`, so two billing bags / two OTPs / two 13-digit ids collide. Docs people paste still fulfill in `onWebhookVerified` or on `event.status` without inbox claim + paid rematch + `gatewayPaymentId` bind.

| ID | Sev | One-line | Stream |
| --- | --- | --- | --- |
| **S20-FINGERPRINT-REDACT** | blocking | `fingerprintParams` hashes `redactForFingerprint(...)`. Logger redaction is correct for logs. It is wrong for “detect key reuse with different input.” Sensitive keys (`token`, `otp`, `email`, `phone`, `name`, `number`, `card`) and 13–19 digit PAN-like **values** become the literal `"[REDACTED]"`. Reproduced: two `paymobBillingData` bags, two `otpValue`s, two 13-digit `gatewayPaymentId`s share one SHA-256. Required: keep PII out of the stored record, but digest the real leaf (`[REDACTED:` + sha256Hex(value) + `]` or equivalent). Do **not** PAN-redact allow-listed ids (`gatewayPaymentId`, `orderId`, `paymentId`). Two billing bags / two OTPs / two 13-digit ids **must not** share a fingerprint. Economically identical money amounts must still collide. Flip the Visa/MC test: card numbers stay out of the digest string, but two different PANs must not collide (hash the leaf, do not constant-replace). | A |
| **S20-DOCS-FULFILL** | blocking | Live examples were fixed. Docs people paste were not. `hooks.md` ~42–47: `onWebhookVerified` → `updatePaymentStatus(event.paymentId, event.status)` (pre-claim, any status). `webhooks.md` ~211–219: fulfill in `onWebhookVerified` after homemade `alreadyProcessed`. `webhooks.md` ~312–314: inbox handler `fulfillOrder(ctx.event)` with no paid rematch / `gatewayPaymentId` bind. `docs/getting-started.md` ~206–217: provider recon snapshot uses local trusted money, not `getPayment` amounts. Core `README.md` Stripe sample comments mention inbox; code still fulfills on `event.status === "paid"` without claiming. Required: every sample matches `examples/checkout-kernel` + getting-started inbox section: claim first; fulfill only on `payment.succeeded` \| `capture.completed` **and** `payment.status === "paid"`; bind `gatewayPaymentId`. Build recon snapshots from `getPayment` money only. Never `if (result.success) fulfill()`. Never fulfill in `onWebhookVerified`. | C |

### Should-fix (same pass if ownership allows)

Honesty / outcome-infer / lease / fence / store-clock / provider-status holes. None of these are the two-item ship-gate list. Gate may promote a leftover that creates a money, fulfillment, or fence lie.

| ID | One-line | Stream |
| --- | --- | --- |
| **S20-SETUP-INFER** | `{ success: true, status: "setup_completed" }` with no explicit `outcome` infers `"failed"` (`isSettledSuccessStatus` omits `setup_completed`). Built-in Moyasar/Stripe dual-write `outcome: succeeded`. Custom adapters treat successful card-setup as a failed payment. Required: `setup_completed` → operation `succeeded` (still not `isPaidOutcome`). | B |
| **S20-FAILED-DECLINED** | `inferOperationOutcome` maps every `status: "failed"` to `declined` even with no `decline` object. A 5xx-mapped snapshot then looks like a hard card decline. Required: bare `status: "failed"` without `decline` → `failed`. `declined` only when `result.decline` is present or an explicit `outcome: declined`. Flip tests that lock `{ success: false, status: "failed" }` → `"declined"` unless a decline object is present. | B |
| **S20-WH-FAIL-RECLAIM** | `processRetryable` claims with `ifMatchPayloadHash` (S19 closed). `bestEffortRecordFailAfterLeaseLost` does **not**. After the handler ran and `fail()` is `lease_lost`, idle WEBHOOKS-3 `processVerified` can move the row to `hash-b`. This reclaim still writes `hash-a` and may dead-letter the old body. Required: pass `ifMatchPayloadHash: args.payloadHash`. On `payload_hash_conflict`, skip — do not rewrite. Add a get→reclaim race test. | G |
| **S20-HEARTBEAT-RACE** | `stopHeartbeat()` only `clearInterval`. No `closed` flag. A tick already in the macrotask queue can `renew()` after `await renewTail` and rotate `currentToken` while `complete` uses the previous token → `lease_lost` → `handler_failed` after a successful fulfill → retry → duplicate fulfillment unless the handler is idempotent. Same shape in recon `runProcessDueHandlerUnderLease`. Required: `let closed = false`; ignore renew after stop; set `closed` before awaiting the tail; do not rotate after close. | G (engine) + H (scheduler) |
| **S20-MEM-GET-WIPE** | Durable webhook/recon `get()` is read-only (S19-CLOCK-LEASE). Memory `get()` still `releaseExpiredLease()` and clears `lease_token` (testkit, webhooks memory, recon memory). Required: pure read on memory `get()`, like idempotency memory and Redis `WEBHOOK_GET_LUA`. Soft-release only on list/claim. | I |
| **S20-REDIS-IFMATCH-EMPTY** | Redis `input.ifMatchPayloadHash ?? ""` and Lua `if ifMatchPayloadHash ~= ''` treat empty string as **omit** (idle WEBHOOKS-3 supersede still runs). SQL/memory treat `""` as CAS-match-empty. Required: omit only when the field is missing/NULL. Reject empty hashes at the store boundary. Never treat `""` as omit. | I |
| **S20-CLAIM-DUE-N** | `claimDue` claims sequentially but still **returns N live leases**. Serial host work on that array is the original peer-steal / `lease_lost` after the handler ran. README says prefer `processDue`. Required: claim-one-and-return, **or** types/README make `claimDue` discovery-only and `processDue` the only production worker. If you keep bulk return, README/types must say hosts must not do serial work on the array. | H |
| **S20-LIST-NOW** | Durable `get()` is closed. `listDue` / `listRetryable` on Postgres/SQLite/Turso/D1/Redis still wipe with `input.now`. Recon `processDue` always passes scheduler `now`. If that clock is ahead of the store clock that issued the lease, list clears an unexpired token. Required: match DO recon: wipe only with issuer/`ctx.clock`; use caller `now` only for due/available **filters**. Keep FakeClock: inject the store clock in tests. | I |
| **S20-SQLITE-MEMORY** | `openBunSqliteDatabase(path = ":memory:")` (and sibling open helpers) default to ephemeral memory while `SQLITE_STORAGE_ADAPTER_MANIFEST.durability` is `"durable"`. File-backed factories do not apply `busy_timeout` / WAL by default. Required: no `:memory:` default on production open helpers (require an explicit path). Document `:memory:` as ephemeral. Apply `busy_timeout` on file-backed factories if cheap. Do not change `engines.node` honesty already documented. | I |
| **S20-PAYPAL-REFUND-UNKNOWN** | `mapRefundStatus` maps anything outside `COMPLETED` / `PENDING` / `FAILED` / `CANCELLED` to **`failed`**. HTTP 200 means PayPal accepted the refund POST. Tests lock `WEIRD_NEW_STATUS` → `failed`. A caller that retries the “failed” refund with a **new** `PayPal-Request-Id` can refund twice. Required: after HTTP 200, unknown refund status → `pending` or `indeterminate`, never `failed`. Flip the test. | D |
| **S20-PAYMOB-REDIR-TERM** | `redirectEnvelopeStatus` only demotes paid / authorized / partials / refunded → `processing`. A signed redirect with `is_voided=true` still yields envelope `cancelled` and stable `payment.cancelled`; `success=false` yields `payment.failed`. Handlers that restock/fail the order on those arms can run from a replayable GET. Required: demote **all** terminal redirect stables (`payment.cancelled`, `payment.failed`, `refund.*`) and envelope statuses (`cancelled`, `failed`, `refund_completed`, …) to `processing`. Flip tests. | E (envelope) + F (mapper dual-write) |
| **S20-PAYMOB-AMOUNT-REFUND** | `mapPaymobTransactionSignals` (no flags): amount-only `refundedAmountCents > 0` ranks above decisive `fromStatus` except processing/refund.pending/refund.failed. `status: "paid"` + leftover refund cents can stay `refund.completed`. Required: do not amount-promote over a decisive `fromStatus`. Only use amount-only refund when `fromStatus` is undefined. | F |

### Nits (same pass if cheap)

| ID | One-line | Stream |
| --- | --- | --- |
| **S20-PAYPAL-JSON** | `parseJsonResponse` empty → `{}`; invalid JSON → `{ name, message }`. Mutations then fail closed via `assert*Response(..., afterProviderSubmit)`. GET inquiry throws status-`0` “missing id”. Throw on empty/non-JSON: mutating + `afterProviderSubmit`; GET → `GatewayApiError` without inventing `{}`. | D |
| **S20-PAYMOB-SUCCESS-OMIT** | Inquiry with real `id` / `amount_cents` but omitted `success` maps declined. Missing `success` on an identified txn → `processing` / throw unavailable, not `declined`. Keep explicit `success: false` as failed. | E |
| **S20-CREATE-COUNT** | `GET /internal/create-count` is not `enableTestHooks`-gated. | J |
| **S20-TRAILING-ZERO** | `money("10.500", "USD")` / `money("100.00", "JPY")` throw `excess_precision`. Strip trailing zeros on the unused remainder before `reject`. | A |
| **S20-RETRY-NAN** | `Math.max(1, NaN)` is `NaN` → `throw undefined`. Sanitize `maxAttempts` to a finite integer ≥ 1. | B |

### Out of scope for this pass

Do not spend this pass on: Stripe `webhookSecrets[]` rotation; Moyasar token-in-body protocol (document inbox + HTTPS only; do not invent a header HMAC); Stripe/PayPal `createPayment` ephemeral request id (documented residual; mutations already require caller key); 0.x major-unit `number` results; C1 (unexpanded `latest_charge` + `amount_received > 0` stays `paid` when no refund snapshot). Formal prior bookkeeping files must not be read as this verdict.

---

## Stream ownership

Non-overlapping file ownership from `paykernel-session-audit-r8-fix-gate.rhai`. Streams must not edit another stream's files. Shared IDs are split by path, not by “whoever gets there first.”

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | FINGERPRINT + MONEY TRAILING ZEROS | `packages/core/src/utils/idempotency.ts`, `packages/core/src/utils/utils.test.ts`, `packages/core/src/utils/money.ts`, `packages/core/src/utils/money.test.ts`, `packages/core/src/utils/money.edge.test.ts` if needed | **S20-FINGERPRINT-REDACT**; nit **S20-TRAILING-ZERO** |
| **B** | PHASE-6 OUTCOMES + RETRY | `packages/core/src/types/operation-result.ts`, `packages/core/src/types/operation-result.test.ts`, `packages/core/src/types/operation-results.acceptance.test.ts` if needed, `packages/core/src/utils/retry.ts`; retry tests prefer a dedicated `retry.test.ts` (do not revert A fingerprint tests in shared `utils.test.ts`) | **S20-SETUP-INFER**, **S20-FAILED-DECLINED**; nit **S20-RETRY-NAN** |
| **C** | DOCS SAMPLES | `packages/core/docs/hooks.md`, `packages/core/docs/webhooks.md`, `packages/core/README.md`, `docs/getting-started.md` | **S20-DOCS-FULFILL** |
| **D** | PAYPAL GATEWAY | `packages/core/src/gateways/paypal/**`, `packages/core/docs/paypal.md` if needed | **S20-PAYPAL-REFUND-UNKNOWN**; nit **S20-PAYPAL-JSON** |
| **E** | PAYMOB GATEWAY | `packages/core/src/gateways/paymob/**`, `packages/core/docs/paymob.md` if needed | **S20-PAYMOB-REDIR-TERM** (envelope); nit **S20-PAYMOB-SUCCESS-OMIT** |
| **F** | CORE MAPPER | `packages/core/src/types/webhook-event-map.ts`, `packages/core/src/types/payment-event.test.ts` mapper tests if they live there | **S20-PAYMOB-AMOUNT-REFUND**; mapper dual-write half of **S20-PAYMOB-REDIR-TERM** (`payment.cancelled` / `payment.failed` / `refund.*` → `payment.processing`) |
| **G** | WEBHOOKS ENGINE | `packages/webhooks/src/engine.ts`, `packages/webhooks/src/engine.test.ts`, `packages/webhooks/src/engine.crash.test.ts` if needed, `packages/webhooks/docs/**` if needed | **S20-WH-FAIL-RECLAIM**; **S20-HEARTBEAT-RACE** (engine only) |
| **H** | RECONCILIATION SCHEDULER | `packages/reconciliation/src/scheduler.ts`, `packages/reconciliation/src/scheduler.test.ts`, `packages/reconciliation/README.md` | **S20-CLAIM-DUE-N**; **S20-HEARTBEAT-RACE** (scheduler only) |
| **I** | STORES MEMORY / REDIS / LIST / SQLITE OPEN | `packages/testkit/src/memory/memory-stores.ts`, `packages/webhooks/src/memory-store.ts`, `packages/reconciliation/src/memory-store.ts`, matching memory-store tests; `packages/store-redis/src/scripts/webhook-inbox.lua.ts`, `packages/store-redis/src/stores/webhook-inbox-store.ts`, `packages/store-redis/src/stores/stores.mock.test.ts` if needed; `packages/store-postgres/src/stores/**` list wipe clock only; `packages/store-sqlite/src/stores/**` list wipe clock + open helpers under `drivers/`; `packages/store-turso/src/stores/**` list wipe clock; `packages/store-d1/src/stores/**` list wipe clock; `packages/store-durable-objects/src/stores/**` webhook list wipe clock if still using `input.now` | **S20-MEM-GET-WIPE**, **S20-REDIS-IFMATCH-EMPTY**, **S20-LIST-NOW**, **S20-SQLITE-MEMORY** |
| **J** | EXAMPLES | `examples/**` | nit **S20-CREATE-COUNT** |
| **K** | AUDIT BOOKKEEPING | `docs/audits/**` | this file (bookkeeping only) |

No stream owns `packages/core/src/client.ts`, Stripe / Moyasar gateways, `packages/routing/**`, or `packages/observability/**` this pass. Stream **A** owns fingerprint identity only — not `logger.ts` log redaction. Stream **C** owns docs samples only — not `examples/**` (**J**) and not production `src`.

### Ownership fences (do not cross)

- **A** must not edit `logger.ts` (log redaction stays constant `[REDACTED]`). **A** must not edit gateways, stores, docs, or examples. Change fingerprint identity only. Keep AbortSignal strip. Do **not** undo C1.
- **B** must not edit `idempotency.ts` or `money.ts` (**A**). **B** must not edit gateways. If `utils.test.ts` is contested, put retry tests in `packages/core/src/utils/retry.test.ts`. Do not revert stream A fingerprint tests.
- **C** must not edit `examples/**` (**J**). **C** must not edit production `src` at all.
- **D** must not edit other gateways or `webhook-event-map.ts` (**F**). After HTTP 200, unknown refund status is never `failed`.
- **E** must not edit `webhook-event-map.ts` (**F** owns amount-promote + mapper dual-write). **E** owns `redirectEnvelopeStatus` demotion of cancelled / failed / refund terminals. Keep explicit `success: false` as failed.
- **F** must not edit gateways or `client.ts`. **S20-PAYMOB-AMOUNT-REFUND** is `mapPaymobTransactionSignals` only. Mapper dual-write of redirect `payment.cancelled` / `payment.failed` / `refund.*` → `payment.processing` is **F**, not **E**.
- **G** must not edit `memory-store.ts` (**I**). **G** must not edit examples (**J**) or the recon scheduler (**H**). Keep `processRetryable` `ifMatch` (S19) intact.
- **H** must not edit store adapters (**I**) or the webhooks engine (**G**). **S20-CLAIM-DUE-N** / scheduler heartbeat are scheduler + README only.
- **I** must not edit `sql-foundation` claim UPSERT unless required to stop empty-string-as-omit. **I** must not edit the reconciliation scheduler (**H**) or webhooks engine (**G**). Do **not** switch all SQL comparisons to `NOW()` if that breaks FakeClock.
- **J** must not edit `packages/*`.
- **K** must not edit production `src` / `packages/**`.
- Prefer existing `PaymentStatus` values. Fail-closed on incomplete money. Never convert an uncertain mutation outcome into a retryable failure that **clears** a fence. Always publish currency together with major-unit amount fields.

### Split / adjacent IDs

**S20-HEARTBEAT-RACE (G + H)**

1. **G (engine):** `closed` flag so renew after `stopHeartbeat` cannot rotate the token used by `complete`.
2. **H (scheduler):** same `closed` flag in `runProcessDueHandlerUnderLease` only.

**S20-PAYMOB-REDIR-TERM (E + F)**

1. **E (envelope):** `redirectEnvelopeStatus` demotes cancelled / failed / refund-completed / refunded-like to `processing` (paid / authorized already demoted in S19).
2. **F (mapper):** demote `TRANSACTION_RESPONSE` dual-write of `payment.cancelled` / `payment.failed` / `refund.*` to `payment.processing` (browser GET).

**S20-FINGERPRINT-REDACT vs r7 S19-FINGERPRINT**

r7 stored `sha256Hex(stableStringify(redact(...)))`. Residual is the **redact leaf**: constant `"[REDACTED]"` makes distinct PII/OTP/PAN bags collide. **A** must hash the real leaf and allow-list `gatewayPaymentId` / `orderId` / `paymentId`. Do not re-open S19’s “persist a hash, not raw stringify” close.

**S20-WH-FAIL-RECLAIM vs r7 S19-WH-HASH-TOCTOU**

S19 closed `processRetryable` claim `ifMatchPayloadHash`. Residual is **fail-after-lease-lost reclaim** still writing without the fence. **G** must pass `ifMatchPayloadHash: args.payloadHash` and skip on `payload_hash_conflict`. Do not re-open the S19 claim path.

**S20-DOCS-FULFILL vs r7 S19-DOCS-SUCCESS**

S19 closed core README / `index.ts` `if (result.success) fulfill()`. Residual is **hooks.md / webhooks.md / getting-started / README webhook sample** still teaching pre-claim fulfill. **C** owns those docs. **J** owns live examples (already fixed; only `S20-CREATE-COUNT` this pass).

---

## Recommended close (audit §)

1. S20-FINGERPRINT-REDACT  
2. S20-DOCS-FULFILL  
3. Should-fix pack (S20-SETUP-INFER, S20-FAILED-DECLINED, S20-WH-FAIL-RECLAIM, S20-HEARTBEAT-RACE, S20-MEM-GET-WIPE, S20-REDIS-IFMATCH-EMPTY, S20-CLAIM-DUE-N, S20-LIST-NOW, S20-SQLITE-MEMORY, S20-PAYPAL-REFUND-UNKNOWN, S20-PAYMOB-REDIR-TERM, S20-PAYMOB-AMOUNT-REFUND)  
4. Cheap nits (S20-PAYPAL-JSON, S20-PAYMOB-SUCCESS-OMIT, S20-CREATE-COUNT, S20-TRAILING-ZERO, S20-RETRY-NAN)  

Items **1–2** are this pass’s ship gate (blocking). Item **3** is same-pass should-fix — gate may promote a leftover money / fulfillment / fence lie. Item **4** is optional if cheap.

---

## Already closed (do not re-open)

From session-audit r7 (2026-08-19) ship-gate, r6 (2026-08-18), and earlier leftover / ship-gates. Do **not** re-open unless current code still has the **original** lie.

**r7 blocking (closed):**

```
S19-CKO-TIMEOUT,
S19-PAYMOB-JSON,
S19-PAYMOB-REDIR-STATUS,
S19-PAYMOB-REFUND-UNPAID,
S19-MAP-REFUND-PENDING,
S19-WH-HASH-TOCTOU,
S19-STRIPE-LATE-REFUND
```

**r7 should-fix (closed in original shape):**

```
S19-PAYMOB-LEGACY-ID, S19-CKO-AMOUNT, S19-CKO-GET, S19-STRIPE-CHARGE-SWALLOW,
S19-STRIPE-DISPUTE, S19-EPHEMERAL-KEY (Stripe), S19-CLOCK-LEASE, S19-CLAIM-DUE,
S19-RECON-HB, S19-FINGERPRINT, S19-EXAMPLE-BIND, S19-EXAMPLE-RECON,
S19-EXAMPLE-AMOUNT, S19-DOCS-SUCCESS
```

**r6 blocking (closed):**

```
C1-STRIPE-PI-UNEXPANDED,
I1-PAYMOB-UNSIGNED-ACTION,
I2-PAYMOB-MUTATION-FENCE,
I3-PAYMOB-FLAGS-PENDING,
I4-REDIS-RESERVED-KEYS,
I7-EXAMPLE-RECON-BIND,
I8-HEX-TO-BYTES,
I9-BEHAVIORAL-CONTRACTS
```

**r6 should-fix (closed in original shape):**

```
I5-LEASE-HEARTBEAT, I6-DURABLE-ACK, I10-MISSING-SECRET-CLASS,
I11-WH-SANITIZE, I12-RECON-SANITIZE, I13-WH-PAYMOB-STATUS,
I14-STALE-HASH-SUPERSEDE, I15-DO-ENSURE-SCHEMA, I16-EXAMPLE-PROVIDER-PAID
```

**Earlier leftovers / ship-gates (still closed):**

```
NEW-PAYPAL-7, NEW-STRIPE-REFUND-0, NEW-MOYASAR-JSON-1, NEW-WH-KEY-1, NEW-ROUTE-CCY-1,
NEW-STORE-3/4/5, NEW-CORE-11, NEW-STRIPE-0, NEW-PERF-9, NEW-PERF-1,
NEW-OBS-3, NEW-ROUTE-2, NEW-TESTKIT-FP-1,
NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX, NEW-PAYPAL-3, NEW-CORE-8, NEW-STRIPE-VOID-1,
PAYMOB-FENCE-1/2/3, CORE-INF-1/2, MONEY-1, WEBHOOKS-403,
NEW-WEBHOOKS-2 (legacy {status} bags only),
WEBHOOKS-1, CORE-1–8 (original), STRIPE-1/2, STRIPE-CKO-1/CHG-1,
NEW-STRIPE-3 / CKO-200 / 1 / 2, PAYPAL-1/3, PAYPAL-IDEM-1 / DW-1 / ID-1,
NEW-PAYPAL-1, PAYMOB-1/2, PAYMOB-TOCTOU, AUTH-REDIR,
NEW-PAYMOB-2/TTL/REFUND-0, MOYASAR-CAP-0, NEW-MOYASAR-1/2/3,
CORE-HW-1, NEW-CORE-1–7, REDIS-1, RECON-1/2/3,
NEW-RECON-1/2, PERF-1/2, NEW-WEBHOOKS-1, historical PP0–ST1,
NEW-STRIPE-INV-1 / CKO-URL / SETUP-1,
NEW-CORE-9 / NEW-CORE-10, NEW-MONEY-3,
NEW-PAYPAL-4 / 5 / 6, NEW-MOYASAR-4XX, NEW-WH-1, NEW-ROUTE-1,
NEW-STORE-2, leftover-r4 NEW-STORE-3 (webhooks memory only),
NEW-TESTKIT-6/7/8, NEW-OBS-2, NEW-PKG-2, NEW-SQL-1, NEW-PERF-8
```

These are leftover **adjacent** classes, not regressions of the original IDs:

| Prior close | This-pass leftover |
| --- | --- |
| r7 **S19-FINGERPRINT** (persist `sha256Hex(stableStringify(redact(...)))`, not raw stringify) | **S20-FINGERPRINT-REDACT**: redact still constant-replaces PII/OTP/PAN leaves, so distinct bags collide |
| r7 **S19-DOCS-SUCCESS** (README / `index.ts` never `if (result.success) fulfill()`) | **S20-DOCS-FULFILL**: `hooks.md` / `webhooks.md` / getting-started / README sample still fulfill in `onWebhookVerified` or on `event.status` without claim + paid rematch |
| r7 **S19-WH-HASH-TOCTOU** (`processRetryable` claims with `ifMatchPayloadHash`) | **S20-WH-FAIL-RECLAIM**: `bestEffortRecordFailAfterLeaseLost` still omits the fence and can rewrite `hash-b` back to `hash-a` |
| r7 **S19-CLOCK-LEASE** (durable `get()` is read-only) | **S20-MEM-GET-WIPE**: memory `get()` still `releaseExpiredLease()`. **S20-LIST-NOW**: list still wipes with caller `now` |
| r7 **S19-CLAIM-DUE** (claim one-at-a-time; README prefers `processDue`) | **S20-CLAIM-DUE-N**: still **returns N live leases**; serial host work on the array is the original peer-steal |
| r7 **S19-PAYMOB-REDIR-STATUS** (demote paid / authorized / partial / refunded → `processing`) | **S20-PAYMOB-REDIR-TERM**: cancelled / failed / refund terminals on a replayable GET still settle |
| r7 **S19-MAP-REFUND-PENDING** (pending / `refund_pending` before refund arms) | **S20-PAYMOB-AMOUNT-REFUND**: amount-only refund cents still rank over a decisive `fromStatus` |
| r6 **I5** webhook lease heartbeat | **S20-HEARTBEAT-RACE**: `stopHeartbeat` can still rotate after stop (engine + recon scheduler) |
| r7 **S19-PAYMOB-JSON** (Paymob `parseJson` never `{}`) | **S20-PAYPAL-JSON** (nit): PayPal `parseJsonResponse` still invents `{}` / `{ name, message }` |

---

## Stream K / integrate status

Stream K wrote the ownership + residual checklist (no `packages/**` edits, no production `src`).

**Integrate (this update):** re-read current source after streams A–J. No parallel-stream TS breakage (`bun run typecheck` exit 0). No remaining tests still locking the r8 lies (Visa/MC collision, bare `failed`→`declined`, `WEIRD_NEW_STATUS`→`failed`, redirect cancelled/failed terminals). Typecheck + required test set green. This file is **not** a formal gate pass (`session-audit-r8-fix-result-2026-08-19.md` is still unwritten).

**fixed_ids (this stream):** none — K is bookkeeping only. Integrate recorded landed-vs-remaining; production `src` was already closed by A–J.

**Verify (2026-08-19):**

| Check | Result |
| --- | --- |
| `bun run typecheck` | exit 0 (core through examples) |
| `bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples` | **2368 pass / 31 skip / 0 fail** |
| S20-FINGERPRINT-REDACT | holds — two billing bags / two `otpValue`s / two 13-digit allow-listed ids do not share a fingerprint |
| S20-DOCS-FULFILL | holds — no `onWebhookVerified` fulfill samples in owned docs |
| S20-WH-FAIL-RECLAIM | holds — `bestEffortRecordFailAfterLeaseLost` claims with `ifMatchPayloadHash` |
| S20-PAYPAL-REFUND-UNKNOWN | holds — HTTP 200 unknown refund status is `pending`, not `failed` |
| S20-PAYMOB-REDIR-TERM | holds — redirect cancelled / failed / refund terminals are envelope + dual-write `processing` |
| C1 | holds — unexpanded PI + `amount_received > 0` stays `paid` without a refund snapshot |

31 skips are live Postgres / Redis / better-sqlite3 (no server / optional engine). Do **not** commit. Do **not** push.

**Blocking at pass start (ship gate):**

- S20-FINGERPRINT-REDACT
- S20-DOCS-FULFILL

Both original lies are gone in current source.

---

## What landed vs remaining (integrate, against current source)

Do **not** treat this section as a formal gate pass.

### Blocking (ship gate) — original lies gone

| ID | Landed? | Current source |
| --- | --- | --- |
| **S20-FINGERPRINT-REDACT** | yes | `redactForFingerprint` hashes sensitive leaves as `[REDACTED:` + `sha256Hex(stableStringify(value))` + `]`. Allow-listed ids (`gatewayPaymentId` / `orderId` / `paymentId`) are not PAN-hashed. Tests: two `paymobBillingData` bags, two `otpValue`s, two 13-digit ids do not share SHA-256; Visa vs Mastercard do not collide; economically identical money still collides. Logger `redact` stays constant `[REDACTED]`. |
| **S20-DOCS-FULFILL** | yes | `hooks.md` verify hook is metrics-only. Core `webhooks.md` / README / `docs/getting-started.md` claim via `@paykernel/webhooks`, then fulfill only on rematched `payment.succeeded` \| `capture.completed` **and** `payment.status === "paid"`, binding `gatewayPaymentId`. Getting-started recon snapshots use `getPayment` money only. No `onWebhookVerified` fulfill samples. No `if (result.success) fulfill()`. **Residual (not the original lie):** `packages/webhooks/docs/webhook-inbox.md` pipeline still shows post-claim `fulfillOrder(ctx.event)` without rematch/bind. `packages/core/src/index.ts` JSDoc still says fulfill after claim “when `event.status === 'paid'`” (no code fulfill). |

### Should-fix — original lies gone

| ID | Landed? | Current source |
| --- | --- | --- |
| **S20-SETUP-INFER** | yes | `isSettledSuccessStatus` includes `setup_completed`. Bare `{ success: true, status: "setup_completed" }` infers `succeeded`. `isPaidOutcome` stays false. Test: leftover `nextAction` does not demote setup. |
| **S20-FAILED-DECLINED** | yes | `outcomeForFailedStatus`: bare `status: "failed"` without `decline` → `failed`. `declined` only with `result.decline` or explicit `outcome: declined`. Tests flipped off `{ success: false, status: "failed" }` → `"declined"`. |
| **S20-WH-FAIL-RECLAIM** | yes | `bestEffortRecordFailAfterLeaseLost` claims with `ifMatchPayloadHash: args.payloadHash`. `payload_hash_conflict` skips (no rewrite). Test: listed `hash-a` + idle `hash-b` at reclaim stays `hash-b` (not dead-lettered). `processRetryable` `ifMatch` (S19) intact. |
| **S20-HEARTBEAT-RACE** | yes | G engine + H scheduler: `closed` flag; `stopHeartbeat` sets `closed` before `clearInterval` / awaiting the tail; `renew` no-ops after close (does not rotate the token `complete` will use). Tests on engine + `runProcessDueHandlerUnderLease`. |
| **S20-MEM-GET-WIPE** | yes | testkit / webhooks memory / recon memory `get()` is read-only (no `releaseExpiredLease`). Soft-release stays on list/claim. Tests: expired `get` keeps `lease_token` until list. |
| **S20-REDIS-IFMATCH-EMPTY** | yes | Store rejects empty `payloadHash` / `ifMatchPayloadHash`. Lua `ifMatchPresent` (`ARGV[11] === '1'`) CASes even when the hash string is empty; omit only when the field is missing. Tests: empty ifMatch throws; omitted binds present flag `0`. |
| **S20-CLAIM-DUE-N** | yes (documented) | `claimDue` still **returns N live leases** (API unchanged). Types + README say it is discovery / test inspection only; hosts must not serial-work the array. `processDue` is the only production worker (claim-one-then-handler + heartbeat). Tests lock one-at-a-time claim and the bulk-return honesty note. |
| **S20-LIST-NOW** | yes | Postgres / SQLite / Turso / D1 / Redis / DO webhook + recon list wipe with issuer/`ctx.clock`; caller `now` is the due/available **filter** only. Memory listDue/listRetryable keep FakeClock via injected store clock. Tests: caller now ahead of issuer does not clear a live token. |
| **S20-SQLITE-MEMORY** | yes | `openBunSqliteDatabase` / `openNodeSqliteDatabase` / `openBetterSqlite3Database` require an explicit `path`. `:memory:` is documented ephemeral (does not satisfy `durability: "durable"`). File-backed opens apply `busy_timeout`. `engines.node` honesty unchanged. |
| **S20-PAYPAL-REFUND-UNKNOWN** | yes | `mapRefundStatus` maps unknown HTTP 200 statuses to `pending` (never `failed`). Test: `WEIRD_NEW_STATUS` is `pending` / `success: true`, not `failed`. |
| **S20-PAYMOB-REDIR-TERM** | yes | E: `redirectEnvelopeStatus` demotes every non-pending/non-processing mapped status (cancelled / failed / refund terminals included) to `processing`. F: `TRANSACTION_RESPONSE` dual-write demotes `payment.cancelled` / `payment.failed` / `refund.*` to `payment.processing`. Processed `TRANSACTION` still publishes those arms. Tests flipped. |
| **S20-PAYMOB-AMOUNT-REFUND** | yes | `mapPaymobTransactionSignals` uses amount-only `refundedAmountCents` only when `fromStatus` is undefined. `status: "paid"` + leftover refund cents stays `payment.succeeded`. |

### Nits

| ID | Landed? | Notes |
| --- | --- | --- |
| **S20-PAYPAL-JSON** | yes | `parseJsonResponse` throws on empty / invalid JSON. Mutating HTTP 200 → `afterProviderSubmit` indeterminate; GET → `GatewayApiError` (no invented `{}`). |
| **S20-PAYMOB-SUCCESS-OMIT** | yes | `mapTransactionStatus` omitted `success` → `processing`. Inquiry test: identified txn without `success` is `requires_action`, not `declined`. Explicit `success: false` stays failed / declined. |
| **S20-CREATE-COUNT** | yes | `GET /internal/create-count` is `enableTestHooks`-gated (404 without the flag) in checkout-kernel + Hono/Elysia. |
| **S20-TRAILING-ZERO** | yes | `money` strips unused trailing-zero remainder before `excess_precision`. `money("10.500", "USD")` / `money("100.00", "JPY")` accept. |
| **S20-RETRY-NAN** | yes | `sanitizeMaxAttempts` coerces NaN / ±∞ / non-number to 1; fractions trunc to a finite integer ≥ 1. Dedicated `retry.test.ts`. |

### Integrate-only notes (not residual IDs)

- No TS merge conflicts / no typecheck errors from parallel streams.
- Lie-locking tests already flipped by owning streams; integrate found none still expecting Visa/MC collision, bare failed→declined, unknown PayPal refund→failed, or redirect cancelled/failed terminals.

### Remaining for gate / later

- **Docs residual:** `packages/webhooks/docs/webhook-inbox.md` still pastes post-claim `fulfillOrder(ctx.event)` / `fulfill(ctx.event)` without paid rematch + `gatewayPaymentId` bind. Not an `onWebhookVerified` sample (S20-DOCS-FULFILL original lie is closed).
- **S20-CLAIM-DUE-N API:** bulk return remains; close is documentation + `processDue` as the only production worker.
- Formal gate artifact `session-audit-r8-fix-result-2026-08-19.md` is **not** this file.
- Out of scope unchanged: Stripe `webhookSecrets[]`, Moyasar token-in-body, Stripe/PayPal `createPayment` ephemeral request id, 0.x major-unit `number` results, C1.

**Working tree:** uncommitted. Do **not** commit. Do **not** push.

---

## Residual ID checklist (copy for critic / gate)

Integrate flipped these against current source. Do **not** treat checked boxes here as a formal gate pass.

### Blocking (ship gate)

- [x] S20-FINGERPRINT-REDACT
- [x] S20-DOCS-FULFILL

### Should-fix

- [x] S20-SETUP-INFER
- [x] S20-FAILED-DECLINED
- [x] S20-WH-FAIL-RECLAIM
- [x] S20-HEARTBEAT-RACE (G engine + H scheduler)
- [x] S20-MEM-GET-WIPE
- [x] S20-REDIS-IFMATCH-EMPTY
- [x] S20-CLAIM-DUE-N
- [x] S20-LIST-NOW
- [x] S20-SQLITE-MEMORY
- [x] S20-PAYPAL-REFUND-UNKNOWN
- [x] S20-PAYMOB-REDIR-TERM (E envelope + F mapper)
- [x] S20-PAYMOB-AMOUNT-REFUND

### Nits

- [x] S20-PAYPAL-JSON
- [x] S20-PAYMOB-SUCCESS-OMIT
- [x] S20-CREATE-COUNT
- [x] S20-TRAILING-ZERO
- [x] S20-RETRY-NAN

**Working tree:** uncommitted. Do **not** commit. Do **not** push.
