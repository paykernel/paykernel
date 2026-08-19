# Session-audit r7 adversarial gate (2026-08-19)

**Source of truth:** [`session-audit-2026-08-19.md`](./session-audit-2026-08-19.md)  
**Bookkeeping (not this verdict):** [`session-audit-r7-fix-pass-2026-08-19.md`](./session-audit-r7-fix-pass-2026-08-19.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-r7-fix-gate.rhai`  
**Method:** re-read current source with `read_file` / `grep`. Implement and integrate summaries were not treated as evidence.

| Field | Value |
| --- | --- |
| `pass` | **false** |
| `typecheck` | **exit 0** — `bun run typecheck` (core through examples) |
| `tests` | **2319 pass / 31 skip / 0 fail** — `bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples` |
| skips | live Postgres / Redis / better-sqlite3 (no server / optional engine). Isolated WAL flake not in this set. |

---

## Blocking

### S19-WH-HASH-TOCTOU — still the original lie on production stores

`processRetryable` still rolls an idle row **backwards** when the durable `claim` path runs WEBHOOKS-3.

Engine (`packages/webhooks/src/engine.ts`): I14 skip if `get` hash ≠ listed hash, then `claim({ payloadHash: listed, ifMatchPayloadHash: listed })`. Memory store honors the CAS (`packages/webhooks/src/memory-store.ts` idle miss → `payload_hash_conflict`, no rewrite). Tests lock that only for the in-package memory store.

Production / dual-surface stores **do not implement `ifMatchPayloadHash`**:

- `packages/store-contracts/src/contracts.ts` `ClaimWebhookInput` has no field.
- Postgres / sqlite / turso / d1 claim SQL (`sql-foundation` `webhookClaimTemplates`): idle `payload_hash IS DISTINCT FROM EXCLUDED` → `SET payload_hash = EXCLUDED.payload_hash` (WEBHOOKS-3).
- Redis `WEBHOOK_CLAIM_LUA` ARGV is hash/owner/lease/payloadRef only; idle mismatch `HSET payload_hash`.
- `decideWebhookClaim` (`sql-foundation/src/claims/algorithm.ts`) idle mismatch → acquire with caller hash.
- Testkit `createMemoryWebhookInboxStore` still idle-supersedes (no `ifMatch`).

Documented production composition (`docs/getting-started.md`) injects `createPostgresStoresFromPg().webhookInbox` into `createWebhookInboxEngine`. Extra `ifMatchPayloadHash` on the engine input is dropped. Listed `hash-a` + idle `hash-b` at claim time rewrites to `hash-a` (and `payloadRef` from the stale snapshot). That is a last-write of an older webhook body over a newer one.

Memory-only engine tests do **not** close the finding. Required close: durable `claim` must refuse acquire when store hash ≠ listed hash (`payload_hash_conflict`, no rewrite), or `store-contracts` must grow `ifMatchPayloadHash` and every adapter/Lua/SQL/DO must honor it.

---

## Blocking IDs that are closed (not re-opened)

### S19-CKO-TIMEOUT — closed

`isPostSubmitMoneyMutation` includes `createCheckoutSession`. `tryIndeterminateFromNetworkError` returns checkout-shaped `{ success: false, outcome: "indeterminate", reconciliationRequired: true }` via `applyIndeterminateCheckoutSessionOutcome` (not payment shape). Stripe mutating POST timeout / empty / `{}` 200 is `NetworkError.afterProviderSubmit`. `getCheckoutSession` still throws. Caller `idempotencyKey` is required on checkout create.

### S19-PAYMOB-JSON — closed

`parseJson` never returns `{}`. Empty / invalid JSON → `GatewayApiError` (GET) or mutation indeterminate. `normalizeApiTransactionResponse` rejects bodies with no transaction signal (`{}` / HTML-as-empty is not `declined`).

### S19-PAYMOB-REDIR-STATUS — closed

`redirectEnvelopeStatus` demotes paid / authorized / partial / refunded → `processing`. Redirect tests expect `status === "processing"` and `stableType === "payment.processing"`.

### S19-PAYMOB-REFUND-UNPAID — closed

`assertInquiryAllowsMoneyAction` throws `InvalidRequestError` on `pending: true` or `success: false` without captured money, before `fetchPaymobMutation`. Tests: refund/capture pending or failed sale → inquiry GET only, no refund/capture URL.

### S19-MAP-REFUND-PENDING — closed

`mapPaymobFromFlags` ranks `refund_pending` / `flags.pending` / status `pending`/`processing` **before** `hasAmountRefund` / `isRefunded` / `isRefund+success`. `mapPaymobStatusOnly` maps `refund_pending` → `refund.pending`, `refund_failed` → `refund.failed`. Flags-only tests lock `pending+success+isRefund` → `payment.processing`.

### S19-STRIPE-LATE-REFUND — closed (C1 holds)

Observable `charges.data` / expanded charge rematch via `stripeChargeSnapshotForRefundStatus`. `payment_intent.succeeded` + list/expanded `amount_refunded` is not `paid`. **C1 unchanged:** string / id-only `latest_charge` + `amount_received > 0` + no snapshot stays `paid`.

---

## Non-blocking residual

- **S19-SQLITE-ENGINES:** `packages/store-sqlite/package.json` `engines.node` is still `>=18` while `/node` needs 22.5+. README already documents the subpath. Honesty only.
- **S19-CKO-UNEXPANDED:** classic Checkout string PI + `payment_status: paid` stays `paid` without refund rematch (no invented refund; C1-class). Related to S19-CKO-GET / S19-STRIPE-LATE-REFUND; not a last-write of an *observable* refunded charge.
- **S19-EPHEMERAL-KEY (PayPal):** out of scope this pass. Stripe capture/refund/void/checkout create require caller `idempotencyKey`.

Should-fix pack otherwise matches current source (legacy `gatewayId` is `legacy:{orderId}`; checkout get rematches expanded PI; charge GET 401/429/5xx propagate; `charge.dispute.*` is not generic payment `pending`; durable `get()` is read-only; `claimDue` is one-at-a-time; recon `processDue` renews on `leaseMs/3`; fingerprints are `sha256Hex`; example bind/recon/amount/docs-success closed; SHA-256 high bits and recon PAN runs landed). None of those leftovers reintroduce a money or fulfillment map in the original shape.

---

## Verdict

**Fail.** Six of seven ship-gate IDs are closed in source and tests, C1 holds, typecheck is green, and the required test set is 0-fail. **S19-WH-HASH-TOCTOU is not closed** on the stores hosts actually inject into `processRetryable`.

Do **not** commit. Do **not** push.
