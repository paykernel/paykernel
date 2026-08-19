# Session-audit r8 fix-gate result (2026-08-19)

**Source of truth:** [`session-audit-2026-08-19-r8.md`](./session-audit-2026-08-19-r8.md)  
**Bookkeeping (not this verdict):** [`session-audit-r8-fix-pass-2026-08-19.md`](./session-audit-r8-fix-pass-2026-08-19.md)  
**Adversarial gate (this pass):** [`session-audit-r8-fix-gate-2026-08-19.md`](./session-audit-r8-fix-gate-2026-08-19.md) — `pass: true`. This file is the formal result artifact.  
**Workflow:** `.grok/workflows/paykernel-session-audit-r8-fix-gate.rhai`  
**Method:** adversarial re-read of current source (`read_file` / `grep`). Implement/integrate summaries were pointers only. Residuals listed below were grepped in tree; no extra close was invented.

| Field | Value |
| --- | --- |
| `final_pass` | **true** |
| `typecheck_ok` | **true** — `bun run typecheck` exit 0 (core through examples) |
| `tests_ok` | **true** — `bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples` → **2368 pass / 31 skip / 0 fail** |
| `invariants_ok` | **true** — C1 holds (unexpanded `latest_charge` + `amount_received > 0` stays `paid` with no refund snapshot). r7 S19 ship-gate closes (S19-CKO-TIMEOUT, S19-PAYMOB-JSON, S19-PAYMOB-REDIR-STATUS, S19-PAYMOB-REFUND-UNPAID, S19-MAP-REFUND-PENDING, S19-WH-HASH-TOCTOU, S19-STRIPE-LATE-REFUND) were not reopened. |
| `gate_pass` | **true** |
| `gate_summary` | r8 adversarial gate PASS. Named blockers closed in source: fingerprint hashes sensitive leaves (billing/otp/13-digit ids and Visa vs MC differ); core hooks.md/webhooks.md never fulfill in onWebhookVerified and inbox samples rematch paid+bind; reclaim uses ifMatchPayloadHash; PayPal HTTP 200 unknown refund is pending; Paymob redirect cancelled/failed/refund are envelope+dual-write processing. bun run typecheck exit 0. Required tests 2368 pass / 31 skip / 0 fail. C1 and r7 S19 closes hold. Leftovers are webhook-inbox.md paste, JSDoc wording, bulk claimDue API, Paymob explicit failed→declined, fingerprint depth cap. |
| `implement_ok` / `implement_fail` | **11 / 0** |

31 skips are live Postgres / Redis / better-sqlite3 (no server / optional engine). Isolated WAL flake was not in this set.

---

## Blocking

*(empty — no ship-gate leftovers)*

---

## Non-blocking residual

- **S20-DOCS residual:** `packages/webhooks/docs/webhook-inbox.md` still pastes post-claim `fulfill(ctx.event)` / `fulfillOrder(ctx.event)` without paid rematch + `gatewayPaymentId` bind (pipeline sketch ~108–110, recommended verify+process ~157, `processWithVerifier` ~201, gateway-only ~226, `processRetryable` ~455–464). Not `onWebhookVerified`. Core `hooks.md` / `webhooks.md` / README / getting-started are rematch+bind.
- **`packages/core/src/index.ts` JSDoc** still says fulfill after inbox claim when `event.status === 'paid'` (no rematch type gate, no bind). Comment only; no sample `fulfill()` call.
- **S20-CLAIM-DUE-N API:** `claimDue` still returns N live leases (`scheduler.ts` `claimDue` → `claimListedDue`). Close is types/README; `processDue` is the production worker. Hosts that ignore the README can still serial-work the array.
- **Paymob `mapPaymobOutcome`** maps `status === "failed"` → `"declined"` without a `decline` object (`paymob.gateway.ts`). Gateway dual-write; `inferOperationOutcome` S20-FAILED-DECLINED is closed.
- **Fingerprint depth cap:** `redactForFingerprint` at `depth > 6` still returns constant `"[REDACTED]"`. Distinct bags deeper than 6 could collide. Not the original billing / otp / 13-digit identity lie.

None of these recreate the original blocking lies (fingerprint collision on billing/otp/PAN/13-digit ids, pre-claim fulfill in cited core docs, reclaim without CAS, unknown PayPal refund → failed, redirect cancelled/failed terminal envelope).

---

## What was fixed vs remaining

### Blocking ship-gate (2 IDs) — both closed

#### S20-FINGERPRINT-REDACT — fixed

