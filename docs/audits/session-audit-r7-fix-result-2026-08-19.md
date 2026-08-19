# Session-audit r7 fix-gate result (2026-08-19)

**Source of truth:** [`session-audit-2026-08-19.md`](./session-audit-2026-08-19.md)  
**Bookkeeping (not this verdict):** [`session-audit-r7-fix-pass-2026-08-19.md`](./session-audit-r7-fix-pass-2026-08-19.md)  
**Earlier adversarial fail (superseded):** [`session-audit-r7-fix-gate-2026-08-19.md`](./session-audit-r7-fix-gate-2026-08-19.md) — `S19-WH-HASH-TOCTOU` was still open on production stores at that read. Current source now binds `ifMatchPayloadHash` through first-party stores.  
**Workflow:** `.grok/workflows/paykernel-session-audit-r7-fix-gate.rhai`  
**Method:** adversarial re-read of current source (`read_file` / `grep`). Implement/integrate summaries were pointers only.

| Field | Value |
| --- | --- |
| `final_pass` | **true** |
| `typecheck_ok` | **true** — `bun run typecheck` exit 0 (core through examples) |
| `tests_ok` | **true** — `bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples` → **2319 pass / 31 skip / 0 fail** |
| `invariants_ok` | **true** — C1 holds (unexpanded `latest_charge` + `amount_received > 0` stays `paid` with no refund snapshot). r6 I1–I4 / I7–I9 stay closed. |
| `gate_pass` | **true** |
| `gate_summary` | All seven blocking IDs from session-audit-2026-08-19 are closed in current source. `createCheckoutSession` post-submit timeout/empty/`{}` 200 is checkout-shaped indeterminate (not a retryable failed-create); `getCheckoutSession` still throws. Paymob `parseJson` no longer swallows invalid JSON; empty/HTML 200 inquiry throws `GatewayApiError` rather than declined; redirect envelope status is `processing`; pending/failed sales are refused before refund/capture POST. `mapPaymobFromFlags` ranks pending/`refund_pending` above refund-completed arms. `processRetryable` claims with `ifMatchPayloadHash` and first-party stores (SQL/Lua/DO/memory/testkit) refuse idle backwards supersede. Observable `charges.data`/expanded charge refunds rematch; unexpanded `latest_charge` + `amount_received > 0` stays `paid` (C1). Should-fix pack from the same pass is closed in source. Residuals: `store-sqlite` `engines.node` is still `>=18` while `./node` needs 22.5+; classic Checkout string PI stays `paid` without refund rematch; PayPal still mints ephemeral `PayPal-Request-Id` when the caller omits `idempotencyKey`. |
| `implement_ok` / `implement_fail` | **9 / 0** |

31 skips are live Postgres / Redis / better-sqlite3 (no server / optional engine). Isolated WAL flake was not in this set.

---

## Blocking

*(empty — no ship-gate leftovers)*

---

## Non-blocking residual

*(empty after residual pass — S19-SQLITE-ENGINES, S19-CKO-UNEXPANDED, and S19-EPHEMERAL-KEY PayPal closed 2026-08-19.)*

---

## What was fixed vs remaining

### Blocking ship-gate (7 IDs) — all closed

#### S19-CKO-TIMEOUT — fixed

`isPostSubmitMoneyMutation` includes `createCheckoutSession`. Post-submit `NetworkError.afterProviderSubmit` (timeout, empty 200, `{}` 200) becomes checkout-shaped `{ success: false, outcome: "indeterminate", reconciliationRequired: true }` via `applyIndeterminateCheckoutSessionOutcome` — not payment `applyIndeterminatePaymentOutcome`. `getCheckoutSession` is not a post-submit money mutation and still throws. Tests: mutating checkout POST timeout / empty / `{}` 200 is not a retryable failed-create; GET timeout still throws.

#### S19-PAYMOB-JSON — fixed

`parseJson` never returns `{}`. Empty / invalid JSON → `GatewayApiError` on GET; mutating HTTP 200 empty/non-JSON stays `PaymobIndeterminateResponseError`. `normalizeApiTransactionResponse` rejects bodies with no transaction signal (`{}` / HTML-as-empty is not `declined`). Tests: empty / HTML / `{}` HTTP 200 inquiry throws, not declined.

#### S19-PAYMOB-REDIR-STATUS — fixed

`redirectEnvelopeStatus` demotes `paid` / `authorized` / `partially_captured` / `refunded` / `partially_refunded` → `processing` so the envelope matches `TRANSACTION_RESPONSE` dual-write. Redirect tests expect `status === "processing"`, not `"paid"`.

#### S19-PAYMOB-REFUND-UNPAID — fixed

`assertInquiryAllowsMoneyAction` throws `InvalidRequestError` on `pending: true` or `success: false` without captured money, before `fetchPaymobMutation`. Tests: refund/capture pending or failed sale → inquiry GET only, no refund/capture URL.

#### S19-MAP-REFUND-PENDING — fixed

`mapPaymobFromFlags` ranks `refund_pending` / `flags.pending` / status `pending`/`processing` **before** `hasAmountRefund` / `isRefunded` / `isRefund+success`. `mapPaymobStatusOnly` maps `refund_pending` → `refund.pending`, `refund_failed` → `refund.failed`. Flags-only test: `pending+success+isRefund` (no status) is `payment.processing`.

#### S19-WH-HASH-TOCTOU — fixed

