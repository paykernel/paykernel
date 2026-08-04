# Phase 3–5 Deep Audit Report

| Field | Value |
| --- | --- |
| **Date (UTC)** | 2026-08-03 |
| **Monorepo** | `paykernel` (`/home/shahin/Documents/projects/personal/packages/payments-sdk`) |
| **Packages in scope** | `@paykernel/core` (core), `@paykernel/testkit` (testkit) |
| **Reviewer stance** | **Fail-closed** (missing evidence = blocking; intentional 0.x design is not a defect) |
| **Audits synthesized** | 3 independent audit passes + live command re-check + cross-cut consolidation |
| **Overall verdict** | **PASS** |

**Pass rule:** `pass = true` only if live checks are green **and** confirmed blocking findings are empty.

This report is the consolidated deep-audit record for Phases 3–5. It synthesizes phase gate reports, multi-pass audit confirmations, dismissed false positives, and a live re-check of typecheck/tests/boundaries/money invariants. Production source was **not** modified for this report.

---

## Live checks (commands)

**Status:** `live_ok = true` — all critical gates green; `failures: []`.

| Command | Result |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun run typecheck:types` | exit 0 |
| `bun test packages/core packages/testkit` | **1113 pass, 0 fail**, 39 files |
| `bun run check:boundaries` | exit 0 |

### Static / grep audits (live)

| Check | Result |
| --- | --- |
| Float money conversion (`Math.round` / `amount * 100` / `amount * 10` in gateways + `money.ts`) | **No conversion hits** — only a comment in `money.ts` stating financial conversion NEVER uses float multiply |
| Core depends on `payments-testkit` | **No hits** in `packages/core/package.json` or `packages/core/src` |
| `TODO` / `FIXME` / `XXX` / stub `"not implemented"` in gateways, money, testkit | **No actionable stubs** — only documentation comments (e.g. hosted-checkout product not implemented as a claim; optional async verify fallback prose) |
| Phase 3–5 key files | `gateway-capabilities.ts`, `money.ts`, `testkit/src/index.ts` **exist**; capability + money docs live under `packages/core/docs/` (not repo-root `docs/`) |
| `GATEWAY_CAPABILITY_KEYS` | **15 keys** (stable ordered set) |
| Money surface | `MinorAmount = bigint`; `toMinorUnits` / `fromMinorUnits` / `minorAmountToNumber` bigint path; default reject precision |

### Live summary

Phase 3–5 live-check **PASS**. Full workspace typecheck, typecheck:types, core+testkit test suite (1113/0/39), and workspace boundaries all exit 0. No float `Math.round` amount conversion in gateways; money path is bigint/`toMinorUnits`. Core has no `payments-testkit` dependency. Capability and money docs are under `packages/core/docs/`. Only “not implemented” strings are documentation comments, not runtime stubs.

---

## Phase 3 roadmap compliance (tasks + acceptance)

**Status:** **PASS** (stable 15-key model; intentional 0.x client-gating limits documented as non-blocking elsewhere).

### Tasks 3.1–3.4

| Task | Result | Evidence |
| --- | --- | --- |
| **3.1** Stable capability keys | **PASS** | `GATEWAY_CAPABILITY_KEYS` length 15: `payments`, `immediateCapture`, `authorization`, `partialCapture`, `refunds`, `partialRefunds`, `voids`, `hostedCheckout`, `tokenization`, `customers`, `paymentMethods`, `marketplaceSplits`, `disputes`, `paymentLinks`, `providerRecurring` |
| **3.2** Capability queries (`supports`) | **PASS** | Claim-authoritative `supports()` + frozen `capabilities` on `BaseGateway` / built-ins; client access via `gateway(name)` |
| **3.3** Provider comparison docs from code | **PASS** | Generated `packages/core/docs/gateway-capabilities.md` + drift-guard test + `docs:capabilities` generator |
| **3.4** Validate adapter claims | **PASS** | Structural claim harness: factory ⇔ instance ⇔ builtin constants; claimed `true` ⇒ required method for mappable ops; frozen complete snapshots |

### Acceptance A1–A3

| ID | Criterion | Result |
| --- | --- | --- |
| **A1** | Consumers can inspect support before invocation | **PASS** — `supports` / frozen snapshot / public exports / dist parity |
| **A2** | Unsupported operations fail with capability metadata | **PASS** — `OperationNotSupportedError` with `capability` / `claimedSupport`; client gates payments / partials / refunds / voids |
| **A3** | Capability documentation generated from code | **PASS** — generator + checked-in matrix + drift test |

### Phase 3 notes (not blocking)

- Client enforcement is intentionally partial: gates `payments` / `partialCapture` / `refunds` / `partialRefunds` / `voids` only; does **not** gate `authorization`, `immediateCapture`, or `hostedCheckout` at the client facade.
- `hostedCheckout` is gateway-direct (`createCheckoutSession`); not a `PaymentClient` entrypoint.
- `CAPABILITY_OPERATION_MAP.authorization → capturePayment` is the completion-op mapping (complementary to create-path auth-hold prose), locked by JSDoc + tests.
- Pre-Phase-3 plain adapters without a capability surface retain legacy method duck-typing (`hasCapabilitySurface` no-op path).

---

## Phase 4 roadmap compliance

**Status:** **PASS** (tasks 4.1–4.5 + A1–A3; core free of testkit; offline-first builtins + mock golden path).

### Tasks 4.1–4.5

| Task | Result | Evidence |
| --- | --- | --- |
| **4.1** Gateway conformance suite | **PASS** | Full named case set (`amount_conversion`, status/decline/error maps, network/timeout, retry/idempotency, webhooks, partials, redaction, cancellation, indeterminate, plus structural helpers) |
| **4.2** Scriptable mock gateway | **PASS** | FIFO scripted outcomes, dual-timeout (`provider_ok_client_timeout`), never-false-paid timeouts, latency, webhooks (sign/duplicate/OOO), history, partials, indeterminate |
| **4.3** Storage conformance harness | **PASS** | Idempotency + webhook inbox + reconciliation suites: concurrency (isolate), fake-clock leases, crash reclaim, payload hash conflicts, cleanup, tx rollback |
| **4.4** Fixture safety utilities | **PASS** | `sanitizeFixture` / `assertFixtureSafe` / secret patterns; `FIXTURE_SCHEMA_VERSION = 1` |
| **4.5** Test-only in-memory store | **PASS** | Memory stores + fake clock + leases + `simulateCrash`; marked `NON_PRODUCTION` / `NON_DISTRIBUTED` |

### Acceptance A1–A3

| ID | Criterion | Result |
| --- | --- | --- |
| **A1** | Custom gateways/stores validated via shared suites | **PASS** — suite exports + README + public-api freeze + tests |
| **A2** | Complex payment behavior without real providers | **PASS** — mock scripting / dual-timeout / webhooks / history / partials / indeterminate |
| **A3** | Built-in gateways pass applicable conformance | **PASS** — stripe / moyasar / paypal / paymob applicable + structural `ok` offline |

### Phase 4 isolation

| Check | Result |
| --- | --- |
| Core → testkit dependency | **None** (package graph + boundaries + no `src` import) |
| Boundaries script knows `packages/*` | **OK** |
| Mock never hits live network for full suite | **OK** (offline-first; network cases skipped for real builtins) |

---

## Phase 5 roadmap compliance

**Status:** **PASS** (shared bigint money model; no silent float conversion; dual `number | Money` inputs for create/capture/refund).

### Tasks 5.1–5.4

| Task | Result | Evidence |
| --- | --- | --- |
| **5.1** Money primitives | **PASS** | `Money`, `DecimalString`, `MinorAmount` (`bigint`), exponents, `money()`, `toMinorUnits` / `fromMinorUnits`, formatting helpers |
| **5.2** Strict precision validation | **PASS** | Default `rounding: "reject"`; explicit half_up / half_even / floor / ceil / trunc |
| **5.3** Migrate amount fields (0.x) | **PASS** | `AmountInput = number \| Money` on create/capture/refund; migration docs in `docs/money.md`; results remain major-unit `number` until 1.0 |
| **5.4** Currency edge cases | **PASS** | 0/2/3-decimal, large values, overrides, negatives, JSON plain-object Money, no-float self-audit |

### Acceptance A1–A3

| ID | Criterion | Result |
| --- | --- | --- |
| **A1** | No financial calc relies on binary floating point | **PASS** — string/bigint scale only; gateways use shared helpers |
| **A2** | JSON serialization straightforward | **PASS** — `{ amount: string, currency: string }`; no bigint on public Money |
| **A3** | Every gateway uses shared conversion primitives | **PASS** — Stripe / Moyasar / PayPal / Paymob + testkit mock |

### Phase 5 anti-pattern scan

| Anti-pattern | Status |
| --- | --- |
| Silent rounding by default | **Absent** |
| Float leftover conversion in gateways | **Absent** |
| Unsafe `Number(bigint)` | **Guarded** (`minorAmountToNumber` range check) |
| Money with bigint fields | **Absent** |
| Broken Stripe three-decimal ÷10 rule | **Intact** |
| Ignored Paymob exponent overrides | **Intact** |

---

## Confirmed blocking findings

_None._

`confirmed_blocking: []`

No money-safety, contract, security, or Phase 3–5 acceptance-breaking defects were independently confirmed under fail-closed review.

---

## Confirmed non-blocking findings

These items are **real** and independently confirmed, but do **not** fail Phase 3–5 acceptance, money safety, or live gates.

### 1. Unused internal barrel: `packages/core/src/gateways/index.ts`

- **Kind:** Dead code / cleanup  
- **Detail:** Full barrel (BaseGateway, PaymentGateway, factories, StripeGateway, etc.). Root `packages/core/src/index.ts` re-exports via **direct** module paths (e.g. `./gateways/gateway.interface`, `./gateways/factories`) and never from `./gateways`. Grep found zero production imports of the barrel path; `package.json` exports only `"."`, so the barrel is not a public entry. `tsc` may still emit `dist/gateways/index.d.ts` because include is `src/**/*`.  
- **Impact:** Cleanup only — no money-safety, contract, or acceptance impact.
- **Remediation (FIXED 2026-08-03):** Root `packages/core/src/index.ts` gateway type/value re-exports now go through `./gateways` (the barrel). Barrel path comment updated to `packages/core`. Internal modules may still deep-import for locality; public surface is unchanged.

### 2. Testkit `stepDelayMs` public export is effectively surface-dead

- **Kind:** Public-surface dead export / freeze hygiene  
- **Detail:** `stepDelayMs` is a **live internal** helper used by mock-gateway `applyLatency`, but its package-root re-export has no monorepo consumers outside testkit internals, is undocumented, and is omitted from the public-api freeze list while siblings (`defaultPaymentResult`, etc.) are frozen.  
- **Impact:** Real as public-surface cleanup; not blocking for correctness, security, or money safety.
- **Remediation (FIXED 2026-08-03):** Dropped `stepDelayMs` from `packages/testkit/src/index.ts` root re-exports. Helper remains in `./mock/outcomes` and is imported by `mock-gateway.ts` `applyLatency` only. Public-api freeze asserts it is **not** on the package root; webhook helpers that remain exported are frozen.

### 3. Stripe checkout amount fields remain Zod-number-only (DX inconsistency)

- **Kind:** Incomplete dual-accept API surface  
- **Detail:** Create/capture/refund Zod dual-accepts `number | Money` via `PositiveAmountInputSchema`. `CreateCheckoutSessionParamsSchema.amount` and Stripe line-item `priceData.amount` remain `z.number()` only. Runtime helper `toStripeAmount(amount: AmountInput)` already normalizes Money via `normalizeAmountInput`, so conversion is ready but Zod rejects Money at the checkout boundary. `docs/money.md` scopes dual-accept to create/capture/refund/splits, not checkout — types/docs match number-only for that path.  
- **Impact:** Not a money-safety or wrong-charge bug (number path still uses safe bigint conversion; Money is rejected at schema, not mis-scaled). Incomplete dual-accept / DX inconsistency for 0.x, not a Phase 3–5 blocking correctness break.
- **Remediation (FIXED 2026-08-03):** Checkout dual-accept now matches create/capture/refund:
  - `CreateCheckoutSessionParamsSchema.amount` → `OptionalPositiveAmountInputSchema` (`number | Money`)
  - line-item `priceData.amount` → `NonnegativeAmountInputSchema` (`number | Money`, zero allowed)
  - currency match refine on both paths; `CreateCheckoutSessionParams.amount?: AmountInput` under `exactOptionalPropertyTypes`
  - Docs (`money.md`, `stripe.md`) + type/runtime tests cover Money session amount and `priceData.amount`

### 4. Mock gateway scripted `failed` leaves ledger as `paid` (testkit fidelity)

- **Kind:** Logic bug in NON-PRODUCTION mock ledger (app-test fidelity)  
- **Detail:** In `packages/testkit/src/mock/mock-gateway.ts`, `createPayment` resolves outcomes via `resolvePaymentOutcome(outcome, fallback, …)` where `fallback()` always calls `writeLedger(status, …)` with `paid` or `authorized` **before** the switch remaps status. For outcome `"failed"`, the returned result is `{ success: false, status: "failed" }`, but `ensurePaymentLedger` is skipped (`success` false / not `processing`), so the in-memory ledger still shows paid + full `capturedAmount`.  
- **Independent repro (pre-fix):**

  ```text
  mockGateway({ createPayment: [{ outcome: "failed" }] })
  → result: { success: false, status: "failed", gatewayId: "pay_mock_1" }
  → getPaymentState: { status: "paid", capturedAmount: 10.5, … }
  ```

- **Impact:** Does **not** break timeout≠paid (plain `timeout` / `network_error` throw without ledger write). Does **not** affect production gateways. **Does** mislead app tests that assert ledger/state after a scripted failure. Prefer: do not write paid ledger in `fallback()` for failure paths, or rewrite ledger to `failed` after the failed branch.  
- **Severity:** non_blocking for Phase 4 acceptance (A2 still holds for timeout/indeterminate safety); **should fix** for mock correctness.
- **Remediation (FIXED 2026-08-03):** `fallback()` no longer writes the ledger. After resolve:
  - success / `processing` → `ensurePaymentLedger`
  - non-success terminal (e.g. `failed`) → honest ledger (`status` from result, `capturedAmountMinor: 0`)
  - dual-timeout provider-side paid still goes only through `ledgerOnProviderSuccess`
  - Tests: failed ledger not paid; default/succeeded still paid; timeout still not paid

### 5. Gate-report doc drift: phantom `money-gateway-integration.test.ts`

- **Kind:** Documentation drift  
- **Detail:** `packages/core/docs/baseline/phase-5-gate-report.md` cites `money-gateway-integration.test.ts`, which does not exist. Equivalent coverage is split across `money.edge.test.ts`, `money.provider-profiles.test.ts`, and per-gateway Money path tests.  
- **Impact:** Report hygiene only.
- **Remediation (FIXED 2026-08-03):** `phase-5-gate-report.md` §5.4 now names the real suites: `money.edge.test.ts`, `money.provider-profiles.test.ts`, and per-gateway `*.gateway.test.ts` Money path tests.

---

## Dismissed false positives (brief)

These were proposed as defects but independently dismissed as intentional design, documented public API, or dual naming — **not** Phase 3–5 blockers.

| Finding | Why dismissed |
| --- | --- |
| `ScriptedStep` deprecated alias of `ScriptedPaymentOutcome` | Intentional `@deprecated` public alias; live mock uses `ScriptedPaymentOutcome` |
| `generateDuplicateWebhooks` / `generateOutOfOrderWebhooks` dual names | Intentional documented aliases of `withDuplicateWebhook` / `outOfOrderWebhooks`; both live |
| `validateMoney` “no production importers” | Intentional documented public consumer helper — not orphaned private dead code |
| `formatMoney` “no production importers” | Same: documented public SDK API; library utilities need not be used by internal modules |
| `isGatewayCapabilityKey` “no production importers” | Intentional public type guard; internal code uses typed keys |
| `BaseGateway.assertCapability` unused by first-party adapters | Intentional dual-layer design: client private gate is runtime; Base helper is for custom adapters/tests |
| `PaymentClient.assertCapability` no-op vs Base always-enforce | Intentional 0.x compat for pre-Phase-3 plain adapters (`hasCapabilitySurface`) |
| `authorization` / `immediateCapture` / `hostedCheckout` not client-enforced | Intentional Phase 3 design: inspect via `supports()`; client gates limited set only |
| `CAPABILITY_OPERATION_MAP.authorization → capturePayment` | Complementary intentional design (completion op vs create-hold prose); documented + tested |
| MockGateway default capabilities ≠ single builtin matrix | Expected for NON-PRODUCTION overridable double; after fill-ins matches PayPal/Paymob-style full ops w/ `hostedCheckout: false` |

---

## Dead code / cleanup opportunities

Cross-cut inventory (includes confirmed non-blocking items and soft-dead public helpers). Prefer **public-API review** before removing anything re-exported.

| Item | Classification | Action hint |
| --- | --- | --- |
| `packages/core/src/gateways/index.ts` | Internal barrel (was unused) | **FIXED 2026-08-03** — root re-exports via `./gateways` |
| `stepDelayMs` root export (testkit) | Live internal, unused public surface | **FIXED 2026-08-03** — dropped root re-export; internal via outcomes import |
| `validateMoney` / `formatMoney` / `isGatewayCapabilityKey` | Documented public helpers, no in-repo production callers | Keep unless public-API deprecation planned |
| `BaseGateway.assertCapability` | Protected helper unused by built-ins | Keep for custom adapters; already tested |
| Core `public-api.test` freeze length 150 | Inflates unique export count via **7 duplicated abort helper entries**; unique set **143** matches index/dist | **FIXED 2026-08-03** — freeze list de-duplicated; length **143** |
| Testkit public-api freeze omits webhook root exports | `generateWebhookEvent`, `signWebhook`, `DEFAULT_MOCK_WEBHOOK_SECRET`, `generateDuplicateWebhooks`, `generateOutOfOrderWebhooks` | **FIXED 2026-08-03** — freeze list includes remaining webhook helpers; `stepDelayMs` intentionally not root-exported |
| Gateway-local `toMinorUnits` / `fromMinorUnits` wrappers | Shared bigint path; duplicated adapter-local shape | Optional DRY (non-blocking) |
| Stale `// file: packages/payments/...` path headers | Pre-monorepo cosmetic | Partial cosmetic (gateways barrel header → `packages/core`) |

