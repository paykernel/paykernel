# PayKernel leftover-audit fix pass (2026-08-16, round 4)

**Source of truth:** [`leftover-audit-r4-2026-08-16.md`](./leftover-audit-r4-2026-08-16.md)  
**Prior closed write-ups:** [`leftover-audit-2026-08-16.md`](./leftover-audit-2026-08-16.md), [`leftover-audit-fix-pass-2026-08-16.md`](./leftover-audit-fix-pass-2026-08-16.md), [`leftover-audit-fix-result-2026-08-16.md`](./leftover-audit-fix-result-2026-08-16.md), [`deep-audit-2026-08-16.md`](./deep-audit-2026-08-16.md), [`session-audit-2026-08-16.md`](./session-audit-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-leftover-audit-r4-fix-gate.rhai`  
**This document:** Stream J bookkeeping — ownership map, residual-ID checklist, and integrate landed-vs-remaining.  
**Scope of this file:** `docs/audits/**` plus J-owned sql-foundation honesty / store-contracts JSDoc. Does **not** claim a post-fix gate result (that is `leftover-audit-r4-fix-result-2026-08-16.md` after a formal gate).  
**Working tree:** uncommitted leftover-audit (round-4) diffs. Do **not** commit. Do **not** re-open first-pass, session-audit, or leftover-r3 IDs unless current code still has the original lie.

**Audit verdict at pass start:** **SHIP_BLOCKED** on Moyasar refund HTTP 200 `{}` completing the fence, Paymob mutation 408 / non-429 4xx deleting the fence (including Payment Key after Orders 200), and PayPal omitted `final_capture` treated as full `paid`.

Prior leftover-r3 and session-audit IDs stay **already closed**. Historical PP0–ST1 stay already fixed. Critic / implement streams skip any ID they prove already fixed against current code; this bookkeeping list is the audit residual set, not a landing score.

---

## Residual inventory (from leftover-audit r4)

Do not ship until **P1 blocking** are fixed and covered by tests that would have failed this leftover audit. Gate may also treat still-present money / fence lies from the other-P1 set as blocking.

**Counts:** 3 P1 blocking + 1 P1 other + 23 P2 = **27 residual NEW-\* IDs**. Residual **PERF-5 / PERF-6 / PERF-7** stay documented leftovers unless a stream can cheaply improve them without breaking fencing.

### P1 blocking (must close)

Moyasar refund empty 200 completing the fence; Paymob 408 / non-429 4xx deleting the fence; PayPal omitted `final_capture` as `paid`. Must close.

| ID | Sev | One-line | Stream |
| --- | --- | --- | --- |
| **NEW-MOYASAR-REFUND-ID** | P1 | `refundPayment` never calls `assertObservedPaymentId`. HTTP 200 `{}` → `pending` + `gatewayRefundId: undefined`; `runIdempotentMutation` persists `completed`. New key double-refunds. Create path was fixed (NEW-MOYASAR-1). | D |
| **NEW-PAYMOB-4XX** | P1 | After a mutating POST, only `>=500` and `429` stay indeterminate. **408 / 409 / 425** delete the fence. Sharp: legacy Orders HTTP 200 + id, then Payment Keys 4xx, releases the create fence → second `/api/ecommerce/orders`. | C |
| **NEW-PAYPAL-3** | P1 | `PAYMENT.CAPTURE.COMPLETED` / capture GET / order mapping treat missing `final_capture` as **paid**. PayPal API default is `false`. Thin/incomplete COMPLETED fulfills while auth can still be captured. | B |

### P1 other (fix in this pass)

| ID | One-line | Stream |
| --- | --- | --- |
| **NEW-WEBHOOKS-2** | Processed Paymob `TRANSACTION` inbox key is still `obj.id`. Later same-id void/status snapshot is `already_completed`. Prefer keying processed snapshots by native type **and** domain status (`TRANSACTION:{id}:{status}`) so a later void can run. Child refunds already have new ids. | E (event-key / engine; do not change `paymob.gateway.ts` `event.id`) |

### P2 pack (fix if cheap; do not leave as silent money lie)

Honesty, mock training, redaction, docs. None confirmed false-paid / double-refund on built-in default paths — still do not leave a silent money lie.

| ID | One-line | Stream |
| --- | --- | --- |
| **NEW-STRIPE-VOID-1** | Void POST only asserts `id`. Missing `status` → `mapStatus(undefined)=failed` + `forceOutcome: succeeded` → coerced **declined**. Uncertain cancel looks like a clean decline. Require status; missing → indeterminate. | A |
| **NEW-STRIPE-INV-1** | `invoice.paid` / `payment_succeeded` always domain `paid`. Credit notes unread; amount falls through `amount_paid` → `total` → `amount_due`. Prefer `processing` unless `amount_paid` is finite and no credit-note remainder; never use `amount_due` as collected. | A |
| **NEW-STRIPE-CKO-URL** | `createCheckoutSession` is `success: true` after id only; `url` may be `null`. Document + omit `url` when null (do not invent). | A |
| **NEW-STRIPE-SETUP-1** | `setup_intent.succeeded` catalog is `setup_completed` but parse default leaves non-PI objects `pending`. Map setup_intent.succeeded → `setup_completed`. | A |
| **NEW-CORE-8** | `handleWebhook` rematch and `coerceStableSucceededToDomainStatus` only rewrite **`payment.succeeded`**. A v1 `capture.completed` / `refund.completed` on `partially_captured` / `processing` is unchanged. Rematch those arms; flip the mapper test. | E (client rematch) + G (mapper / test flip) |
| **NEW-CORE-9** | Payment `inferOperationOutcome`: `success: false` + `refund_completed` / `refund_pending` / `reversed` forges **failed**. Refund coerce does not upgrade `failed` + `completed`. Add those statuses to the indeterminate list; coerce `failed`+`completed` → `succeeded` (status wins). | G |
| **NEW-CORE-10** | `requires_action` + `status: failed` persists `success: true`. Demote to `declined` / `failed`. | G |
| **NEW-MONEY-3** | `paymentFromWebhookEvent` publishes `event.amount` without `Number.isFinite`. Omit non-finite majors. | G |
| **NEW-PAYPAL-4** | Remaining-held rewrite skipped unless resource status already looks refunded. Face amount can be this-op / order total while status is correctly `partially_refunded`. | B |
| **NEW-PAYPAL-5** | Auth GET always copies `related_ids.capture_id` with no sibling check. Multi-capture can point refunds at the wrong slice. Prefer omit captureId unless a single held capture is proven. | B |
| **NEW-PAYPAL-6** | `isAggregateCapturePartial` returns false when order/auth total is missing → COMPLETED becomes `paid`. Missing total → not paid (`processing` / `partially_captured`). | B |
| **NEW-MOYASAR-4XX** | Mutation fence clears on every 4xx except 429, including **408**. Treat 408/409/425 as indeterminate (keep fence). | D |
| **NEW-WH-1** | Inbox class falls through to domain `type` when `provider.eventType` is missing (`payment.succeeded` vs `TRANSACTION`) → second key, double-run. Only use provider-native type or known Paymob classes. | E |
| **NEW-ROUTE-1** | Amount/capability honesty blocks unconstrained fallback. Complementary **currency / country / method** partitions do not. After exclude, do not use unconstrained fallback when a complementary currency/country/method rule existed. | H |
| **NEW-STORE-2** | Recon in-memory `maxEntries` evicts oldest key with no active-lease skip. Skip live `claimed`. | F |
| **NEW-STORE-3** | Memory `complete` / `renew` wipe expired leases before token fence. Match durable adapters (expired complete still records if token matches, or fail closed without wiping first). | E (webhooks `memory-store.ts`) |
| **NEW-TESTKIT-6** | Scripted / `defaultOutcome: { outcome: "succeeded" }` forces `status: "paid"` and full-captures even with `capture: false`. Honor `capture: false` → authorized when capability exists. | I |
| **NEW-TESTKIT-7** | Create fingerprint omits `stripeCustomerId` / `paymobIntegrationId` / `paymobPaymentMethods`. | I |
| **NEW-TESTKIT-8** | Webhook helpers default `status: "paid"` when omitted. Default status from type (failed → failed). | I |
| **NEW-OBS-2** | `createRedactingLogger` does not scrub `pi_*_secret_*`. Allow-listed leaves / raw `message` can leak PI client secrets. | I |
| **NEW-PKG-2** | Root `createMemoryRelationalStore.migrate()` marks tables present without applying DDL (`createExecutor` always `{ ok: true }`). Do not insert logical tables unless statements actually ran. | J |
| **NEW-SQL-1** | Docs/contracts still say idle hash mismatch is `payload_hash_conflict`. Code supersedes idle hashes. Align docs with algorithm. | J |
| **NEW-PERF-8** | SQL `deleteExpired` with no `limit` is unbounded DELETE. Default a finite limit (e.g. 1000) like Redis. | F |

Residual **PERF-5 / PERF-6 / PERF-7** stay documented leftovers unless a stream can cheaply improve them without breaking fencing. They are **not** NEW-\* IDs and are **unowned for code this pass** unless already in a stream’s files.

---

## Stream ownership

Non-overlapping file ownership from `paykernel-leftover-audit-r4-fix-gate.rhai`. Streams must not edit another stream's files. Shared IDs are split by path, not by “whoever gets there first.”

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | STRIPE | `packages/core/src/gateways/stripe/**`, `packages/core/docs/stripe.md` | NEW-STRIPE-VOID-1, NEW-STRIPE-INV-1, NEW-STRIPE-CKO-URL, NEW-STRIPE-SETUP-1 |
| **B** | PAYPAL | `packages/core/src/gateways/paypal/**`, `packages/core/docs/paypal.md` | NEW-PAYPAL-3, NEW-PAYPAL-4, NEW-PAYPAL-5, NEW-PAYPAL-6 |
| **C** | PAYMOB | `packages/core/src/gateways/paymob/**`, `packages/core/docs/paymob.md` | NEW-PAYMOB-4XX |
| **D** | MOYASAR | `packages/core/src/gateways/moyasar/**`, `packages/core/docs/moyasar.md` | NEW-MOYASAR-REFUND-ID, NEW-MOYASAR-4XX |
| **E** | WEBHOOKS + `handleWebhook` rematch | `packages/webhooks/src/**`, `packages/webhooks/docs/**`, `packages/webhooks/README.md`, `packages/core/src/client.ts`, `packages/core/docs/webhooks.md` | NEW-CORE-8 (client rematch), NEW-WEBHOOKS-2, NEW-WH-1, NEW-STORE-3 |
| **F** | STORES + recon memory | `packages/store-postgres/src/**`, `packages/store-sqlite/src/**`, `packages/store-d1/src/**`, `packages/store-turso/src/**`, `packages/store-durable-objects/src/stores/**`, `packages/reconciliation/src/memory-store.ts` (+ test if present) | NEW-PERF-8, NEW-STORE-2 |
| **G** | CORE apply + map + money | `packages/core/src/types/operation-result.ts` (+ test), `packages/core/src/types/webhook-event-map.ts`, `packages/core/src/types/payment-event.ts` (+ test), `packages/core/docs/operation-results.md` if needed | NEW-CORE-8 (mapper + test flip), NEW-CORE-9, NEW-CORE-10, NEW-MONEY-3 |
| **H** | ROUTING | `packages/routing/src/**`, `packages/routing/docs/**` | NEW-ROUTE-1 |
| **I** | TESTKIT + OBS + logger | `packages/testkit/src/**`, `packages/observability/src/**`, `packages/core/src/utils/logger.ts`, `packages/core/src/utils/utils.test.ts` if logger tests live there | NEW-TESTKIT-6, NEW-TESTKIT-7, NEW-TESTKIT-8, NEW-OBS-2 |
| **J** | DOCS + sql-foundation honesty | `docs/audits/**`, `packages/sql-foundation/src/index.ts`, `packages/sql-foundation/src/reference/**`, `packages/sql-foundation/docs/**`, `packages/sql-foundation/src/claims/templates.ts` (comment/docs only), `packages/store-contracts/src/contracts.ts` (NEW-SQL-1 JSDoc only) | NEW-PKG-2, NEW-SQL-1, this file |

### Ownership fences (do not cross)

- **A** must not edit `abort.ts`, `client.ts`, `webhook-event-map.ts`, `operation-result.ts`, or `logger.ts`.
- **B** must not edit `abort.ts` or `webhook-event-map.ts`.
- **C** must not edit `webhook-event-map.ts`, `abort.ts`, `event-key.ts`, or `client.ts`. **C** must not change Paymob `event.id` for NEW-WEBHOOKS-2 (**E**).
- **D** must not edit `abort.ts` or `client.ts`.
- **E** owns `client.ts` rematch (NEW-CORE-8 rematch arm). **E** must not edit `webhook-event-map.ts` (**G**) or `paymob.gateway.ts` (**C**).
- **F** owns SQL `deleteExpired` default limit + recon memory eviction. Do **not** edit sql-foundation (**J**) or webhooks/src (**E**).
- **G** must not edit `client.ts` (**E**) or stripe / paypal / paymob / moyasar gateways.
- **H** must not edit `store-*` or the webhooks engine.
- **I** must not flip production gateway / infer adapters or `operation-result.ts`.
- **J** must not edit store adapter implementations (**F**). NEW-SQL-1 on `store-contracts/src/contracts.ts` is JSDoc only.
- Built-in PaymentStatus values to prefer (do not invent new ones): `partially_captured`, `partially_refunded`, `refund_pending`, `refund_failed`, `refund_completed`, `setup_completed`, `paid`, `pending`, `processing`, `authorized`.
- Fail-closed on incomplete money. Never convert an uncertain mutation outcome into a retryable failure that **clears** a fence. Always publish currency together with major-unit amount fields.

### Split IDs

**NEW-CORE-8 (E rematch + G mapper)**

- **E:** `rematchSucceededWebhookDualWriteAgainstDomainStatus` in `client.ts` must rematch `capture.completed` / `refund.completed` when envelope status is open money / failed / cancelled. **E** must not edit `webhook-event-map.ts`.
- **G:** `coerceStableSucceededToDomainStatus` / `mapMoyasarEventType` must rematch `capture.completed` when context.status is `partially_captured` / `processing` → `payment.processing`. Flip the mapper test that locks Moyasar `payment_captured` + partial → `capture.completed`.

**NEW-WEBHOOKS-2 (E, not C)**

Processed Paymob `TRANSACTION` inbox key is still `obj.id`. **E** qualifies processed keys by native type **and** domain status. Do not change `paymob.gateway.ts` `event.id`.

**NEW-STORE-3 (E, not F)**

Webhooks `memory-store.ts` `complete` / `renew` must not wipe expired leases before the token fence. **F** owns recon memory (`NEW-STORE-2`) and SQL `deleteExpired` (`NEW-PERF-8`) only.

---

## Recommended close (audit §)

1. NEW-MOYASAR-REFUND-ID  
2. NEW-PAYMOB-4XX  
3. NEW-PAYPAL-3  
4. NEW-WEBHOOKS-2  
5. NEW-CORE-8 / NEW-STRIPE-VOID-1 / NEW-MOYASAR-4XX  
6. P2 pack  

Items **1–3** are this pass’s ship gate (blocking). Item **4** is residual P1. Items **5–6** are this-pass P2s — do not leave as a silent money lie.

---

## Already closed (do not re-open)

From leftover-audit-r4 “Prior closed IDs”, leftover-r3, the first-pass ship-gate, and the session-audit fix-gate. Do **not** re-open unless current code still has the **original** lie.

```
WEBHOOKS-1, CORE-1–8 (original), STRIPE-1/2, STRIPE-CKO-1/CHG-1,
NEW-STRIPE-3 / CKO-200 / 1 / 2, PAYPAL-1/3, PAYPAL-IDEM-1 / DW-1 / ID-1,
NEW-PAYPAL-1, PAYMOB-1/2, PAYMOB-FENCE-1/2/3, PAYMOB-TOCTOU, AUTH-REDIR,
NEW-PAYMOB-2/TTL/REFUND-0, MOYASAR-CAP-0, NEW-MOYASAR-1/2/3,
CORE-INF-1/2, CORE-HW-1, NEW-CORE-1–7, MONEY-1, REDIS-1, RECON-1/2/3,
NEW-RECON-1/2, PERF-1/2, WEBHOOKS-403, NEW-WEBHOOKS-1, historical PP0–ST1
```

These are leftover **adjacent** classes, not regressions of the original IDs:

| Prior close | This-pass leftover |
| --- | --- |
| Moyasar create HTTP 200 `{}` kept as unknown (NEW-MOYASAR-1) | **NEW-MOYASAR-REFUND-ID** refund HTTP 200 `{}` still completes the fence |
| PAYMOB-2 / NEW-PAYMOB-2 5xx + 429 keep fence | **NEW-PAYMOB-4XX** 408 / 409 / 425 still delete the fence (Payment Keys after Orders 200) |
| PAYPAL-3 / NEW-PAYPAL-1 identity / idempotency | **NEW-PAYPAL-3** omitted `final_capture` still treated as `paid` |
| WEBHOOKS-1 redirect vs processed inbox key | **NEW-WEBHOOKS-2** processed same-id later snapshot is still `already_completed` |
| SQLFOUND-1 / WEBHOOKS-3 algorithm supersedes idle hashes | **NEW-SQL-1** store-contracts JSDoc still said idle mismatch is `payload_hash_conflict` |
| PKG-1 `createFakeExecutor` not on root export | **NEW-PKG-2** memory-relational `migrate()` still invented tables without applied `CREATE TABLE` |

---

## Stream J status

Fixed NEW-PKG-2 and NEW-SQL-1 in owned files. Wrote this ownership + residual checklist.

**NEW-PKG-2:** `createMemoryRelationalStore.migrate()` no longer `tables.add`s every logical name after apply. `createExecutor` still always `{ ok: true }` (in-memory fake) but only registers physical names from `CREATE TABLE` (and the migrations-ledger INSERT). `migrate("generic")` applies portable **prose** (not DDL) — domain tables stay missing and `verify()` fails closed. Documented NON-PRODUCTION / NON-DISTRIBUTED. Test: `packages/sql-foundation/src/reference/memory-relational-store.test.ts`.

**NEW-SQL-1:** `decideWebhookClaim` already superseded idle hashes (WEBHOOKS-3). Aligned `atomic-claims.md` and `store-contracts` JSDoc: `payload_hash_conflict` only under an **active** lease; idle/expired/pending mismatch **supersedes**. Locked via memory-relational claim tests (active conflict vs idle/backoff supersede).

**fixed_ids (this stream):** NEW-PKG-2, NEW-SQL-1.

Formal gate artifact is `leftover-audit-r4-fix-result-2026-08-16.md` (not this file). Integrate landed-vs-remaining is below.

---

## Integrate result (2026-08-16, uncommitted)

**Do not commit** (integrate instruction). Working tree is the A–J leftover-audit (round-4) diffs. This file is still **not** a formal gate result.

**Verify:** `bun run typecheck` green across the monorepo. `bun test` on core / webhooks / reconciliation / routing / testkit / observability / store-contracts / sql-foundation / store-d1 / store-durable-objects / store-redis / store-postgres / store-sqlite / store-turso → **2803 pass / 35 skip / 0 fail**. Known sql-foundation bun:sqlite WAL flake did **not** reproduce.

No broken TypeScript from parallel streams. No leftover-lie tests found that still lock refund-`{}`-as-completed, mutation-408-as-fence-delete, or omitted-`final_capture`-as-`paid`. Integrate did not need a code seam.

### Invariant cross-check (blocking)

| ID | Verdict | Evidence |
| --- | --- | --- |
| **NEW-MOYASAR-REFUND-ID** | landed | `refundPayment` calls `assertObservedPaymentId` after the mutating POST. HTTP 200 `{}` / missing `payment.id` throws `NetworkError({ afterProviderSubmit: true })`. `executeWithHooks` returns `outcome: indeterminate`; `runIdempotentMutation` keeps the fence `unknown` (not `completed` + `gatewayRefundId: undefined`). Same key cannot double-refund. Tests: empty `{}`; refunded status without id. |
| **NEW-PAYMOB-4XX** | landed | `isPaymobIndeterminateMutationHttpStatus` includes **408 / 409 / 425** (plus 429 / 5xx). `shouldRetainPaymobMutationFence` keeps those after POST. After Orders HTTP 200 + id, Payment Keys any HTTP error uses `unknownAfterObservedSideEffect: true` so `executeIdempotent` does **not** delete the create fence (no second `/api/ecommerce/orders`). Tests: refund POST 408; legacy Orders 200 then Payment Keys 408. |
| **NEW-PAYPAL-3** | landed | `PAYMENT.CAPTURE.COMPLETED` maps to `paid` only when `final_capture === true`; omitted/`undefined`/`false` → `partially_captured` (not `isPaidOutcome`). Capture-resource GET demotes `COMPLETED` unless `final_capture === true`. Order `mapPaymentResultStatus` demotes COMPLETED slices the same way. Tests: webhook omitted / false; getPayment order matching totals without `final_capture`; capture-id GET omitted. |

### Other P1

| ID | Verdict |
| --- | --- |
| **NEW-WEBHOOKS-2** | landed — processed Paymob `TRANSACTION` inbox keys are `paymob:TRANSACTION:{id}:{status}` when domain status is present. Later same-id void/refund snapshot is not `already_completed`. Redirect stays `TRANSACTION_RESPONSE:{txnId}`. `paymob.gateway.ts` `event.id` unchanged. |

### P2 pack

| ID | Verdict |
| --- | --- |
| **NEW-STRIPE-VOID-1** | landed — void HTTP 200 `{id}` without `status` is indeterminate, not coerced declined. |
| **NEW-STRIPE-INV-1** | landed — `invoice.paid` / `payment_succeeded` is `processing` unless `amount_paid` is finite and no credit-note remainder; never uses `amount_due` as collected; void/uncollectible object status wins. |
| **NEW-STRIPE-CKO-URL** | landed — `createCheckoutSession` omits `url` when Stripe returns `null` (does not invent a string). |
| **NEW-STRIPE-SETUP-1** | landed — `setup_intent.succeeded` parse status is `setup_completed`. |
| **NEW-CORE-8** | landed — `handleWebhook` rematch covers `capture.completed` / `refund.completed`; mapper rematches Moyasar `payment_captured` + partial/processing → `payment.processing`. Mapper test flipped. |
| **NEW-CORE-9** | landed — `success: false` + `refund_completed` / `refund_pending` / `reversed` infers `indeterminate`; refund coerce `failed`+`completed` → `succeeded`. |
| **NEW-CORE-10** | landed — `requires_action` + `status: failed` persists `declined` / `success: false`. |
| **NEW-MONEY-3** | landed — `paymentFromWebhookEvent` omits non-finite majors. |
| **NEW-PAYPAL-4** | landed — remaining-held rewrite runs for CAPTURE.REFUNDED / REVERSED even when resource status is COMPLETED; face amount omitted unless net remaining is proven. |
| **NEW-PAYPAL-5** | landed — auth GET omits `related_ids.capture_id` unless a single refundable capture is proven. |
| **NEW-PAYPAL-6** | landed — missing/unparsable order/auth total is incomplete (`isAggregateCapturePartial` true) → not `paid`. |
| **NEW-MOYASAR-4XX** | landed — mutation fence stays `unknown` on 408 / 409 / 425 (same class as 429). |
| **NEW-WH-1** | landed — inbox class uses `provider.eventType` or known Paymob HMAC classes only (not remapped `payment.succeeded`). |
| **NEW-ROUTE-1** | landed — complementary currency / country / method partitions honesty-block unconstrained fallback after exclude; amount/currency honesty `NoRouteMatchError` is not rewritten to `no_alternate_gateway`. |
| **NEW-STORE-2** | landed — recon in-memory `maxEntries` skips live `claimed` leases (refuses when all leased). |
| **NEW-STORE-3** | landed — webhooks memory `complete` / `renew` token-fence first; expired complete fails closed without wipe-then-lose. |
| **NEW-TESTKIT-6** | landed — scripted / `defaultOutcome: succeeded` + `capture: false` stays `authorized` (no forced paid / full capture). |
| **NEW-TESTKIT-7** | landed — create fingerprint includes `stripeCustomerId` / `paymobIntegrationId` / `paymobPaymentMethods`. |
| **NEW-TESTKIT-8** | landed — webhook helpers default status from type (`failed` → `failed`, not paid). |
| **NEW-OBS-2** | landed — `createRedactingLogger` / `redact` scrub `pi_*_secret_*` in allow-listed leaves and raw `message`. |
| **NEW-PKG-2** | landed — memory-relational `migrate()` registers only `CREATE TABLE` that ran. |
| **NEW-SQL-1** | landed — store-contracts JSDoc + `atomic-claims.md`: idle hash mismatch supersedes; `payload_hash_conflict` only under an active lease. |
| **NEW-PERF-8** | landed — SQL / DO `deleteExpired` default limit 1000 when `limit` omitted. |

### Documented leftovers (not NEW-*)

| ID | Verdict |
| --- | --- |
| **PERF-5** | **remaining (documented)** — DO hash `listDue` still wakes every isolate at full `limit`. No cheaper correct global earliest-N. |
| **PERF-6** | **remaining (unowned this pass)** — webhook path still parse / redact / stringify / SHA-256 / deep-clone large Stripe bodies more than once. |
| **PERF-7** | **remaining (documented)** — `processDue` / `processRetryable` stay list-then-serial-claim (list is not a fence). |

### Integrate-phase seams

None. Parallel streams did not break `exactOptionalPropertyTypes` or leave tests locking the leftover money/fence lies.

---

## Residual ID checklist (copy for critic / gate)

### Blocking

- [x] NEW-MOYASAR-REFUND-ID
- [x] NEW-PAYMOB-4XX
- [x] NEW-PAYPAL-3

### Other P1

- [x] NEW-WEBHOOKS-2

### P2 pack

- [x] NEW-STRIPE-VOID-1
- [x] NEW-STRIPE-INV-1
- [x] NEW-STRIPE-CKO-URL
- [x] NEW-STRIPE-SETUP-1
- [x] NEW-CORE-8
- [x] NEW-CORE-9
- [x] NEW-CORE-10
- [x] NEW-MONEY-3
- [x] NEW-PAYPAL-4
- [x] NEW-PAYPAL-5
- [x] NEW-PAYPAL-6
- [x] NEW-MOYASAR-4XX
- [x] NEW-WH-1
- [x] NEW-ROUTE-1
- [x] NEW-STORE-2
- [x] NEW-STORE-3
- [x] NEW-TESTKIT-6
- [x] NEW-TESTKIT-7
- [x] NEW-TESTKIT-8
- [x] NEW-OBS-2
- [x] NEW-PKG-2
- [x] NEW-SQL-1
- [x] NEW-PERF-8

### Documented leftovers (not NEW-\*; unowned unless already in-stream)

- [ ] PERF-5 (documented residual unless a stream can cheaply improve without breaking fencing)
- [ ] PERF-6 (documented residual)
- [ ] PERF-7 (documented residual; fencing stays list-then-claim)
