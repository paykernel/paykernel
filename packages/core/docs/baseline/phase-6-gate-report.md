# Phase 6 adversarial gate report

**Date (UTC):** 2026-08-02  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Implementer claims under review

| Claim | Independent result |
| --- | --- |
| typecheck (core + testkit + types) | **PASS** — `bun run typecheck` exit 0; `bun run typecheck:types` exit 0 |
| 895 core+testkit tests | **PASS** — `bun test packages/core packages/testkit` → **895 pass, 0 fail**, 3630 expects, 30 files |
| coverage 98.36% lines / 99.09% funcs | **PASS** — measured **98.36% lines / 99.09% funcs** (`bun test --coverage packages/core`) |
| build + dist/index.js | **PASS** — `validate:package` rebuilds; `packages/core/dist/index.js` present (~276 KB); Phase 6 `.d.ts` emitted (`operation-result`, `domain-status`, `provider-refs`) |
| boundaries | **PASS** — `bun run check:boundaries` → workspace boundaries OK |
| validate:package (pack+publint+attw+smoke) | **PASS** — full `bash scripts/validate-package.sh` OK (typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke) |
| Phase 6 feature flags green (CommonPaymentInput isolation, 5-arm PaymentOperationResult, isPaidOutcome, indeterminate+reconciliationRequired, domain status unions, ProviderReferences dual-write, 4 gateways applyOutcome, success dual-write, operation-results.md, after-hook freeze, Phase 5 money 92/92) | **PASS** — see acceptance + task sections below |
| No fixes needed; no commit | **Accepted** — independent re-run all green; no logical bugs found under Phase 6 anti-patterns |
| verify failures `[]` / ok `true` | **Accepted** — independent re-run all green (not trusted alone) |