`fingerprintParams` hashes `stableStringify(redactForFingerprint(stripAbortSignals…))` (`packages/core/src/utils/idempotency.ts`). Sensitive leaves become `[REDACTED:` + `sha256Hex(stableStringify(value))` + `]`, not constant `[REDACTED]`. Allow-listed ids (`gatewayPaymentId` / `orderId` / `paymentId` / …) are not PAN-hashed.

Tests in `utils.test.ts` lock: two `paymobBillingData` bags, two `otpValue`s, two 13-digit `gatewayPaymentId`s, and Visa vs Mastercard `cardNumber`s all produce distinct SHA-256; economically identical money still collides; raw PAN digits are not in the digest string. Logger `redact` stays constant `[REDACTED]` (`packages/core/src/utils/logger.ts`).

**Residual (not the original lie):** `depth > 6` still constant-replaces.

#### S20-DOCS-FULFILL — fixed (cited files)

Named files no longer fulfill in `onWebhookVerified` or on any claimed event without rematch+bind:

- `packages/core/docs/hooks.md`: verify hook is metrics-only; prose forbids fulfill.
- `packages/core/docs/webhooks.md`: `onWebhookVerified` metrics-only; inbox sample gates `payment.succeeded` \| `capture.completed` **and** `payment.status === "paid"`, then `findOrderForEvent` + `fulfillOrder(order, gatewayPaymentId)`.
- `docs/getting-started.md` / core `README.md`: same rematch + bind; recon snapshots use `getPayment` money. No `if (result.success) fulfill()`.

**Not promoted:** `packages/webhooks/docs/webhook-inbox.md` still pastes post-claim `fulfill(ctx.event)` without rematch/bind. `packages/core/src/index.ts` JSDoc still says fulfill after claim “when `event.status === 'paid'`”.

### Gate-promotable should-fix (original money / fulfillment / fence lies) — closed

#### S20-WH-FAIL-RECLAIM — fixed

`bestEffortRecordFailAfterLeaseLost` claims with `ifMatchPayloadHash: args.payloadHash` (`packages/webhooks/src/engine.ts`). `payload_hash_conflict` returns `{ terminal: false, recorded: false }` (no rewrite). Test `S20-WH-FAIL-RECLAIM: get→reclaim race does not rewrite an idle newer hash` keeps `hash-b`. `processRetryable` still claims with `ifMatchPayloadHash` (S19 intact).

#### S20-PAYPAL-REFUND-UNKNOWN — fixed

`mapRefundStatus` maps unknown HTTP 200 statuses to `pending` (`packages/core/src/gateways/paypal/paypal.gateway.ts`). Refund POST uses that map; unknown → `outcome: "pending"`, `success: true`, no `totalRefunded`. Test `WEIRD_NEW_STATUS` is pending, not failed. Known `FAILED` / `CANCELLED` still map failed.

#### S20-PAYMOB-REDIR-TERM — fixed (envelope + mapper)

E: `redirectEnvelopeStatus` keeps only `pending` / `processing`; every other mapped status (cancelled / failed / refund terminals / paid / authorized) becomes `processing` (`packages/core/src/gateways/paymob/paymob.gateway.ts`).

F: `TRANSACTION_RESPONSE` dual-write demotes `payment.cancelled` / `payment.failed` / `refund.*` / fulfillment-ready / authorized via `PAYMOB_REDIRECT_DEMOTE_STABLE` (`packages/core/src/types/webhook-event-map.ts`). Processed `TRANSACTION` still publishes those arms.

Test `redirect void/fail/refund terminals stay processing (S20-PAYMOB-REDIR-TERM)`: `is_voided=true` / `success=false` / `is_refunded=true` → envelope + stable `processing`.

### Remaining should-fix pack — original lies gone

| ID | Gate read |
| --- | --- |
| **S20-SETUP-INFER** | `isSettledSuccessStatus` includes `setup_completed`. Bare success+setup infers `succeeded`. `isPaidOutcome` false. |
| **S20-FAILED-DECLINED** | `outcomeForFailedStatus`: bare `status: "failed"` without `decline` → `failed`. Tests flipped. Paymob `mapPaymobOutcome` still dual-writes explicit `declined` (residual above). |
| **S20-HEARTBEAT-RACE** | Engine + recon scheduler: `closed` set in `stopHeartbeat` before `clearInterval` / `await renewTail`; new ticks no-op. |
| **S20-MEM-GET-WIPE** | testkit / webhooks memory / recon memory `get()` is read-only (`return entries.get(key)`). Soft-release stays on list/claim. |
| **S20-REDIS-IFMATCH-EMPTY** | Store `requireNonEmptyHash` rejects `""`. Lua `ifMatchPresent` (`ARGV[11] === '1'`) CASes even when the hash string is empty; omit only when the field is missing. |
| **S20-CLAIM-DUE-N** | `claimDue` still **returns N live leases**. Types + README: discovery / test inspection; `processDue` is the only production worker. Allowed close. API shape leftover listed above. |
| **S20-LIST-NOW** | Postgres / SQLite / Turso / D1 / Redis / DO list wipe with issuer/`ctx.clock`; caller `now` is the due/available filter. |
| **S20-SQLITE-MEMORY** | `openBunSqliteDatabase` (and siblings) require an explicit `path`. `:memory:` is opt-in ephemeral. File-backed opens apply `busy_timeout`. |
| **S20-PAYMOB-AMOUNT-REFUND** | `mapPaymobTransactionSignals` uses amount-only `refundedAmountCents` only when `fromStatus` is undefined. `status: "paid"` + leftover refund cents → `payment.succeeded`. |

