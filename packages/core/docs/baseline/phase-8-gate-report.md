# Phase 8 adversarial gate report

**Date (UTC):** 2026-08-03  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Implementer claims under review

| Claim | Independent result |
| --- | --- |
| typecheck (core + testkit) | **PASS** — `bun run typecheck` exit 0 |
| typecheck:types | **PASS** — `bun run typecheck:types` exit 0 |
| 1073 core+testkit tests | **PASS** — `bun test packages/core packages/testkit` → **1073 pass, 0 fail**, 4391 expects, 36 files |
| coverage 99.35% funcs / 98.48% lines | **PASS** — measured **99.35% funcs / 98.48% lines** (`bun test --coverage packages/core`; 988 pass) |
| build + dist | **PASS** — `bun run build` exit 0; `dist/index.js` + `dist/index.d.ts` + runtime `.d.ts` present |
| boundaries | **PASS** — `bun run check:boundaries` → workspace boundaries OK (empty `node:` allowlist for portable prod) |
| runtime portability | **PASS** — `bun run check:runtime-portability` exit 0; Deno smoke **SKIP** (binary not on PATH; static scan required) |
| validate:package (pack/publint/attw/Bun+Node consumer-smoke) | **PASS** — full `bash scripts/validate-package.sh` OK |
| PaymentRuntime / createPaymentRuntime exported + wired | **PASS** — see 8.1 / A1 |
| portable HMAC webhooks | **PASS** — see A2 |
| AbortSignal on ops + combine/strip tests | **PASS** — see 8.3 |
| docs/runtime.md + behavioral-contracts §7 | **PASS** — present and packed in tarball |
| Phase 5–7 suites still green | **PASS** — focused money/operation-result/payment-event/runtime suites **289 pass**; dual-write AC still green |
| verify failures `[]` / ok `true` | **Accepted** — independent re-run all green (not trusted alone) |
| No commit | **N/A to gate** — not verified as a git operation |

