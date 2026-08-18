# PayKernel leftover audit (2026-08-16, round 4)

**Scope:** leftover money / fence / dual-write / recovery / honesty / perf holes after leftover-audit (round 3) fix-gate.  
**Prior closed IDs:** WEBHOOKS-1, CORE-1–8 (original), STRIPE-1/2, STRIPE-CKO-1/CHG-1, NEW-STRIPE-3 / CKO-200 / 1 / 2, PAYPAL-1/3, PAYPAL-IDEM-1 / DW-1 / ID-1, NEW-PAYPAL-1, PAYMOB-1/2, PAYMOB-FENCE-1/2/3, PAYMOB-TOCTOU, AUTH-REDIR, NEW-PAYMOB-2/TTL/REFUND-0, MOYASAR-CAP-0, NEW-MOYASAR-1/2/3, CORE-INF-1/2, CORE-HW-1, NEW-CORE-1–7, MONEY-1, REDIS-1, RECON-1/2/3, NEW-RECON-1/2, PERF-1/2, WEBHOOKS-403, NEW-WEBHOOKS-1, historical PP0–ST1.  
Do **not** re-open those unless the original lie is still in source.

**Verdict at pass start:** **SHIP_BLOCKED** on Moyasar refund HTTP 200 `{}` completing the fence, Paymob mutation 408 / non-429 4xx deleting the fence (including Payment Key after Orders 200), and PayPal omitted `final_capture` treated as full `paid`.

---

## Blocking (must close)

| ID | Sev | One-line |
| --- | --- | --- |
| **NEW-MOYASAR-REFUND-ID** | P1 | `refundPayment` never calls `assertObservedPaymentId`. HTTP 200 `{}` → `pending` + `gatewayRefundId: undefined`; `runIdempotentMutation` persists `completed`. New key double-refunds. Create path was fixed (NEW-MOYASAR-1). |
| **NEW-PAYMOB-4XX** | P1 | After a mutating POST, only `>=500` and `429` stay indeterminate. **408 / 409 / 425** delete the fence. Sharp: legacy Orders HTTP 200 + id, then Payment Keys 4xx, releases the create fence → second `/api/ecommerce/orders`. |
| **NEW-PAYPAL-3** | P1 | `PAYMENT.CAPTURE.COMPLETED` / capture GET / order mapping treat missing `final_capture` as **paid**. PayPal API default is `false`. Thin/incomplete COMPLETED fulfills while auth can still be captured. |

---

## Other P1 / residual (fix in this pass)

| ID | One-line |
| --- | --- |
| **NEW-WEBHOOKS-2** | Processed Paymob `TRANSACTION` inbox key is still `obj.id`. Later same-id void/status snapshot is `already_completed`. Prefer keying processed snapshots by native type **and** domain status (`TRANSACTION:{id}:{status}`) so a later void can run. Child refunds already have new ids. |

---

## P2 (fix if cheap; do not leave as silent money lie)

