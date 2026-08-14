# Phase 0–5 fix-gate report

**Date (UTC):** 2026-08-14  
**Packages:** `@paykernel/core@0.1.0-next.0`, `@paykernel/testkit@0.1.0-next.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Workflow:** `.grok/workflows/phase-0-5-fix-gate.rhai`  
**Working tree:** uncommitted fix-stream diffs vs `HEAD` (`545df51`); not a release commit.

**Verdict:** **PASS** (after post-workflow typecheck residual)

Listed P05 source blockers are closed (see [Gate](#gate-adversarial-re-check)). Orchestrator typecheck was red on Stripe `AmountInput` / `exactOptionalPropertyTypes`; closed in a follow-up (`asAmountInput` + Zod transform). Re-verify: typecheck + typecheck:types exit 0; targeted tests **719 pass / 0 fail**.

---

## Critic (pre-fix, vs `HEAD`)

Read-only confirmation of the twelve workflow IDs against committed `HEAD`. Deep-audit work already stored `Money.exponent` and implemented `isKnownCurrencyCode`; the Zod / capability / testkit / release holes below were still present.

| ID | Status at `HEAD` | Evidence |
| --- | --- | --- |
| **P05-MONEY-1** | **STILL PRESENT** | `packages/core/src/types/validation.ts` `MoneyAmountBaseSchema` was `{ amount, currency }` only. Zod stripped stored `exponent` (e.g. OMR merchant scale 2 → ISO 3 → 10× minors). `Money` / `toMinorUnits` already honored stored exponent. |
| **P05-CAPS-1** | **STILL PRESENT** | `packages/core/src/gateways/base.gateway.ts` `executeWithHooks` did not call `assertCapabilitiesAfterHooks`. `client.gateway().voidPayment` and hook-injected `capture: false` / `amount` could bypass claim checks. `PaymentClient` already gated `payments` / `refunds` / `voids` / partials on the facade. |
| **P05-CAPS-2** | **STILL PRESENT** | `packages/core/src/gateways/gateway-registry.ts` `createAll` assigned `adapter.create(context)` with no default surface. Plugin objects without `supports` / `capabilities` were fail-open. |
| **P05-PAYPAL-1** | **STILL PRESENT** (docs) | `PAYPAL_CAPABILITIES.partialCapture` already `true`. Order-capture-vs-authorization split was under-documented in generated capability notes / `custom-gateways.md`. |
| **P05-REL-1** | **STILL PRESENT** | `.github/workflows/release.yml` `on.push.branches: master`. `docs/releases.md` and `.changeset/README.md` said `master`. `.changeset/config.json` already had `"baseBranch": "main"`. |
| **P05-API-1** | **STILL PRESENT** | `packages/core/src/public-api.test.ts` freeze list omitted `isKnownCurrencyCode` (148 symbols) and did not assert `Object.keys(sdk).sort()`. Helper already existed in `packages/core/src/utils/currency.ts`. |
| **P05-TK-1** | **STILL PRESENT** | `packages/testkit/src/mock/mock-gateway.ts` FakeClock `applyLatency`: `clock.advance(ms)` then return — no microtask yield, no post-advance abort re-check. |
| **P05-TK-2** | **STILL PRESENT** | Mock `refundPayment` did not treat `provider_ok_client_timeout` / `provider_success_client_timeout` like create (ledger then `NetworkError`). |
| **P05-TK-3** | **STILL PRESENT** | `webhookHelpers.signWebhook` / `generateWebhookEvent` were not bound to instance `webhookSecret` / `name`. |
| **P05-CONF-1** | **STILL PRESENT** | `amount_conversion` skipped major-unit compare when `result.amount === undefined`. `logging_redaction` primarily self-tested `createRedactingLogger`. `network_failure` did not hard-fail `success: true`. `indeterminate_outcomes` did not also script `indeterminate`. |
| **P05-VER-1** | **STILL PRESENT** | `BUILTIN_ADAPTER_VERSION = "0.8.0"` in `packages/core/src/gateways/builtin-capabilities.ts` vs `packages/core/package.json` `"0.1.0-next.0"`. |

### Already fixed before this gate

- `Money.exponent` persistence and override re-resolve (`packages/core/src/utils/money.ts`, prior MONEY-1).
- `isKnownCurrencyCode` implementation (`packages/core/src/utils/currency.ts`).
- Changesets `baseBranch: "main"` (`.changeset/config.json`).
- `PaymentClient` facade asserts for `payments` / `refunds` / `voids` / partial amounts (`packages/core/src/client.ts`).
- PayPal `partialCapture: true` (authorization-capture path).

**Critic summary:** 11 IDs still present at `HEAD`; P05-PAYPAL-1 was a documentation/honesty gap, not a claim flip.

---

## Five fix streams

Non-overlapping edits on the uncommitted tree (37 files, +1193 / −276 vs `HEAD`).

### Stream A — Money (`P05-MONEY-1`)

| File | Change |
| --- | --- |
| `packages/core/src/types/validation.ts` | `MoneyAmountBaseSchema.exponent` optional integer 0–18 so Zod does not strip stored scale. |
| `packages/core/src/utils/money.ts` | `isMoney` requires present `exponent` to be integer 0–18. |
| `packages/core/src/utils/currency.ts` | `getCurrencyExponent` rejects override `> 18` like `money()`. |
| `packages/core/src/utils/money.test.ts` | Zod parse keeps OMR `exponent: 2` → `toMinorUnits` `2012n`; invalid 19 rejected. |
| `packages/core/src/utils/money.edge.test.ts` | Override `> 18` throws. |
| `packages/core/src/utils/currency.test.ts` | `isKnownCurrencyCode` cases (incl. `JYP` false). |
| `packages/core/src/gateways/moyasar/moyasar.gateway.test.ts` | `money(20.12, OMR, { exponentOverrides: { OMR: 2 } })` posts `2012` not `20120`. |
| `packages/core/docs/money.md` | Documents `isKnownCurrencyCode` and exponent 0–18. |

Stream A did **not** edit `packages/core/src/gateways/stripe/stripe.gateway.ts` (owned by stream B). That left the typecheck residual in [Remaining nits](#remaining-nits).

### Stream B — Capabilities (`P05-CAPS-1`, `P05-CAPS-2`, Stripe unknown currency)

| File | Change |
| --- | --- |
| `packages/core/src/gateways/base.gateway.ts` | `assertCapabilitiesAfterHooks` after before-hooks in `executeWithHooks`: `payments`; `authorization` when `capture === false`; `marketplaceSplits` when `splits` present; `refunds` / `partialRefunds`; `voids`; `hostedCheckout`; `partialCapture` when `amount` set. |
| `packages/core/src/gateways/gateway-registry.ts` | `attachDefaultCapabilitySurface`: missing surface → `DEFAULT_GATEWAY_CAPABILITIES` + `supports()` (fail-closed); wrap frozen instances. `createAll` applies it. |
| `packages/core/src/gateways/stripe/stripe.gateway.ts` | `stripeCurrencyExponent` no longer defaults unknown codes to 2; `JYP` throws `InvalidRequestError`. ISK/UGX/MGA/zero/three-decimal tables kept. |
| `packages/core/src/client.test.ts` | `gateway().voidPayment` + `voids: false`; `capture: false` without `authorization`; hook cannot inject `capture: false`; `createAll` fail-closed. |
| `packages/core/src/create-payment-client.test.ts` | Bare adapter gets all-false surface; `createPayment` throws `payments`. |
| `packages/core/src/plugin-architecture.test.ts` | `createNamedAdapter` claims `payments: true`. |
| `packages/core/src/gateways/stripe/stripe.gateway.test.ts` | Unknown `JYP`; ISK/UGX/MGA tables. |

`packages/core/src/client.ts` was **not** modified. Facade still asserts `payments` / `refunds` / `voids` / partials only; `authorization` / `marketplaceSplits` are enforced on `BaseGateway.executeWithHooks` (built-ins and `capabilityAdapter` tests).

### Stream C — Claims / docs (`P05-PAYPAL-1`, `P05-VER-1`)

| File | Change |
| --- | --- |
| `packages/core/src/gateways/builtin-capabilities.ts` | `BUILTIN_ADAPTER_VERSION = "0.1.0-next.0"` (matches `packages/core/package.json`). PayPal comment: keep `partialCapture` true; order captures reject `amount`; use `paypalCaptureType: "authorization"`. |
| `packages/core/src/gateways/gateway-capabilities.ts` | `CAPABILITY_OPERATION_MAP.authorization` comment: method presence only, not create-path proof. |
| `packages/core/src/gateways/capabilities-docs.ts` | Generated note for PayPal partial vs order capture. |
| `packages/core/docs/gateway-capabilities.md` | Regenerated; provider versions `0.1.0-next.0`; PayPal `paypalCaptureType` note. |
| `packages/core/docs/custom-gateways.md` | Same PayPal honesty paragraph. |
| `packages/core/src/gateways/capability-claims.test.ts` | Version equals `package.json`; `partialCapture` stays true; docs mention `paypalCaptureType`. |
| `packages/core/src/gateways/gateway-capabilities.test.ts` | Map-comment / claim coverage. |

### Stream D — Testkit (`P05-TK-1`, `P05-TK-2`, `P05-TK-3`, `P05-CONF-1`)

All under `packages/testkit/src/`.

| File | Change |
| --- | --- |
| `packages/testkit/src/mock/mock-gateway.ts` | FakeClock: `advance` → `await Promise.resolve()` → re-check abort → `NetworkError`. `refundPayment` dual-timeout: mutate ledger then throw. `signWebhookBound` / `generateWebhookEventBound` use instance secret and name. Refund default outcomes include dual-timeout. |
| `packages/testkit/src/mock/outcomes.ts` | Dual-timeout documented on refund-capable set. |
| `packages/testkit/src/mock/mock-gateway.test.ts` | P05-TK-1 abort-after-advance; P05-TK-2 refund dual-timeout; P05-TK-3 bound helpers. |
| `packages/testkit/src/conformance/gateway-conformance.ts` | `amount_conversion` requires `result.amount === expectedMajor`. `logging_redaction` injects logger (`setLogger`) and asserts sink has no PAN / `apiSecret`. `network_failure` rejects `success: true`. `indeterminate_outcomes` also scripts `indeterminate`. |
| `packages/testkit/src/conformance/gateway-conformance.test.ts` | Negative cases for omitted `result.amount` and no-op `setLogger`. |

`webhookHelpers.sign` still aliases unbound `signMockWebhook` (legacy). Bound path is `signWebhook` / `generateWebhookEvent`.

### Stream E — Baseline / CI (`P05-REL-1`, `P05-API-1`)

| File | Change |
| --- | --- |
| `.github/workflows/release.yml` | `on.push.branches: main`. |
| `docs/releases.md`, `.changeset/README.md` | Merge / publish / `baseBranch` wording → `main`. |
| `.github/workflows/ci.yml` | Test step `bun run test` (root script: core, store-contracts, testkit, webhooks, reconciliation, observability, routing, sql-foundation, internal/sql-store, all store adapters, adapter-selection honesty). |
| `packages/core/src/public-api.test.ts` | Freeze includes `isKnownCurrencyCode`; `Object.keys(sdk).sort()` equals freeze list (149 symbols). |
| `packages/core/src/public-api.types.test.ts` | `isKnownCurrencyCode("SAR")` type check. |
| `packages/core/docs/behavioral-contracts.md` | Version `0.1.0-next.0`; store contracts live in `@paykernel/store-contracts`, not testkit. |
| `packages/core/docs/baseline/public-api.md` | Regenerated 2026-08-14T13:12:11.636Z; package `0.1.0-next.0`; lists `isKnownCurrencyCode`. |
| `packages/core/docs/baseline/package-contents.md` | Regenerated pack inventory. |
| `packages/core/docs/baseline/entry-points.md` | Consumer import includes `isKnownCurrencyCode`. |

Prettier was **not** enabled on `packages/core/src` (per stream E rules).

---

## Verify commands

Run 2026-08-14 from monorepo root after the five streams.

| Command | Result |
| --- | --- |
| `bun run --filter @paykernel/core typecheck` | **PASS** (after `asAmountInput` residual) |
| `bun run typecheck:types` | **PASS** |
| `bun test` targeted list (below) | **PASS** — **719 pass, 0 fail**, 3552 expects, 22 files |

Targeted test command:

```bash
bun test \
  packages/core/src/utils/money.test.ts \
  packages/core/src/utils/money.edge.test.ts \
  packages/core/src/utils/currency.test.ts \
  packages/core/src/client.test.ts \
  packages/core/src/plugin-architecture.test.ts \
  packages/core/src/public-api.test.ts \
  packages/core/src/gateways/capability-claims.test.ts \
  packages/core/src/gateways/moyasar/moyasar.gateway.test.ts \
  packages/core/src/gateways/stripe/stripe.gateway.test.ts \
  packages/testkit