---

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test packages/core packages/testkit` | **1073 pass, 0 fail** (36 files, 4391 expects) |
| `bun test --coverage packages/core` | **988 pass**; **99.35% funcs / 98.48% lines** |
| Phase 5/6/7 + runtime focused | money + edge + provider-profiles + operation-result + acceptance + payment-event + runtime + gateway-runtime-injection → **289 pass, 0 fail** |
| testkit alone | **85 pass, 0 fail** |
| `bun run typecheck` | exit 0 (core + testkit) |
| `bun run typecheck:types` | exit 0 |
| `bun run build` | exit 0 (core + testkit; ESM + `.d.ts`) |
| `bun run check:boundaries` | exit 0 |
| `bun run check:runtime-portability` | exit 0 (src + dist clean; Deno SKIP) |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → portability → pack → publint → attw → Bun+Node consumer-smoke **OK** |
| Node dist import smoke | `createPaymentRuntime`, `hmacSha256Hex`, `combineAbortSignals`, `PaymentClient` from `packages/core/dist/index.js` OK |
| core → testkit dep | **none** — core `dependencies` = `{ zod }` only; no `@paykernel/testkit` under `packages/core/src` |

### Static / source audits

| Audit | Result |
| --- | --- |
| Production `node:` / `bun:` / `cloudflare:` imports | **none** in `packages/core/src` production `.ts` or `packages/core/dist/**/*.js` |
| bare `node:http` / `node:https` / `crypto` / `buffer` imports | **none** in production gateways or dist |
| Portable crypto | `crypto-portable.ts` pure SHA-256/512 + HMAC; used by Stripe (`hmacSha256Hex`) / Paymob (`hmacSha512Hex`) / Moyasar timing-safe compare |
| `PaymentRuntime` shape | `fetch` / `crypto` / `clock` / `randomUUID` in `payment-runtime.ts`; matches roadmap 8.1 |
| Wiring path | `createPaymentClient({ runtime })` → `PaymentClient.initFromPlugin` → `createDefaultGatewayContext` → factory `create(context)` → `paymentRuntimeFromContext` → gateway ctor → `this.fetch` |
| Legacy ctor | `PaymentClient` legacy config.runtime passed as 4th gateway arg (subclass maps to BaseGateway runtime) |
| AbortSignal | `OperationRequestOptions.signal`; base `executeWithHooks` strip→Zod→`withAbortSignal`; per-gateway `extractAbortSignal` + HTTP `combineAbortSignals` + timeout `clear()` in `finally` |
| Public exports | `dist/index.d.ts` / `index.js` export `createPaymentRuntime`, merge helpers, pure crypto, abort helpers, types |
| Docs | `packages/core/docs/runtime.md`, `behavioral-contracts.md` §7; packed in npm tarball |
| Engines | core + monorepo `node: ">=18"`, `bun: ">=1.0.0"` |
| CI matrix (practical) | `.github/workflows/ci.yml`: Bun 1.2.18 + Node 20; boundaries, typecheck, test, coverage, build, portability, pack, publint, attw, consumer-smoke |

---

## Acceptance criteria (roadmap Phase 8)

### A1) core imports successfully in supported runtimes — **PASS**

| Evidence | Detail |
| --- | --- |
| Consumer smoke | `scripts/consumer-smoke.mjs` against packed tarball: **Bun + Node** import of published entry; asserts `PaymentClient`, `createPaymentClient`, `createPaymentRuntime`, pure crypto, Stripe `verifyWebhook`, injected context fetch |
| Dist import | Independent Node ESM import of `packages/core/dist/index.js` succeeds |
| Portability scan | Production src + dist: zero banned builtins (`check-runtime-portability`) |
| Engines | `node >= 18`, `bun >= 1.0.0` declared |
| Exports | Single ESM entry `exports["."]` → `dist/index.js` + types; `createPaymentRuntime` / `createPaymentClient` from package root |
| Deno / Workers | Static zero-`node:` dist gate is the required Workers/Deno substitute; Deno binary smoke SKIP-tolerant (documented in runtime.md) |

### A2) webhook verification works across runtimes — **PASS**

| Evidence | Detail |
| --- | --- |
| Stripe | Pure `hmacSha256Hex` + `timingSafeEqualHex`; clock-injectable skew; unit + consumer-smoke |
| Paymob | Pure `hmacSha512Hex` + timing-safe hex compare |
| Moyasar | Portable timing-safe secret_token compare (no node:crypto) |
| Vectors | `crypto-portable.test.ts` NIST/RFC-style SHA + HMAC vectors; Stripe signed_payload form; Paymob concatenation |
| Production path | No `node:crypto` in production sources/dist; gateways import `../../runtime/crypto-portable` |
| Smoke | Bun + Node consumer-smoke: valid Stripe header accepted, wrong v1 rejected |

### A3) provider HTTP operations do not require Node globals — **PASS**

| Evidence | Detail |
| --- | --- |
| Injected fetch | All four gateways use `this.fetch` in HTTP layers (stripe/moyasar/paypal/paymob) |
| Factories | `paymentRuntimeFromContext(context)` into ctors; tests: factory + `createPaymentClient` + legacy ctor paths with **globalThis.fetch patched to throw** still hit mock only |
| No node:http/https | Grep clean on production src/dist |
| Defaults | Default runtime delegates to live `globalThis.fetch` (compat); override replaces call path |

---

## Tasks 8.1–8.5 deliverables

### 8.1 PaymentRuntime injection — **PASS**

- Interface: `PaymentRuntime` with `fetch`, `crypto: CryptoProvider`, `clock: Clock`, `randomUUID()`.
- `createPaymentRuntime(partial?)`, `mergePaymentRuntime`, `paymentRuntimeFromContext`.
- `GatewayContext extends PaymentRuntime` + hooks/logger/uuid/telemetry.
- `createPaymentClient({ runtime?: Partial<PaymentRuntime> })` and legacy `PaymentClientConfig.runtime`.
- Built-in factories forward context runtime into gateways (subclass ctor: `(config, hooks, logger?, runtime?)` → `super(..., CAPABILITIES, runtime)`).

### 8.2 Prefer Web APIs / portable crypto; zero production `node:` imports — **PASS**

- Web: `fetch`, `TextEncoder`, `AbortController`/`AbortSignal`, optional Web Crypto on `CryptoProvider`.
- Pure sync HMAC/SHA for webhook verify (Workers-friendly, no async subtle required).
- Boundaries + portability scanners: empty production `node:` allowlist; dist banned.

### 8.3 AbortSignal on every network operation + timeout combine — **PASS**

- Shared `OperationRequestOptions.signal` on create/capture/refund/void/get (+ checkout session type intersection).
- `BaseGateway.executeWithHooks`: strip before Zod, reattach after (and after before-hooks re-validate).
- All four providers combine caller signal with timeout via `combineAbortSignals` / `createTimeoutSignal`; map caller abort → `PaymentAbortedError`, timeout → `NetworkError`.
- Timer cleanup: `clear()` in `finally` on stripe/moyasar/paypal/paymob HTTP helpers.
- Tests: pre-aborted, mid-flight abort, timeout, Zod survival strip/reattach (stripe/moyasar + `abort.test.ts`).

### 8.4 Runtime test matrix (practical CI + docs) — **PASS** (practical scope)

| Required | Evidence |
| --- | --- |
| Node + Bun consumer smoke | validate-package + CI |
| Portability scan | CI + validate-package |
| Unit tests (abort/crypto/runtime injection) | 1073 suite green |
| Docs matrix | `runtime.md` § “Runtime matrix (what CI runs vs aspirational)” + engines table |
| CI pins | Bun 1.2.18 + Node 20 |

**Documented aspirational (not blocking for this gate):** multi-version Node 18+all LTS / Bun min+latest matrix; workerd functional smoke; Deno import only when binary present. Roadmap 8.4 full matrix is satisfied by **practical** CI + explicit docs (same bar as implementer verify summary).

### 8.5 Published exports portable — **PASS**

- `dist/index.js` free of `node:` imports.
- publint + attw (ESM node16/bundler green; CJS ignored by policy).
- Pack contents include `dist`, `docs` (incl. `runtime.md`), README, LICENSE.
- Consumer smoke installs tarball and exercises published entry only.

---

## Logical anti-pattern audit (must not pass if present)

| Anti-pattern | Result |
| --- | --- |
| signal stripped by Zod and never reattached | **Not found.** `stripAbortSignal` → validate → `withAbortSignal`; stripe/moyasar tests “survives Zod validation”; HTTP sees `AbortSignal`. |
| factories ignore `context.fetch` | **Not found.** `paymentRuntimeFromContext` + injection tests with global fetch throwing. |
| `verifyWebhook` requires `node:crypto` | **Not found.** Pure portable HMAC path; production import scan clean. |
| `Buffer` required via `node:buffer` import | **Not found.** No production import. Optional `Buffer.isBuffer` feature-detect for Node raw-body shapes only; Workers use string/`Uint8Array`. |
| timeout timer leaks | **Not found.** `clear()` in `finally` on all four HTTP helpers; fallback path supports `unref` + explicit clear tests. |
| Phase 7 dual-write broken | **Not found.** AC suite + client dual-write tests still green (289 focused + full 1073). |
| core → testkit dependency | **Not found.** |

### Non-blocking observations (not acceptance failures)

1. **Deno smoke SKIP** on this host (`deno` binary not installed). Static `node:` scan is the required gate; runtime.md documents SKIP-tolerant Deno import.
2. **Multi-version / workerd functional matrix** remains aspirational unchecked boxes in `runtime.md` status checklist — not required for A1–A3 or practical 8.4.
3. **File-level coverage** on a few modules (`crypto-portable` rare TextEncoder/rotr fallbacks ~94.59% lines; `payment-event` / `validation` residual defensive branches) sits below package aggregate; package totals still **99.35% / 98.48%** with exit 0.
4. **`Buffer.isBuffer` feature detection** remains in payload parse paths (PayPal/payment-event) for Node interop — portable (no import) but not pure `Uint8Array`-only docs language everywhere; accept as non-blocking.
5. **CI does not run testkit** in `.github/workflows/ci.yml` (`bun test packages/core` only). Local monorepo gate and this review ran core+testkit; recommend CI include testkit as a follow-up (non-blocking for Phase 8 AC).

---

## Phase 0–7 safety net

| Area | Result |
| --- | --- |
| Phase 5 money | money + edge + provider-profiles green (in focused 289) |
| Phase 6 operation-result | unit + acceptance green |
| Phase 7 payment-event / dual-write | unit + AC green; client safety-net tests green |
| Boundaries / no core→testkit | green |
| Package validation | full validate:package green |

---

## Verdict

**PASS** — All Phase 8 acceptance criteria (A1–A3) and tasks 8.1–8.5 (practical 8.4) have independent command/source evidence. No blocking defects found in the logical anti-pattern audit. Non-blocking notes recorded for aspirational multi-runtime matrix expansion and CI testkit inclusion.

**Blocking:** none  
**Non-blocking:** 5 observations above  
)