### Nits

| ID | Landed? | Notes |
| --- | --- | --- |
| **S20-PAYPAL-JSON** | yes | `parseJsonResponse` throws on empty / invalid JSON (no invented `{}`). Mutating HTTP 200 → `afterProviderSubmit` indeterminate; GET → `GatewayApiError`. |
| **S20-PAYMOB-SUCCESS-OMIT** | yes | Identified inquiry with omitted `success` is `processing` / `requires_action`, not `declined`. Explicit `success: false` stays failed. |
| **S20-CREATE-COUNT** | yes | `GET /internal/create-count` is `enableTestHooks`-gated (404 without the flag). |
| **S20-TRAILING-ZERO** | yes | `money` strips unused trailing-zero remainder before `excess_precision`. `money("10.500", "USD")` / `money("100.00", "JPY")` accept. |
| **S20-RETRY-NAN** | yes | `sanitizeMaxAttempts` coerces NaN / ±∞ / non-number to 1; fractions trunc to a finite integer ≥ 1. |

### C1 / r7 S19 — not reopened

- **C1:** `stripeChargeSnapshotForRefundStatus` treats unexpanded string / id-only `latest_charge` as not refund proof. `payment_intent.succeeded` + `amount_received` + unexpanded charge stays `paid`. Observable `charges.data` refunds still rematch (S19-STRIPE-LATE-REFUND).
- **S19-WH-HASH-TOCTOU:** `processRetryable` still binds `ifMatchPayloadHash`.
- **S19-PAYMOB-REDIR-STATUS:** paid/authorized redirect demotion remains (now a subset of S20 demotion).
- **S19-FINGERPRINT:** persisted value is still a SHA-256 digest, not raw stringify.
- **S19-MAP-REFUND-PENDING:** pending / `refund_pending` still map before refund-completed arms; amount-only refund no longer ranks over a decisive `fromStatus`.

---

## Residual P1 path verification (grep / read)

Original r8 P1 / gate-promotable money paths improved in source. Residuals are not those paths.

| Original lie | Current source |
| --- | --- |
| Fingerprint constant `[REDACTED]` on billing / otp / 13-digit / Visa vs MC | `hashedFingerprintLeaf` + allow-list; tests assert distinct SHA-256. `depth > 6` still constant (residual). |
| `hooks.md` / `webhooks.md` fulfill in `onWebhookVerified` | Metrics-only verify hook; inbox sample rematch+bind. `webhook-inbox.md` still post-claim `fulfill(ctx.event)` (residual). |
| Fail-after-lease-lost reclaim omitted `ifMatchPayloadHash` | `bestEffortRecordFailAfterLeaseLost` passes `ifMatchPayloadHash: args.payloadHash`; conflict skips. |
| PayPal HTTP 200 unknown refund → `failed` | `mapRefundStatus` default `pending`; `WEIRD_NEW_STATUS` test flipped. |
| Paymob redirect cancelled / failed / refund settle | Envelope + `PAYMOB_REDIRECT_DEMOTE_STABLE` → `processing`. |

---

## Remaining (not ship-blockers)

- Formal prior bookkeeping / gate files must not be read as this verdict; this file is the gate artifact. Pointer: [`session-audit-2026-08-19-r8.md`](./session-audit-2026-08-19-r8.md).
- Five non-blocking leftovers listed above (`webhook-inbox.md` paste, `index.ts` JSDoc, bulk `claimDue` API, Paymob explicit failed→declined, fingerprint depth cap).
- `createPayment` may still mint an ephemeral Stripe/PayPal request id (in-process `withRetry` only; warned).
- Live Postgres / Redis / better-sqlite3 conformance remains skipped without a server (31 skips).
- Out of scope unchanged: Stripe `webhookSecrets[]`, Moyasar token-in-body, 0.x major-unit `number` results, C1.

**Working tree:** uncommitted session-audit (r8) diffs. Do **not** commit. Do **not** push.
