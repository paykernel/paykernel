# Phase 21 adversarial gate report

**Date (UTC):** 2026-08-04  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Scope:** `@paykernel/routing` — portable select-only gateway routing + restricted post-attempt fallback eligibility  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> Package: [`packages/routing`](../)  
> Baseline twin: [`packages/core/docs/baseline/phase-21-gate-report.md`](../../core/docs/baseline/phase-21-gate-report.md)  
> Root pointer: [`docs/phase-21-gate-report.md`](../../../docs/phase-21-gate-report.md)  
> Docs: [overview](./overview.md) · [selection](./selection.md) · [routing-inputs](./routing-inputs.md) · [safe-fallback](./safe-fallback.md) · [telemetry](./telemetry.md) · [matching](./matching.md)

---

## Verdict summary

Phase 21 **Safe Routing Policies** is **complete and green**. Independent adversarial re-verification confirms:

| Area | Independent result |
| ---- | ------------------ |
| Package tests (Phase 0–21 safety net) | **1811 pass, 15 skip, 0 fail** (1826 tests / 145 files) |
| Routing package alone | **74 pass, 0 fail** (6 files) |
| typecheck (all workspace packages) | **OK** (exit 0) |
| typecheck:types (routing) | **OK** (exit 0) |
| check:boundaries | **OK** |
| check:runtime-portability | **OK** |
| validate:package | **OK** (pack + publint + attw + consumer smoke) |
| `@paykernel/routing` portable + core-only dep | **PASS** (`paymentsSdk.portable: true`; deps = `@paykernel/core` only) |
| Core does not depend on routing | **PASS** (no dep in package.json; no imports under `packages/core/src`) |
| Phase 22+ sneak-in | **absent** (no customers/disputes/new PSPs; docs list as non-goals) |
| Blocking issues | **0** |

Implementer summary claims (`ok=true`, failures `[]`, 1811 pass, typecheck/boundaries/portability/validate:package green, core boundary intact, docs+dist present) match independent re-runs.

---

## Acceptance criteria (roadmap Phase 21)

| ID | Criterion | Verdict | Evidence |
| -- | --------- | ------- | -------- |
| **A1** | Decisions are deterministic and testable | **PASS** | Pure `selectImpl` in `packages/routing/src/router.ts` — no I/O, no `Math.random` / `Date.now` / `crypto.random` in production sources. First-match rule order (`pickCandidate` returns `pool[0]` when no cost map; cost sort is stable by cost → gateway id → index). Tests: `router.test.ts` “A1 determinism + rule order” — identical inputs → identical `JSON.stringify` decisions; reordering rules changes gateway; cost tie-break deterministic (`adyen` wins equal cost via lexicographic id). Independent smoke: same input twice → equal decision. |
| **A2** | Unsafe fallback is structurally prevented or requires explicit expert override | **PASS** | `SAFE_STATES = {not_submitted, pre_submission_failure}` only (`fallback.ts`). `isSafeFallbackEligible` false for `timeout`, `connection_reset`, `indeterminate`, `provider_5xx_uncertain`, `submitted`. `evaluateFallback` allows unsafe only with `confirmUnsafeFallback: true` + non-empty trimmed `reason`; empty reason / bare `true` rejected (`isExpertUnsafeFallbackOverride`). `classifyFromOperationOutcome("indeterminate")` → `"indeterminate"` never pre-submit. Unknown classification defaults to `indeterminate` (fail-closed). Type tests (`fallback.types.test.ts`) reject `expertOverride: true` and incomplete override via `@ts-expect-error`. Runtime tests cover each deny case (`fallback.test.ts`). |
| **A3** | Selected provider remains visible in results and telemetry | **PASS** | `RoutingDecision.gateway: string` always set on successful select (`types.ts`, `buildDecision` / `selectFallback`). `decisionToTelemetryAttributes` emits `{ gateway, matched, usedFallback, reason, ruleIndex? }` only — no secrets/health/cost maps. Docs: `docs/telemetry.md`, `docs/overview.md` compose with `createPayment` + `OperationContext.gateway`. Tests: “A3 decision.gateway + telemetry”. |

---

## Roadmap 21.1–21.3 surface

