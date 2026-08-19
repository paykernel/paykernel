# Session-audit r8 adversarial gate (2026-08-19)

**Source of truth:** [`session-audit-2026-08-19-r8.md`](./session-audit-2026-08-19-r8.md)  
**Bookkeeping (not this verdict):** [`session-audit-r8-fix-pass-2026-08-19.md`](./session-audit-r8-fix-pass-2026-08-19.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-r8-fix-gate.rhai`  
**Method:** re-read current source with `read_file` / `grep`. Independently executed `fingerprintParams` on billing / otp / 13-digit id bags. Implement and integrate summaries were not treated as evidence.

| Field | Value |
| --- | --- |
| `pass` | **true** |
| `typecheck` | **exit 0** — `bun run typecheck` (core through examples) |
| `tests` | **2368 pass / 31 skip / 0 fail** — `bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples` |
| skips | live Postgres / Redis / better-sqlite3 (no server / optional engine). Isolated WAL flake not in this set. |

No blocking leftover. C1 holds. r7 S19 ship-gate closes were not reopened.

---

## Blocking (must close) — original lies gone

### S20-FINGERPRINT-REDACT — closed

`fingerprintParams` hashes `stableStringify(redactForFingerprint(stripAbortSignals…))` (`packages/core/src/utils/idempotency.ts`). Sensitive leaves become `[REDACTED:` + `sha256Hex(stableStringify(value))` + `]`, not constant `[REDACTED]`. Allow-listed ids (`gatewayPaymentId` / `orderId` / `paymentId` / …) are not PAN-hashed.

Independent `bun` probe (not the unit test): two `paymobBillingData` bags, two `otpValue`s, two 13-digit `gatewayPaymentId`s, and Visa vs Mastercard `cardNumber`s all produce distinct SHA-256; economically identical money still collides. Logger `redact` stays constant `[REDACTED]` (`packages/core/src/utils/logger.ts`). Tests in `utils.test.ts` lock the same.

### S20-DOCS-FULFILL — closed (cited files)

Named files no longer fulfill in `onWebhookVerified` or on any claimed event:

- `packages/core/docs/hooks.md`: verify hook is metrics-only; prose forbids fulfill.
- `packages/core/docs/webhooks.md`: `onWebhookVerified` metrics-only; inbox sample gates `payment.succeeded` \| `capture.completed` **and** `payment.status === "paid"`, then `findOrderForEvent` + `fulfillOrder(order, gatewayPaymentId)`.
- `docs/getting-started.md` / core `README.md`: same rematch + bind; recon snapshots use `getPayment` money. No `if (result.success) fulfill()`.

**Not promoted:** `packages/webhooks/docs/webhook-inbox.md` still pastes post-claim `fulfill(ctx.event)` without rematch/bind (see non-blocking). That is not the original onWebhookVerified / core-docs lie.

### S20-WH-FAIL-RECLAIM — closed

`bestEffortRecordFailAfterLeaseLost` claims with `ifMatchPayloadHash: args.payloadHash` (`packages/webhooks/src/engine.ts`). `payload_hash_conflict` returns `{ terminal: false, recorded: false }` (no rewrite). Test `S20-WH-FAIL-RECLAIM: get→reclaim race does not rewrite an idle newer hash` keeps `hash-b`. `processRetryable` still claims with `ifMatchPayloadHash` (S19 intact).

### S20-PAYPAL-REFUND-UNKNOWN — closed

`mapRefundStatus` maps unknown HTTP 200 statuses to `pending` (`packages/core/src/gateways/paypal/paypal.gateway.ts`). Refund POST uses that map; unknown → `outcome: "pending"`, `success: true`, no `totalRefunded`. Test `WEIRD_NEW_STATUS` is pending, not failed. Known `FAILED` / `CANCELLED` still map failed.

### S20-PAYMOB-REDIR-TERM — closed (envelope + mapper)

E: `redirectEnvelopeStatus` keeps only `pending` / `processing`; every other mapped status (cancelled / failed / refund terminals / paid / authorized) becomes `processing` (`packages/core/src/gateways/paymob/paymob.gateway.ts`).

F: `TRANSACTION_RESPONSE` dual-write demotes `payment.cancelled` / `payment.failed` / `refund.*` / fulfillment-ready / authorized via `PAYMOB_REDIRECT_DEMOTE_STABLE` (`packages/core/src/types/webhook-event-map.ts`). Processed `TRANSACTION` still publishes those arms.

Test `redirect void/fail/refund terminals stay processing (S20-PAYMOB-REDIR-TERM)`: `is_voided=true` / `success=false` / `is_refunded=true` → envelope + stable `processing`.

### P0 typecheck / tests — green

`bun run typecheck` exit 0. Required test set 2368 pass / 31 skip / 0 fail. Skips are live Postgres / Redis / better-sqlite3. No WAL flake in this run.

---

## C1 / r7 S19 — not reopened

- **C1:** `stripeChargeSnapshotForRefundStatus` treats unexpanded string / id-only `latest_charge` as not refund proof. `payment_intent.succeeded` + `amount_received` + unexpanded charge stays `paid` (`stripe.gateway.test.ts` STRIPE-2 table). Observable `charges.data` refunds still rematch (S19-STRIPE-LATE-REFUND).
- **S19-WH-HASH-TOCTOU:** `processRetryable` still binds `ifMatchPayloadHash`.
- **S19-PAYMOB-REDIR-STATUS:** paid/authorized redirect demotion remains (now a subset of S20 demotion).
- **S19-FINGERPRINT:** persisted value is still a SHA-256 digest, not raw stringify.

---

## Should-fix pack (original lies gone; leftovers below)

| ID | Current source |
| --- | --- |
| **S20-SETUP-INFER** | `isSettledSuccessStatus` includes `setup_completed`. Bare success+setup infers `succeeded`. `isPaidOutcome` false. |
| **S20-FAILED-DECLINED** | `outcomeForFailedStatus`: bare `status: "failed"` without `decline` → `failed`. Tests flipped. |
| **S20-HEARTBEAT-RACE** | Engine + recon scheduler: `closed` set in `stopHeartbeat` before `clearInterval` / `await renewTail`; new ticks no-op. |
| **S20-MEM-GET-WIPE** | testkit / webhooks memory / recon memory `get()` is read-only (`return entries.get(key)`). Soft-release stays on list/claim. |
| **S20-REDIS-IFMATCH-EMPTY** | Store `requireNonEmptyHash` rejects `""`. Lua `ifMatchPresent` (`ARGV[11] === '1'`) CASes even when the hash string is empty; omit only when the field is missing. |
| **S20-CLAIM-DUE-N** | `claimDue` still **returns N live leases**. Types + README: discovery / test inspection; `processDue` is the only production worker. Allowed close. |
| **S20-LIST-NOW** | Postgres / SQLite / Turso / D1 / Redis / DO list wipe with issuer/`ctx.clock`; caller `now` is the due/available filter. |
| **S20-SQLITE-MEMORY** | `openBunSqliteDatabase` (and siblings) require an explicit `path`. `:memory:` is opt-in ephemeral. File-backed opens apply `busy_timeout`. |
| **S20-PAYMOB-AMOUNT-REFUND** | `mapPaymobTransactionSignals` uses amount-only `refundedAmountCents` only when `fromStatus` is undefined. `status: "paid"` + leftover refund cents → `payment.succeeded`. |

Nits landed in source: PayPal `parseJsonResponse` throws (no invented `{}`); Paymob omitted `success` → `processing` / `requires_action`; `GET /internal/create-count` is `enableTestHooks`-gated; `money("10.500","USD")` / `money("100.00","JPY")` parse; `sanitizeMaxAttempts` coerces NaN to 1.

---

## Non-blocking residual

None of these recreate the original blocking lies (fingerprint collision, pre-claim fulfill in cited docs, reclaim without CAS, unknown PayPal refund → failed, redirect cancelled/failed terminal envelope).

1. **Docs paste residual (not S20-DOCS-FULFILL original files):** `packages/webhooks/docs/webhook-inbox.md` still shows post-claim `await fulfillOrder(ctx.event)` / `await fulfill(ctx.event)` without `isPaidFulfillmentEvent` rematch or `gatewayPaymentId` bind (pipeline sketch ~108–110, recommended verify+process ~157, `processWithVerifier` ~201, gateway-only ~226, `processRetryable` ~455–464). Post-claim, not `onWebhookVerified`. Core `hooks.md` / `webhooks.md` / README / getting-started are rematch+bind.

2. **`packages/core/src/index.ts` JSDoc** still says fulfill after inbox claim “when `event.status === 'paid'`” (no rematch type gate, no bind). Comment only; no sample `fulfill()` call.

3. **S20-CLAIM-DUE-N API shape:** `claimDue` still bulk-returns live leases (`scheduler.ts` `claimDue` → `claimListedDue`). Close is documentation + `processDue` as the production loop. Hosts that ignore the README can still serial-work the array.

4. **Paymob gateway dual-write:** `mapPaymobOutcome` maps `status === "failed"` to `"declined"` even without a `decline` object (`paymob.gateway.ts`). `inferOperationOutcome` (S20-FAILED-DECLINED) is fixed; this is Paymob explicit `outcome`. Inquiry `success: false` tests lock `outcome: "declined"`.

5. **Fingerprint depth cap:** `redactForFingerprint` at `depth > 6` still returns constant `"[REDACTED]"`. Distinct bags deeper than 6 could collide. Not the original billing / otp / 13-digit identity lie.

Out of scope unchanged: Stripe `webhookSecrets[]`, Moyasar token-in-body, Stripe/PayPal `createPayment` ephemeral request id, 0.x major-unit `number` results, C1.

---

## Verdict

**Pass.** All five named blocking IDs are gone in current source (independent fingerprint probe + file reads). Typecheck exit 0. Required tests 2368/31/0. C1 and r7 S19 closes hold. Leftovers are docs paste in `webhook-inbox.md`, JSDoc wording, bulk `claimDue` API, Paymob explicit failed→declined, and fingerprint depth cap — none restore a money / fulfillment / fence lie in the original shape.