| ID | One-line |
| --- | --- |
| **NEW-STRIPE-VOID-1** | Void POST only asserts `id`. Missing `status` → `mapStatus(undefined)=failed` + `forceOutcome: succeeded` → coerced **declined**. Uncertain cancel looks like a clean decline. Require status; missing → indeterminate. |
| **NEW-STRIPE-INV-1** | `invoice.paid` / `payment_succeeded` always domain `paid`. Credit notes unread; amount falls through `amount_paid` → `total` → `amount_due`. Dual-write is `provider.unmapped`. Status-only persist can overwrite refunded → paid. Prefer `processing` unless `amount_paid` is finite and no credit-note remainder; never use `amount_due` as collected. |
| **NEW-STRIPE-CKO-URL** | `createCheckoutSession` is `success: true` after id only; `url` may be `null`. Document + omit `url` when null (do not invent). |
| **NEW-STRIPE-SETUP-1** | `setup_intent.succeeded` catalog is `setup_completed` but parse default leaves non-PI objects `pending`. Map setup_intent.succeeded → `setup_completed`. |
| **NEW-CORE-8** | `handleWebhook` rematch and `coerceStableSucceededToDomainStatus` only rewrite **`payment.succeeded`**. A v1 `capture.completed` / `refund.completed` on `partially_captured` / `processing` is unchanged. Built-ins demote in-gateway; mapper tests lock Moyasar `payment_captured` + partial → `capture.completed`. Rematch those arms; flip the mapper test. |
| **NEW-CORE-9** | Payment `inferOperationOutcome`: `success: false` + `refund_completed` / `refund_pending` / `reversed` forges **failed**. Refund coerce does not upgrade `failed` + `completed`. Add those statuses to the indeterminate list; coerce `failed`+`completed` → `succeeded` (status wins). |
| **NEW-CORE-10** | `requires_action` + `status: failed` persists `success: true`. Demote to `declined` / `failed`. |
| **NEW-MONEY-3** | `paymentFromWebhookEvent` publishes `event.amount` without `Number.isFinite`. Omit non-finite majors. |
| **NEW-PAYPAL-4** | Remaining-held rewrite skipped unless resource status already looks refunded. Face amount can be this-op / order total while status is correctly `partially_refunded`. |
| **NEW-PAYPAL-5** | Auth GET always copies `related_ids.capture_id` with no sibling check. Multi-capture can point refunds at the wrong slice. Prefer omit captureId unless a single held capture is proven. |
| **NEW-PAYPAL-6** | `isAggregateCapturePartial` returns false when order/auth total is missing → COMPLETED becomes `paid`. Missing total → not paid (`processing` / `partially_captured`). |
| **NEW-MOYASAR-4XX** | Mutation fence clears on every 4xx except 429, including **408**. Treat 408/409/425 as indeterminate (keep fence). |
| **NEW-WH-1** | Inbox class falls through to domain `type` when `provider.eventType` is missing (`payment.succeeded` vs `TRANSACTION`) → second key, double-run. Only use provider-native type or known Paymob classes. |
| **NEW-ROUTE-1** | Amount/capability honesty blocks unconstrained fallback. Complementary **currency / country / method** partitions do not. After exclude, do not use unconstrained fallback when a complementary currency/country/method rule existed. Post-attempt: do not rewrite amount/currency honesty `NoRouteMatchError` to `no_alternate_gateway`. |
| **NEW-STORE-2** | Recon in-memory `maxEntries` evicts oldest key with no active-lease skip. Skip live `claimed`. |
| **NEW-STORE-3** | Memory `complete` / `renew` wipe expired leases before token fence. Match durable adapters (expired complete still records if token matches, or fail closed without wiping first). |
| **NEW-TESTKIT-6** | Scripted / `defaultOutcome: { outcome: "succeeded" }` forces `status: "paid"` and full-captures even with `capture: false`. Honor `capture: false` → authorized when capability exists. |
| **NEW-TESTKIT-7** | Create fingerprint omits `stripeCustomerId` / `paymobIntegrationId` / `paymobPaymentMethods`. |
| **NEW-TESTKIT-8** | Webhook helpers default `status: "paid"` when omitted. Default status from type (failed → failed). |
| **NEW-OBS-2** | `createRedactingLogger` does not scrub `pi_*_secret_*`. Allow-listed leaves / raw `message` can leak PI client secrets. |
| **NEW-PKG-2** | Root `createMemoryRelationalStore.migrate()` marks tables present without applying DDL (`createExecutor` always `{ ok: true }`). Do not pretend migrate succeeded without applying statements; or stop root-exporting a always-ok executor as production-adjacent. Honesty: document NON-PRODUCTION and do not insert logical tables unless statements actually ran. |
| **NEW-SQL-1** | Docs/contracts still say idle hash mismatch is `payload_hash_conflict`. Code supersedes idle hashes. Align docs with algorithm. |
| **NEW-PERF-8** | SQL `deleteExpired` with no `limit` is unbounded DELETE. Default a finite limit (e.g. 1000) like Redis. |

Residual **PERF-5 / PERF-6 / PERF-7** stay documented leftovers unless a stream can cheaply improve them without breaking fencing.

---

## Recommended close

1. NEW-MOYASAR-REFUND-ID  
2. NEW-PAYMOB-4XX  
3. NEW-PAYPAL-3  
4. NEW-WEBHOOKS-2  
5. NEW-CORE-8 / NEW-STRIPE-VOID-1 / NEW-MOYASAR-4XX  
6. P2 pack  

Items **1–3** are this pass’s ship gate (blocking). Item **4** is residual P1. Items **5–6** are this-pass P2s — do not leave as a silent money lie.