### Doc drift (non-blocking)

- **FIXED 2026-08-03:** Stripe checkout dual-accepts `number | Money` for session amount and line `priceData.amount`; `money.md` / `stripe.md` document the path.
- Remaining cosmetic: some source path comments (`packages/payments/...`) still predate monorepo `packages/core` layout.
- Otherwise `money.md`, generated `gateway-capabilities.md`, `plugin-architecture.md`, `custom-gateways.md`, and testkit README API names match actual exports.

### Export / dist alignment

- Dist types present and aligned for Phase 3–5: `GATEWAY_CAPABILITY_KEYS=15`, `CAPABILITY_OPERATION_MAP` 8 keys, money helpers on core `dist/index`.
- Phase 6+ packages depend correctly on core and do not reverse Phase 3–5 money/capability invariants (boundaries OK).

---

## Verdict

| Dimension | Result |
| --- | --- |
| Live checks | **PASS** (typecheck, typecheck:types, 1113 tests, boundaries) |
| Confirmed blocking | **None** |
| Phase 3 | **PASS** (A1–A3, tasks 3.1–3.4; intentional partial client gating documented) |
| Phase 4 | **PASS** (A1–A3, tasks 4.1–4.5; core isolated from testkit) |
| Phase 5 | **PASS** (A1–A3, tasks 5.1–5.4; bigint money path; no float leftovers) |
| **Overall** | **PASS** |

### Summary

Phase 3–5 surfaces are coherent under a green live gate: 15 capability keys, factory/instance/docs caps aligned, bigint money path in all gateways, core free of testkit, boundaries script knows `packages/*`. No blocking defects.

**Remediated (2026-08-03) — all confirmed non-blocking findings + freeze hygiene:**

1. Gateways barrel wired as root re-export surface (`./gateways`)
2. `stepDelayMs` dropped from testkit package root (still used internally via outcomes import)
3. Stripe checkout dual-accepts Money for session amount + line `priceData.amount`
4. Mock scripted `failed` writes honest failed ledger (not paid + full capture); timeout/dual-timeout/success regressions green
5. Phase-5 gate-report phantom `money-gateway-integration.test.ts` citation corrected
6. Core public-api freeze de-duplicated abort helpers (length 143)
7. Testkit public-api freeze includes remaining webhook helpers

Remaining intentional design (not defects): dual `assertCapability` / legacy-surface semantics; documented public helpers without in-repo production callers. Phase 6+ packages depend correctly on core and do not reverse Phase 3–5 money/capability invariants.

**pass = true** (live checks OK ∧ confirmed_blocking empty).

---

*Report path: `packages/core/docs/baseline/phase-3-5-audit-report.md`*