---

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test packages/core packages/testkit` | **895 pass, 0 fail** (30 files, 3630 expects) |
| `bun test --coverage packages/core` | **811 pass**; **99.09% funcs / 98.36% lines**; thresholds met |
| Phase 6 unit + acceptance suites | `operation-result.test.ts` + `operation-results.acceptance.test.ts` → **38 pass, 0 fail** |
| Phase 5 money safety net | money + edge + provider-profiles → **92 pass, 0 fail** |
| `bun run typecheck` | exit 0 (core + testkit) |
| `bun run typecheck:types` | exit 0 |
| `bun run check:boundaries` | exit 0 |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke **OK** |
| core → testkit dep | **none** — core `dependencies` = `{ zod }` only; no `@paykernel/testkit` import under `packages/core/src` |

### Static / source audits

| Audit | Result |
| --- | --- |
| `CommonPaymentInput` keys | Only `amount`, `orderId?`, `description?`, `metadata?` — `payment.types.ts` |
| Type exclusion of provider keys | `operation-result.test.ts` (`CommonKeys & ForbiddenProviderKeys` → `never`); `public-api.types.test.ts` `@ts-expect-error` on stripe/moyasar/currency |
| 5-arm `PaymentOperationResult` | `succeeded` \| `requires_action` \| `declined` \| `failed` \| `indeterminate` with `reconciliationRequired: true` literal on indeterminate |
| `isPaidOutcome` | Requires `outcome === 'succeeded'` **and** paid-like status (`paid`/`approved` only; **not** `authorized`) |
| All 4 gateways dual-write | `applyOutcomeToGatewayResult` used in stripe / moyasar / paypal / paymob gateway sources |
| After-hook identity freeze | `base.gateway.ts` `MONEY_IDENTITY_KEYS` includes `outcome`, `references`, `reconciliationRequired`, `success`, `status`, ids; `restoreMoneyIdentityFields` strips forged identity fields; client tests assert cannot forge paid from `requires_action` |
| Docs | `packages/core/docs/operation-results.md` present; packed in validate tarball |

---

## Acceptance criteria (roadmap Phase 6)

### A1) pending or requires-action results cannot be mistaken for paid — **PASS**

| Evidence | Detail |
| --- | --- |
| Helper | `isPaidOutcome` (`operation-result.ts`): succeeded **and** `isPaidLikePaymentStatus` (`paid`/`approved` only) |
| Mapping | `inferOperationOutcome` maps pending/processing/clientSecret/nextAction → `requires_action`, never `succeeded` |
| Dual-write | `successFromOutcome('requires_action') === true` but `isPaidOutcome` remains false (documented API-ok ≠ paid) |
| Type discrimination | `@ts-expect-error` cross-assignability of outcome arms in type tests |
| Gateway paths | Stripe `mapStripeOutcome`: native `requires_action` / `requires_payment_method` / `requires_confirmation` → `requires_action`; Moyasar 3DS/STC OTP → `requires_action`; PayPal create approval → `requires_action`; Paymob Intention create → hard-coded `requires_action` |
| Tests | AC1 suite: pending+success not paid; authorized not paid; cross-gateway AC6 cases; gateway tests expect `outcome: "requires_action"` on 3DS-style creates |
| After-hooks | `cannot forge paid outcome from requires_action via after-hook modifiedResult` |

### A2) indeterminate outcomes are explicit — **PASS**

| Evidence | Detail |
| --- | --- |
| Type | Indeterminate arm requires `reconciliationRequired: true` (literal `true`, not optional boolean) |
| Apply helper | `applyOutcomeToGatewayResult('indeterminate')` always sets `reconciliationRequired: true` |
| Map helper | `mapGatewayResultToOperationResult` with `reconciliationRequired` / raw markers → indeterminate arm with literal true |
| Success dual-write | `successFromOutcome('indeterminate') === false` — **not** a definitive decline substitute for fulfillment; docs say must reconcile |
| Tests | AC2 + refund AC7 indeterminate cases; type-level `IndeterminateOp['reconciliationRequired']` equals `true` |
| Policy docs | Engineering Rule 3 in `operation-result.ts` + `operation-results.md`: post-submit unknown → indeterminate, not forged failed |

### A3) provider-specific fields do not pollute common inputs — **PASS**

| Evidence | Detail |
| --- | --- |
| Type | `CommonPaymentInput` = amount + orderId + description + metadata only |
| Type tests | `keyof CommonPaymentInput` equals `"amount" \| "orderId" \| "description" \| "metadata"`; assigning `stripePaymentMethodId` / `moyasarSource` / `currency` is `@ts-expect-error` |
| Intersection proof | Forbidden provider key set intersect `keyof CommonPaymentInput` is `never` |
| Runtime smoke | AC3 keys assertion on object shape |
| 0.x note | `CreatePaymentParams` **still** carries optional provider fields by design (mega-interface convenience); A3 targets the **common** contract isolation, not deletion of 0.x convenience fields. Prefer provider-typed create params. |

---

## Phase 6 tasks 6.1–6.4

### 6.1 CommonPaymentInput + provider typed extensions path — **PASS**

- `CommonPaymentInput` + `PaymentMetadata` in `payment.types.ts`
- `CreatePaymentParams extends CommonPaymentInput` with documented provider optional fields
- Provider-typed extensions remain (Moyasar/Stripe/PayPal/Paymob create param types + schemas)
- Exported from package root (`index.ts`)

### 6.2 PaymentOperationResult replaces success-as-paid semantics; success deprecated dual-write — **PASS**

- 5-arm `PaymentOperationResult` + helpers: `mapGatewayResultToOperationResult`, `applyOutcomeToGatewayResult`, `successFromOutcome`, `isPaidOutcome`, `isRequiresActionOutcome`, `isIndeterminateOutcome`, `inferOperationOutcome`
- `GatewayPaymentResult.outcome?` dual-write; `success` derived from outcome table (`succeeded`/`requires_action` → true; declined/failed/indeterminate → false)
- Docs + README production checklist: fulfill on `isPaidOutcome` / paid status, not `success` alone
- Parallel refund surface: `RefundOperationResult` + map helpers
- Testkit mock dual-writes via core `applyOutcomeToGatewayResult`

### 6.3 Separate domain status unions — **PASS**

Present in `domain-status.ts` and exported:

- `PaymentDomainStatus`, `AuthorizationStatus`, `CaptureStatus`, `RefundDomainStatus`
- `SetupTokenStatus`, `DisputeStatus`, `TransferStatus`, `PayoutStatus`
- Runtime guards: `isPaymentDomainStatus`, `isPaidLikePaymentStatus`, `PAYMENT_DOMAIN_STATUSES`, `PAID_LIKE_PAYMENT_STATUSES`
- Domain union excludes legacy mega-only values (`setup_completed`, `refund_*`); legacy `PaymentStatus` retained for 0.x / webhooks (Phase 7)

### 6.4 ProviderReferences standardized fields — **PASS**

`ProviderReferences` includes:

- `internalReference?`, `providerObjectId`, `providerRequestId?`
- `parentId?`, `relatedIds?` (order/capture/authorization/refund/charge/customer + index)
- `providerNativeStatus?`, `normalizedStatus`, `gateway`

`buildProviderReferences()` dual-writes structured refs while gateways keep legacy flat `gatewayId` / `orderId` / `captureId` / `authorizationId`. Applied via `applyOutcomeToGatewayResult` on all four built-ins.

### Phase 0–5 safety net + boundaries — **PASS**

- Full core+testkit suite green (includes prior-phase coverage)
- Phase 5 money suites **92/92**
- `check:boundaries` OK
- No core → testkit dependency

### Logical bug scan (fail closed) — **PASS (none found)**

| Anti-pattern | Status |
| --- | --- |
| 3DS / requires_action treated as paid | **Absent** — gateway mappers force `requires_action`; `isPaidOutcome` false; tests on Stripe/Moyasar/PayPal/Paymob creates |
| Timeout as definitive failed (decline/fulfill) | **Absent** — timeouts throw `NetworkError` (transport); indeterminate arm forces `reconciliationRequired`; docs forbid forging failed |
| CommonPaymentInput pollution | **Absent** — type + test proof of no stripe/moyasar/paypal/paymob keys |
| After-hooks forging outcome / references / paid | **Blocked** — identity restore + strip of forged keys; client tests cover requires_action→succeeded forge attempt and in-place mutation |
| Missing references on gateway dual-write path | **Covered** — `applyOutcomeToGatewayResult` always builds `references` when omitted; map embeds on `payment.references` |
| Auth hold mistaken for paid | **Absent** — `authorized` can be operation `succeeded` but `isPaidOutcome` false |

---

## Non-blocking notes

1. **`operation-result.ts` file-level line coverage (~87%)** is below package aggregate because some error-like helper branches (`toPaymentErrorLike`, sparse failed/declined arms) are lightly exercised; aggregate **98.36% lines / 99.09% funcs** still clears policy floors. Not a Phase 6 acceptance failure.
2. **`CreatePaymentParams` remains a 0.x mega-interface** with optional provider keys — intentional convenience; common isolation is via `CommonPaymentInput` and typed extensions. Documented in types + `operation-results.md`.
3. **Legacy `PaymentStatus` mega-union** retained for webhooks and 0.x compatibility; domain unions are preferred for new modeling (webhook rewrite is Phase 7).
4. **Transport timeouts throw** rather than always returning `outcome: 'indeterminate'` — consistent with pre-submit/transport failure policy; post-submit ambiguity still has explicit indeterminate dual-write when gateways set it.

---

## Checklist summary

| ID | Criterion | Result |
| --- | --- | --- |
| A1 | pending / requires_action cannot be mistaken for paid | PASS |
| A2 | indeterminate outcomes are explicit | PASS |
| A3 | provider fields do not pollute CommonPaymentInput | PASS |
| 6.1 | CommonPaymentInput + provider typed extensions | PASS |
| 6.2 | PaymentOperationResult + success dual-write (not paid) | PASS |
| 6.3 | Domain status unions (payment, auth, capture, refund, setup, dispute, transfer, payout) | PASS |
| 6.4 | ProviderReferences standardized + dual-write | PASS |
| Safety | typecheck / types / 895 tests / coverage / build / boundaries / validate / no core→testkit | PASS |
| Money | Phase 5 money 92/92 still green | PASS |
| Bugs | No 3DS-as-paid / timeout-as-definitive-fail / input pollution / after-hook forge / missing refs | PASS |

---

## Verdict

**PASS** — Phase 6 Typed Provider Inputs and Operation Results acceptance criteria and tasks 6.1–6.4 are independently verified. No blocking defects. No code fixes required from this gate. No commit required.