`processRetryable` still skips I14 (list hash ≠ current `get` hash), then claims with `ifMatchPayloadHash` = listed hash. First-party claim paths refuse idle backwards supersede (`payload_hash_conflict`, no rewrite):

- `store-contracts` `ClaimWebhookInput.ifMatchPayloadHash`
- `decideWebhookClaim` / SQL `webhookClaimTemplates` (`$8` CAS)
- Postgres / sqlite / turso / d1 / DO adapters bind the field
- Redis `WEBHOOK_CLAIM_LUA` ARGV[10]; empty = omitted WEBHOOKS-3, non-empty CAS
- Webhooks memory store, testkit memory store, sql-foundation reference store

`processVerified` still omits the fence so idle WEBHOOKS-3 supersede on first delivery is unchanged. Tests: listed `hash-a` + idle `hash-b` at claim time stays `hash-b` (engine + per-store unit / conformance).

This is the close that the earlier [`session-audit-r7-fix-gate-2026-08-19.md`](./session-audit-r7-fix-gate-2026-08-19.md) failed on. Current source is not that read.

#### S19-STRIPE-LATE-REFUND — fixed (C1 holds)

Observable `charges.data` / expanded charge rematch via `stripeChargeSnapshotForRefundStatus`. `payment_intent.succeeded` + list/expanded `amount_refunded` is not `paid`. **C1 unchanged:** string / id-only `latest_charge` + `amount_received > 0` + no snapshot stays `paid`. Apps must not last-write `PI.succeeded` over `charge.refunded`.

### Should-fix pack (same pass) — original lies gone

None promoted to blocking. None left in the original money / fulfillment / fence-lie shape.

| ID | Gate read |
| --- | --- |
| **S19-PAYMOB-LEGACY-ID** | Legacy create `gatewayId` is `legacy:{orderId}`, not the numeric order id. Mutations still require webhook/dashboard `obj.id`. |
| **S19-CKO-AMOUNT** | Hydrated Checkout publishes settled PI `amount_received` (not always `amount_total`). |
| **S19-CKO-GET** | `getCheckoutSession` rematches expanded PI refunds / settled money. |
| **S19-STRIPE-CHARGE-SWALLOW** | GET `/charges` 401/429/5xx propagate as `AuthenticationError` / `NetworkError` / `RateLimitError`. Unobservable / 404 stay fail-closed `processing`. |
| **S19-STRIPE-DISPUTE** | `charge.dispute.*` uses `stripeDisputeEnvelopeStatus` (native dispute status or `processing`) — not generic payment `pending`. Dual-write stays `dispute.*`. |
| **S19-EPHEMERAL-KEY** | Stripe **and** PayPal capture / refund / void / authorize / Checkout require caller `idempotencyKey`. `createPayment` may still mint + warn. |
| **S19-CLOCK-LEASE** | Durable `get()` is read-only (does not clear `lease_token`). Soft-release stays on list/claim. |
| **S19-CLAIM-DUE** | `claimDue` / `processDue` claim one-at-a-time. README tells hosts to prefer `processDue`. |
| **S19-RECON-HB** | `processDue` auto-renews on `leaseMs/3`. Same-worker hang after expiry does not park `retry_later` against the budget. |
| **S19-FINGERPRINT** | `fingerprintParams` persists `sha256Hex(stableStringify(redact(stripAbortSignal)))`. Stringify kept for canonicalization tests. |
| **S19-EXAMPLE-BIND** | `findOrderForEvent` requires webhook PI; metadata `orderId` cannot fulfill a mock-charged order with a different stored PI. `fulfill()` records missing `gatewayPaymentId`. |
| **S19-EXAMPLE-RECON** | `/internal/reconcile` is a labeled test hook; 404 without `enableTestHooks`. |
| **S19-EXAMPLE-AMOUNT** | Catalog / `getPayment` money only. No `trustedAmount`; `snapshotForOrder` does not copy `order.amount`. |
| **S19-DOCS-SUCCESS** | Core README / `index.ts` samples use `isPaidOutcome` / `event.status === "paid"` + inbox. Never `if (result.success) fulfill()`. |

### Nits

| ID | Landed? | Notes |
| --- | --- | --- |
| **S19-SHA256-LEN** | yes | Public `sha256` writes high 32 bits of bit-length. |
| **S19-RECON-PAN** | yes | Recon sanitize redacts 13–19 digit PAN runs. |
| **S19-SQLITE-ENGINES** | yes | `engines.node` stays `>=18` for `/better-sqlite3`; `paymentsSdk.nodeSqliteMinimum` + README / `drivers.md` document `/node` needs 22.5.0. |
| **S19-CKO-UNEXPANDED** | yes | Classic string `payment_intent` fail-closes to `processing` / `payment.processing`. |

### Remaining (not ship-blockers)

- Formal prior bookkeeping / failed-gate files must not be read as this verdict; this file is the gate artifact.
- `createPayment` may still mint an ephemeral Stripe/PayPal request id (in-process `withRetry` only; warned).
- Live Postgres / Redis / better-sqlite3 conformance remains skipped without a server (31 skips).
- Out of scope unchanged: Stripe `webhookSecrets[]`, Moyasar token-in-body, 0.x major-unit `number` results, `test:coverage` core-only.

**Working tree:** uncommitted session-audit (r7) diffs. Do **not** commit. Do **not** push.
