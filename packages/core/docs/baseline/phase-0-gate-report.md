# Phase 0 adversarial gate report

> **Historical gate record (2026-08-02).** Export counts and test totals below freeze the tree *at gate time* and are **not** a live inventory. For current public surface, regenerate and read [`public-api.md`](./public-api.md) / [`package-contents.md`](./package-contents.md) via `bun run baseline`. Later phases (plugin API, monorepo packages, etc.) expanded the package after this gate.

**Date (UTC):** 2026-08-02  
**Package:** `@paykernel/core@0.8.0`  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test` | **560 pass, 0 fail** (11 files, 1335 expects) |
| `bun run typecheck` | exit 0 (`tsc --noEmit`) |
| `bun test --coverage` | 560 pass; **99.52% funcs / 98.79% lines** (thresholds 0.85 / 0.90) |
| `bash scripts/validate-package.sh` | typecheck → test → build → pack → publint → attw → consumer smoke **OK** |
| `tsc -p tsconfig.type-tests.json --noEmit` | exit 0 |

## Acceptance criteria

### A1) Existing tests pass without behavior changes — **PASS**

- Evidence: fresh `bun test` → `560 pass / 0 fail`.
- No test suite failures; gate did not require behavior changes to pass.

### A2) Public API baseline exists and matches `src/index.ts` — **PASS**

- Artifact: [`docs/baseline/public-api.md`](./public-api.md) (non-trivial; generated metadata 2026-08-02).
- Cross-check: parsed exports from `src/index.ts` vs baseline tables:
  - Runtime value exports: **33 / 33**, missing `[]`, extra `[]`
  - Type-only exports: **65 / 65**, missing `[]`, extra `[]`
- Supporting: `src/public-api.test.ts` (runtime surface), `src/public-api.types.test.ts` (type-level), `scripts/generate-api-baseline.ts`.

### A3) CI validates the packed package — **PASS**

- Workflow: [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml)
- Steps present and ordered after build:
  - Typecheck, Test, Test with coverage, Build, Verify dist
  - **Pack dry-run** (`bun run pack:check`)
  - **Publint** (`bun run publint`)
  - **Are the types wrong** (`bun run attw`)
  - **Consumer smoke (packed tarball)** (`npm pack` + `scripts/consumer-smoke.mjs`)
- Local full path also green via `scripts/validate-package.sh`.

### A4) Current provider behavior documented — **PASS**

- Artifact: [`docs/behavioral-contracts.md`](../behavioral-contracts.md) (~343 lines), covers required topics:
  1. Retry / safe-to-retry matrix  
  2. IDs for capture / void / refund per provider  
  3. Webhooks requiring raw bodies  
  4. Terminal vs non-terminal `PaymentStatus`  
  5. After-hooks cannot roll back provider effects  
  6. Indeterminate outcomes  
  7. Runtime assumptions  

#### ID-per-provider code cross-check (spot audit)

| Claim (docs) | Code evidence | Outcome |
| --- | --- | --- |
| **Paymob:** numeric transaction ID; reject Intention `pi_...` | `assertPaymobTransactionId` in `src/gateways/paymob/paymob.gateway.ts` (`/^\d+$/`, explicit `pi_` error) | Matches |
| **Stripe:** money mutations require PaymentIntent `pi_...` | `STRIPE_PAYMENT_INTENT_ID_PATTERN` + `stripePaymentIntentPathId` in `src/gateways/stripe/stripe.gateway.ts` (rejects non-`pi_` including `cs_`/`sub_`) | Matches |
| **PayPal:** capture order vs authorization; refund capture ID; void authorization | Paths `/v2/checkout/orders/.../capture`, `/v2/payments/authorizations/...`, `/v2/payments/captures/.../refund` + error text in `paypal.gateway.ts` | Matches |
| **Moyasar:** payment UUID for capture/refund/void | `MoyasarGatewayPaymentIdSchema = z.string().uuid(...)` in `src/types/validation.ts`; tests reject non-UUID before network | Matches |

`PaymentStatus` union in contracts matches `src/types/payment.types.ts`.

## Phase 0 tasks 0.1–0.4 deliverables

| Task | Deliverable | Status |
| --- | --- | --- |
| **0.1** Public API | `docs/baseline/public-api.md`, `package-contents.md`, `entry-points.md`; generators; `public-api.test.ts` + `public-api.types.test.ts`; bundle size/hash recorded | **PASS** |
| **0.2** Coverage | `bunfig.toml` thresholds `lines=0.90`, `functions=0.85`; `docs/baseline/coverage-policy.md`; CI `test:coverage` | **PASS** (measured well above floor) |
| **0.3** Package validation | `scripts/validate-package.sh`, `consumer-smoke.mjs`, publint/attw scripts, CI pack path | **PASS** (end-to-end OK) |
| **0.4** Behavioral contracts | `docs/behavioral-contracts.md` with all seven contract areas | **PASS** |

## Checklist (machine-readable outcomes)

- `A1: PASS bun test 560 pass / 0 fail`
- `A2: PASS public-api.md exports match src/index.ts (33 value + 65 type, zero delta)`
- `A3: PASS ci.yml has pack + publint + attw + consumer smoke; validate-package.sh OK`
- `A4: PASS behavioral-contracts.md covers retry/IDs/raw webhooks/statuses/after-hooks/indeterminate/runtimes; ID claims match gateway code`
- `0.1: PASS type-level + runtime public API tests and baseline API/package artifacts`
- `0.2: PASS coverage policy + bunfig thresholds; coverage run green above floors`
- `0.3: PASS validate:package path (typecheck/test/build/pack/publint/attw/smoke)`
- `0.4: PASS behavioral-contracts.md non-trivial and code-aligned on sampled ID claims`

## Blocking issues

_None._

## Non-blocking observations

1. **HTTP-date `Retry-After` tests present** in `src/utils/utils.test.ts` (`parseRetryAfterSeconds`); aggregate coverage remains well above floors.

## Post-gate remediation

- **Type-level tests are now on the CI path.** Root `tsconfig.json` still excludes `**/*.test.ts` from the main project (correct for emit), but:
  - `package.json` scripts: `typecheck:types` / `typecheck:all`
  - CI step: **Typecheck public API type tests** (`bun run typecheck:types`)
  - `scripts/validate-package.sh` runs `typecheck:types` after main typecheck

## Summary

Phase 0 acceptance criteria A1–A4 and tasks 0.1–0.4 are **independently verified green**. Export inventory matches source. CI and local `validate-package` exercise packed-tarball validation and type-level public API tests. Behavioral contracts are present and sample-checked against gateway ID validation. No blocking findings.
