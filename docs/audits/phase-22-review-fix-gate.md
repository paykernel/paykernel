# Phase 22 review adversarial gate (2026-08-20)

**Workflow:** `.grok/workflows/phase-22-review-fix-gate.rhai`  
**Bookkeeping (not this verdict):** critic / fix / verify agent summaries.  
**Method:** re-read current source with `read_file` / `grep`. Independently ran typecheck and the workflow test set. Implement summaries were not treated as evidence.

| Field | Value |
| --- | --- |
| `pass` | **true** |
| `typecheck` | **exit 0** — `bun run --filter @paykernel/core typecheck` and `typecheck:types` |
| `tests` | **361 pass / 0 fail** — workflow set (`packages/core/src/gateways/stripe`, money-identity, checkout/disputes/payment-links acceptance, public-api, `packages/testkit/src/mock/mock-gateway.test.ts`) |
| extra | **134 pass / 0 fail** — `packages/core/src/types/payment-event.test.ts` (P22-DASH-URL; not in the workflow verify glob) |

Blocking IDs (CKO-404, FREEZE-LIST, DOCS-SHAPE, LINK-AMOUNT, GET-FLAG, CURRENCY) are gone in current source. C1 / r7 S19 / r8 ship-gates were not reopened.

---

## Per-ID

| ID | Status | Evidence |
| --- | --- | --- |
| **P22-CKO-404** | closed | `getCheckoutSession` catch → `stripeNotFoundFailed` (`stripe.gateway.ts:2828–2833`). Test `getCheckoutSession 404 is a failed outcome, not a throw` (`stripe.gateway.test.ts:5877–5898`) expects `outcome: "failed"`, `error.code === "GATEWAY_API_ERROR"`. Same helper as `getCustomer` (`:3130`). |
| **P22-FREEZE-LIST** | closed | `NESTED_IDENTITY_KEYS` includes `paymentMethods` and `disputes` (`money-identity.ts:68–79`). `shallowCloneResult` / `restoreMoneyIdentityFields` deep-clone those arrays. Tests `P22-FREEZE-LIST` (`money-identity.test.ts:51–129`) prove in-place nested mutation does not poison original or restored result; hook-replaced arrays restore via deep clone. |
| **P22-DOCS-SHAPE** | closed | `stripe.md:240–256` get snippet uses `result.outcome`, `result.session.references.providerObjectId`, `relatedIds.paymentIntentId`. Tree grep: no `session.sessionId` / `session.paymentIntentId`. Create return is `{ outcome: "succeeded", session }` (`stripe.md:169`), not `success: true`. 404 contract documented (`stripe.md:257`). `hosted-checkout.md:7–35` already used the outcome union. |
| **P22-LINK-AMOUNT** | closed | GET `expand[]=line_items` (`stripe.gateway.ts:3421`). `stripePaymentLinkPublishedMoney` publishes only exactly one line item with finite unit amount + currency; 0 / many / `has_more` omit (`:1680–1718`). Create copies request money only when the mapper omitted it (`:3394–3403`). Docs (`payment-links.md:27`). Tests GET expanded publishes `25`/`USD`; unexpanded omits (`stripe.payment-links.test.ts:132–186`). |
| **P22-CURRENCY** | closed | Checkout get/create set `snapshot.currency = currency.toUpperCase()` (`stripe.gateway.ts:2894–2896`, `:3060–3063`). Tests expect `"USD"` (`stripe.gateway.test.ts:3587`, `:5708`). Disputes already uppercased (`:1783–1786`). |
| **P22-GET-FLAG** | closed | GET `mapStripePaymentLink(response)` omits `afterProviderSubmit` (`:3428`). Missing id/url throw `NetworkError` without the flag (`:1835–1860`; `errors.ts:225` defaults false). CREATE/deactivate still pass `{ afterProviderSubmit: true }` (`:3394–3396`, `:3462–3464`). Test: 200 without url → `NetworkError` and `afterProviderSubmit !== true` (`stripe.payment-links.test.ts:111–129`). |
| **P22-DASH-URL** | closed (helper not shared) | Webhook path uses `/^ch_[A-Za-z0-9_]+$/` (`payment-event.ts:1034–1038`, `:1086–1089`), not `startsWith("ch_")`. Gateway GET already used `STRIPE_CHARGE_ID_PATTERN` (`stripe.gateway.ts:275`, `:1737–1745`). Tests `P22-DASH-URL` (`payment-event.test.ts:1675–1788`) reject `ch_`, `ch_abc-def`, path/query junk. Duplicate regex is allowed leftover. |
| **P22-NATIVE-STATUS** | closed | Domain `status` is `active` iff `active === true`, else `inactive` (`:1862–1863`). `providerNativeStatus` is `"true"` / `"false"` (`:1871`). Tests lock that split (`stripe.payment-links.test.ts:72–73`, `:165`, `:206–207`). |
| **P22-CKO-CREATE-AMOUNT** | closed | HTTP 200 with finite `amount_total` + currency publishes major + uppercase ISO; omit if currency missing; no invented `0` (`:3060–3067`). Tests `P22-CKO-CREATE-AMOUNT` (`stripe.gateway.test.ts:3561–3616`). |
| **P22-MOCK-QUEUE** | leftover (non-blocking) | `createCheckoutSession` / `getDispute` / `createPaymentLink` still always succeed (`mock-gateway.ts:1831–1857`, `:2002–2020`, `:2060–2081`). `track()` records history only. `enqueue` is money ops only (`:333–336`). Comment: claim_method_presence. No testkit callers script those ops. Allowed by the workflow gate prompt. |

---

## Remaining nits (not ship-blockers)

1. **P22-MOCK-QUEUE** as above — claim stubs, not FIFO.
2. **Dashboard helper duplication** — same charge-id regex in `payment-event.ts` and `stripe.gateway.ts` (cycle-avoidance; allowed).
3. **`stripe.md` create samples** still bind `const session = await stripe.createCheckoutSession(...)` without an `outcome` branch (`stripe.md:64–104`). Get snippet and prose are the outcome union; this is naming leftover, not `session.sessionId` / `success: true`.
4. **GET missing payment-link `id`** shares the GET mapper path but has no dedicated test (missing `url` is locked).
5. **`deactivatePaymentLink`** does not `expand[]=line_items`; money is omitted unless Stripe includes a single observable line item (fail-closed, not a create-vs-get lie).

None of these restore a 404 throw, list-identity poison, stale checkout docs shape, GET money invention, GET post-submit flag, or lowercase checkout currency.

---

## Verdict

**Pass.** Named blockers are gone with file:line evidence. Typecheck exit 0. Workflow tests 361/0. Extra payment-event tests 134/0. Leftovers are mock FIFO stubs, duplicated dashboard regex, and create-sample naming.

**Working tree:** uncommitted Phase 22 review diffs. Do **not** commit. Do **not** push.