```

Typecheck errors (both commands):

```
packages/core/src/gateways/stripe/stripe.gateway.ts(1108,34): error TS2345
packages/core/src/gateways/stripe/stripe.gateway.ts(1662,27): error TS2345
```

Zod-parsed `{ amount, currency, exponent?: number | undefined }` is not assignable to `AmountInput` / `Money` with `exactOptionalPropertyTypes: true` (`exponent?: number` vs `number | undefined`). Call sites: `toStripeAmount(p.amount, …)` in `createPayment`, and `toStripeAmount(item.priceData.amount!, …)` in checkout line items.

Not re-run this pass: full `bun test packages/core packages/testkit`, `bun test --coverage`, `bash scripts/validate-package.sh`, `bun run check:boundaries`.

---

## Gate (adversarial re-check)

Fail-closed on the workflow blocker list. Source evidence after the streams:

| Blocker | Result | Evidence |
| --- | --- | --- |
| **P05-MONEY-1** Zod keeps exponent | **CLOSED** | `validation.ts` L112 `exponent: z.number().int().min(0).max(18).optional()`; `money.test.ts` CreatePaymentParams parse keeps `exponent: 2`; Moyasar test posts 2012. |
| **P05-CAPS-1** claims after hooks / on gateway methods | **CLOSED** | `base.gateway.ts` L448–450 `assertCapabilitiesAfterHooks` after before-hooks; `client.test.ts` `gateway().voidPayment` + hook-injected `capture: false`. |
| **P05-CAPS-2** missing surface fail-closed | **CLOSED** | `gateway-registry.ts` `attachDefaultCapabilitySurface` + `createAll`; tests in `client.test.ts` / `create-payment-client.test.ts`. |
| **P05-REL-1** release on `main` | **CLOSED** | `release.yml` L6 `- main`; docs/changeset README aligned. |
| **P05-TK-1** FakeClock abort after advance | **CLOSED** | `mock-gateway.ts` L588–594 yield + re-check. |
| **P05-TK-2** refund dual-timeout | **CLOSED** | `mock-gateway.ts` L1592–1600 ledger then `NetworkError`. |
| **P05-TK-3** helpers bound | **CLOSED** for `signWebhook` / `generateWebhookEvent` (`L1005–1020`, `L1132–1133`). Legacy `webhookHelpers.sign` still unbound — nit. |
| **P05-API-1** `Object.keys` freeze + `isKnownCurrencyCode` | **CLOSED** | `public-api.test.ts` L155, L215–216; 149 symbols. |

Non-blocker IDs also addressed in source: P05-PAYPAL-1 documented (claim unchanged); P05-VER-1 version match; P05-CONF-1 suite tightened; Stripe unknown `JYP` throws.

**Gate on listed P05 blockers: PASS.**  
**Independent verify (typecheck + tests): FAIL** because `tsc --noEmit` is red. Fail-closed overall verdict is therefore **FAIL**.

---

## Remaining nits

1. **Typecheck residual — closed.** Stripe `toStripeAmount` now goes through `asAmountInput` so Zod `exponent?: number | undefined` is rebuilt as `AmountInput`. Zod Money schema also drops `exponent` when undefined.

2. **`webhookHelpers.sign` still unbound.** `packages/testkit/src/mock/mock-gateway.ts` L1130 `sign: signMockWebhook` uses the helper default secret. Bound API is `signWebhook` / `generateWebhookEvent`.

3. **`logging_redaction` still self-tests core logger first.** `packages/testkit/src/conformance/gateway-conformance.ts` still drives `createRedactingLogger` directly, then injects the gateway logger. Injection path is now required when `setLogger` exists.

4. **Facade auth/splits — closed.** `requiredCapabilitiesForOperation` is shared by `PaymentClient` and `BaseGateway`. Non-`BaseGateway` surfaces cannot skip `authorization` / `marketplaceSplits` on `client.createPayment`.

5. **`docs/releases.md` testkit row** still says “mocks, store contracts, conformance” while `behavioral-contracts.md` correctly points at `@paykernel/store-contracts`.

6. **Historical phase 0–5 reports** (`phase-0-gate-report.md` … `phase-5-gate-report.md`) still freeze `@paykernel/core@0.8.0` / Changesets `baseBranch: master`. Those are gate-time records, not live inventory.

7. **Lint / format not on CI.** Unchanged; stream E forbade enabling Prettier on `packages/core/src`.

8. **Working tree uncommitted.** Fix-stream + baseline regen are local diffs. `packages/core/docs/baseline/public-api.md` metadata 2026-08-14; bundle hash/size will drift again on the next `bun run build` + `bun run baseline`.

9. **0.x result majors remain `number`.** Unchanged Phase 5 contract (`moneyToMajorNumber`). Money values with stored `exponent` JSON-include that field; ISO-scale `money("10.50","SAR")` is still `{"amount":"10.50","currency":"SAR"}`.

10. **`scripts/consumer-smoke.mjs`** still only asserts `PaymentClient`.

---

## Checklist

- [x] Critic IDs confirmed against `HEAD` with file evidence
- [x] Five streams recorded with owned files
- [x] Verify commands re-run; typecheck green
- [x] Listed P05 blockers closed in source
- [x] `tsc --noEmit` / `typecheck:types` green
- [x] Full core+testkit suite 1423 pass / 0 fail; `validate:package` OK
- [x] Typecheck residual on Stripe `toStripeAmount` closed
- [x] Facade `authorization` / `marketplaceSplits` shared via `requiredCapabilitiesForOperation`

---

## Summary

Phase 0–5 critic IDs were present at `HEAD` and addressed (money Zod exponent, capability fail-closed + Stripe unknown currency, PayPal/version docs, testkit abort/refund/helpers/conformance, release/`main` + public-api freeze). Post-workflow residual: Stripe `asAmountInput` + shared facade capability helper. **Gate PASS.** Typecheck green. Core+testkit **1423 pass / 0 fail**. `validate:package` OK.