| Item | Required | Evidence | Verdict |
| ---- | -------- | -------- | ------- |
| **Target API** | `createPaymentRouter` + `route` + `select` | Public exports in `src/index.ts`; golden sample in `router.test.ts` (SAR+mada→moyasar, USD→stripe, EUR→select-time fallback stripe). README + `docs/selection.md`. | **PASS** |
| **21.1 Routing inputs** | currency, country, paymentMethod, amount range, tenant/tenantConfig, capabilities, merchant preference, health, cost | `RoutingInput` / `RouteMatchCriteria` in `types.ts`; matchers in `match.ts`; money-safe ranges in `amount-range.ts` via core `toMinorUnits` (bigint). Tests: `router.test.ts` “21.1 inputs”, `match.test.ts`, `amount-range.test.ts`. | **PASS** |
| **21.2 Select ≠ execute** | Router does not pay | `PaymentRouter` exposes only `select` / `rules` / `fallback` / `healthThreshold`. No `createPayment`/`capture`/`fetch` in production sources. Test asserts select does not call fake `createPayment`. Docs: selection vs execution composition. | **PASS** |
| **21.3 Restrict fallbacks** | Select-time fallback ≠ post-attempt auto-switch | Separate APIs: `createPaymentRouter({ fallback })` vs `isSafeFallbackEligible` / `evaluateFallback` / `trySelectFallbackGateway`. Docs: `safe-fallback.md` table. Deny list + expert override as A2. | **PASS** |
| **Money-safe amounts** | No float compare | `amountInRange` uses `toMinorUnits` → bigint only. Fail-closed cross-currency / missing currency / invalid amounts. Tests: “compares decimal strings safely without float”, KWD 3-decimal. `Number()` appears only in `costScore` for **rank scores**, not money. | **PASS** |

---

## Package / monorepo constraints

| Constraint | Verdict | Evidence |
| ---------- | ------- | -------- |
| Package `@paykernel/routing` exists, portable | **PASS** | `packages/routing/package.json`: `paymentsSdk.portable: true`; single dep `@paykernel/core`. No banned `node:`/`bun:`/`cloudflare:` imports in production sources (rg). |
| Core does not depend on routing | **PASS** | Core deps = `{ zod }` only; rg under `packages/core/src` + package.json clean. Boundaries: `checkCoreDependencies` rejects core→routing. |
| Routing → core only | **PASS** | Live `check:boundaries` OK; unit matrix “allows routing → core only” / rejects testkit/webhooks/recon/observability/adapters/redis/sql-store. |
| docs + dist present | **PASS** | `dist/index.js`, `dist/index.d.ts` + per-module `.d.ts`; docs: overview, selection, routing-inputs, safe-fallback, telemetry, matching. |
| Phase 0–20 safety net still green | **PASS** | Full listed suite: 1811 pass / 0 fail including core, testkit, webhooks, recon, observability, sql-store, all adapters. |
| No Phase 22+ sneak-in | **PASS** | No customer/dispute/hosted-checkout/new-PSP APIs in package. Overview non-goals explicitly defer Phase 22+. |

---

## Logical bug scan (adversarial)

| Bug class | Result |
| --------- | ------ |
| Auto-routing indeterminate | **Blocked** — `isSafeFallbackEligible("indeterminate") === false`; classify never maps indeterminate → safe; unknown → indeterminate |
| Float money | **Absent** — amount path is bigint via core `toMinorUnits` |
| Non-deterministic order | **Absent** — first-match or stable cost sort; no random/time |
| Expert override defaulted | **Absent** — optional; requires branded object + non-empty reason; type system rejects bare `true` |
| Router executing createPayment | **Absent** — select-only surface |
| Hidden gateway | **Absent** — `decision.gateway` always set on success; telemetry includes gateway |

---

## Independent command results

```text
bun test packages/core packages/testkit packages/webhooks packages/reconciliation \
  packages/observability packages/routing internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite \
  packages/store-turso packages/store-d1 packages/store-durable-objects
→ 1811 pass, 15 skip, 0 fail (1826 tests / 145 files)

bun test packages/routing
→ 74 pass, 0 fail

bun run typecheck
→ all workspace packages exit 0 (including @paykernel/routing)

bun run --filter @paykernel/routing typecheck:types
→ exit 0

bun run check:boundaries
→ workspace boundaries OK

bun run check:runtime-portability
→ runtime portability OK

bun run validate:package
→ package validation OK (typecheck, core tests, build, pack, publint, attw, consumer smoke)
```

---

## Non-blocking notes

1. **`validate:package`** scripts validate **core** pack/publint/attw/smoke by design; routing is covered by its own build/dist + monorepo typecheck/tests/boundaries rather than a separate pack gate.
2. **`check:runtime-portability`** statically scans **core** src/dist; routing portability is enforced via `paymentsSdk.portable: true` + workspace boundary portable-import rules and production-source rg (no banned imports found).
3. **`costScore`** uses `Number()` for **non-money** rank scores only (documented); money ranges never use float.

---

## Blocking issues

_None._

---

## Final verdict

**PASS** — Phase 21 acceptance criteria A1–A3, 21.1–21.3 surface, package boundaries, portability, money safety, and Phase 0–20 safety net are independently evidenced green with zero blockers.
