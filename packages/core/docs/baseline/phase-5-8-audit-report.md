# Phase 5–8 Deep Audit Report

| Field | Value |
| --- | --- |
| **Date (UTC)** | 2026-08-03 |
| **Monorepo** | `paykernel` (`/home/shahin/Documents/projects/personal/packages/paykernel`) |
| **Packages in scope** | `@paykernel/core` (core), `@paykernel/testkit` (testkit) |
| **Reviewer stance** | **Fail-closed** (missing evidence = blocking; intentional 0.x design is not a defect) |
| **Audits synthesized** | 3 independent audit passes (Phases 5–7 deep) + Phase 8 gate/live re-check + **Phase 8 independent re-audit (dedicated pass)** + cross-cut consolidation |
| **Overall verdict** | **PASS** |

**Pass rule:** `pass = true` only if live checks are green **and** confirmed blocking findings are empty.

This report is the consolidated deep-audit record for Phases 5–8 (Safe Money Model, Operation Results, Webhook Events, Runtime Portability). It synthesizes phase gate reports, multi-pass audit confirmations, dismissed false positives, and a live re-check of typecheck/tests/boundaries/runtime-portability and Phase 5–8 invariants. Production source was **not** modified for this report.

---

## Live checks (commands)

**Status:** `live_ok = true` — all critical gates green; `failures: []`.

| Command | Result |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun run typecheck:types` | exit 0 |
| `bun test packages/core packages/testkit` | **1113 pass, 0 fail**, 39 files |
| `bun run check:boundaries` | exit 0 (`boundaries_ok: true`) |
| `bun run check:runtime-portability` | exit 0 (`portability_ok: true`) |

### Static / grep audits (live)

| Check | Result |
| --- | --- |
| Float money conversion (`amount * 100` in production conversion) | **No conversion hits** — only a doc-only comment in `money.ts` that conversion NEVER uses float multiply |
| Banned runtime imports (`node:` / `bun:` / `cloudflare:`) in core/testkit production `src` | **None** |
| TODO / FIXME stubs in Phase 5–8 areas | **No actionable stubs** — remaining “not implemented” strings are capability/docs prose (e.g. hosted checkout product claim; optional async verify fallback) |
| Key Phase 5–8 files present | `money.ts`, `operation-result.ts`, `domain-status.ts`, `provider-refs.ts`, `payment-event.ts`, `webhook-event-map.ts`, `payment-runtime.ts`, `crypto-portable.ts`, `abort.ts` + docs `money.md` / `operation-results.md` / `webhook-events.md` / `runtime.md` |
| Stable event / outcome shape | `STABLE_PAYMENT_EVENT_TYPES` count = **14**; `PaymentOperationResult` **5** arms; `MinorAmount = bigint`; `PaymentRuntime` has `fetch` / `crypto` / `clock` / `randomUUID` |
| Dual-write on built-ins | `applyOutcomeToGatewayResult` + `attachPaymentEvent` present on **stripe / moyasar / paypal / paymob** |
| Fulfillment gate | `isPaidOutcome` requires `outcome === 'succeeded'` **and** paid-like status (`paid` \| `approved` only; **authorized excluded**) |
| Remaining `.success` hits | Docs guidance, Zod parse (`parsed.success`), provider field mapping (e.g. Paymob `data.success`), webhook-event-map flags — **not** “success means paid” fulfillment advice in core production checklist |

### Live summary

Phase 5–8 live-check **PASS**. Typecheck, typecheck:types, core+testkit suite (1113/0/39), workspace boundaries, and runtime-portability all exit 0. Bigint money path, payment applyOutcome dual-write on all four gateways, PaymentEvent attach on all four + client safety-net, `isPaidOutcome` paid-like gate, PaymentRuntime injection, portable hash, empty production `node:` allowlist, and no core↔testkit cycle are intact under re-check.

---

## Phase 5 roadmap compliance (tasks + acceptance)

**Status:** **PASS** (shared bigint money model; no silent float conversion; dual `number | Money` inputs for create/capture/refund).

### Tasks 5.1–5.4

| Task | Result | Evidence |
| --- | --- | --- |
| **5.1** Money primitives | **PASS** | `Money`, `DecimalString`, `MinorAmount` (`bigint`), `money()`, `toMinorUnits` / `fromMinorUnits`, `formatMoney`, `normalizeAmountInput`, `minorAmountToNumber`, `moneyToMajorNumber`, `MoneyAmountError`; currency exponents + overrides; root re-exports + public-api freeze |
| **5.2** Strict precision validation | **PASS** | Default `rounding: "reject"`; excess digits → `MoneyAmountError` `excess_precision`; explicit half_up / half_even / floor / ceil / trunc; gateways pass `rounding: "reject"` |
| **5.3** Migrate amount fields (0.x) | **PASS** | `AmountInput = number \| Money` on create/capture/refund; Zod dual-accept schemas; number path stringifies then same rules (`0.1+0.2` rejects); result majors remain `number` until 1.0 |
| **5.4** Currency edge cases | **PASS** | 0/2/3-decimal currencies; large `> MAX_SAFE` bigint + `minorAmountToNumber` throws; overrides (OMR); negatives; JSON plain-object Money; Stripe/PayPal/Paymob provider profiles; gateway Money create paths |

### Acceptance A1–A3

| ID | Criterion | Result |
| --- | --- | --- |
| **A1** | No financial calc relies on binary floating point | **PASS** — string/bigint scale only (`10n ** BigInt(exponent)`); no `Math.round` / `amount * 100` production conversion; number path rejects float noise |
| **A2** | JSON serialization straightforward | **PASS** — frozen `{ amount: string, currency }`; no bigint on public `Money`; `JSON.stringify(money("10.50","SAR"))` plain object |
| **A3** | Every gateway uses shared conversion primitives | **PASS** — Stripe / Moyasar / PayPal / Paymob + testkit mock import shared helpers |

### Honest gaps / non-blocking (Phase 5)

- Roadmap 5.3 1.0 goal (Money on mutations/results, exact minor exposure on results) is **deferred**; 0.x dual-accepts `number|Money` inputs and major-unit `number` result fields.
- Provider exponent deviations stay gateway-local (Stripe ISK/UGX/MGA, PayPal HUF/JPY/TWD scale, Paymob merchant overrides) — ISO table not collapsed.
- Zod amount schemas are shape-only; deep scale/sign validation lives in money helpers at the provider boundary (intentional layering).
- `formatMoney` / `validateMoney` are public consumer helpers without in-repo gateway callers (documented intentional).

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

## Phase 6 roadmap compliance

**Status:** **PASS** with intentional 0.x refund dual-write sparsity (non-blocking).

### Tasks 6.1–6.4

| Task | Result | Evidence |
| --- | --- | --- |
| **6.1** Common payment input isolation | **PASS** | `CommonPaymentInput` only `amount` / `orderId?` / `description?` / `metadata?`; provider-typed extensions exist; compile-time forbidden key intersection → `never` |
| **6.2** Operation result model | **PASS** | 5-arm `PaymentOperationResult` (`succeeded` \| `requires_action` \| `declined` \| `failed` \| `indeterminate` with `reconciliationRequired: true` literal); helpers + success dual-write table; all 4 gateways `applyOutcomeToGatewayResult`; parallel refund map helpers |
| **6.3** Domain status unions | **PASS** | `PaymentDomainStatus` + auth/capture/refund/setup/dispute/transfer/payout unions; `PAID_LIKE_PAYMENT_STATUSES = ['paid','approved']`; `isPaidLikePaymentStatus` excludes `authorized` |
| **6.4** Provider references | **PASS** | `ProviderReferences` + `buildProviderReferences`; `applyOutcomeToGatewayResult` builds references when omitted; gateway tests assert ids/native status |

### Acceptance A1–A3

| ID | Criterion | Result |
| --- | --- | --- |
| **A1** | Fulfillment gate is not “API success” | **PASS** — `isPaidOutcome` = succeeded + paid-like only; authorized/requires_action/pending never paid; after-hook freeze restores identity fields (cannot forge paid from `requires_action`) |
| **A2** | Indeterminate forces reconciliation | **PASS** — type literal `reconciliationRequired: true`; apply/map always set it; `successFromOutcome('indeterminate') === false` |
| **A3** | Common contract isolated from provider keys | **PASS** — `CommonPaymentInput` keys locked; provider mega-interface retained on `CreatePaymentParams` by design |

### Honest gaps / non-blocking (Phase 6)

- Built-in `refundPayment` paths return `success`/`status`/ids **without** dual-written `outcome` (type allows optional `outcome`; callers use `mapGatewayRefundToOperationResult` / `inferRefundOperationOutcome`). Testkit may set refund `outcome` for some arms → mock vs prod shape skew.
- `CommonPaymentInput.amount` is `AmountInput` (not Money-only roadmap sketch).
- `CreatePaymentParams` remains 0.x mega-interface with optional provider keys (prefer typed `*CreatePaymentParams`).
- Transport failures may throw `NetworkError` rather than always return `indeterminate` (post-submit ambiguity uses indeterminate + reconciliation).
- `isPaidOutcome` treats partial capture/refund as not paid (intentional; partial settlement needs status-aware handling).

---

## Phase 7 roadmap compliance

**Status:** **PASS** (14 stable names + unmapped escape hatch; dual-write + secret-free envelope).

### Tasks 7.1–7.5

| Task | Result | Evidence |
| --- | --- | --- |
| **7.1** Stable payment event types | **PASS** | Exactly **14** roadmap names in `STABLE_PAYMENT_EVENT_TYPES`; `provider.unmapped` escape hatch arm; length locked in tests |
| **7.2** Provider event metadata | **PASS** | `ProviderEventMetadata` on every arm (`gateway`, `eventId`, `eventType` native, times, optional request/api/livemode); dual-write never rewrites `WebhookEvent.type` |
| **7.3** Persisted envelope sanitization | **PASS** | `PersistedPaymentEventEnvelope` `{ schemaVersion:'1', event, payloadHash, storedAt }`; strip raw/clientSecret; `assertNoSecretsInEnvelope`; redacted hash stability |
| **7.4** Opt-in encrypted raw retention | **PASS** | `RawWebhookPayloadCodec` + `encryptRawWebhookPayload` → ciphertext record; envelope builder never embeds raw/ciphertext by default |
| **7.5** Schema versioning rules | **PASS** | `PAYMENT_EVENT_SCHEMA_VERSION = '1'` on every arm; `webhook-events.md` compatibility rules |

### Acceptance A1–A3

| ID | Criterion | Result |
| --- | --- | --- |
| **A1** | Discriminated `PaymentEvent` dual-write | **PASS** — union on `type` + `schemaVersion:'1'`; attach on all 4 gateways; client `handleWebhook` safety-net when `event.event` missing; exhaustive switch locked |
| **A2** | Provider metadata present | **PASS** — every arm carries `provider`; mapped `pe.type !== pe.provider.eventType` for native names |
| **A3** | Envelope is secret-free + hash-stable | **PASS** — strip + assert + portable `hashWebhookPayload` (redact → stable stringify → `sha256Hex`); AC locks 64-hex stability across secret-value changes after redaction |

### Honest gaps / non-blocking (Phase 7)

- 0.x dual-write: `WebhookEvent.type` stays provider-native free-form; stable names live on `event.event` / stable type until 1.0.
- `handleWebhook` still returns `WebhookEvent` (additive dual-write), not PaymentEvent-only.
- Stripe invoice/subscription/subscription_schedule and PayPal `CAPTURE.REVERSED` intentionally map to `provider.unmapped`.
- Encrypted raw retention is app-supplied codec only (no KMS/default encryptor in core).
- Object path redacts before encrypt; string/`Buffer`/`Uint8Array` plaintext is passed to app codec without further redaction (documented app-owned crypto).
- Webhook-derived amount snapshots remain major-unit `number` (outside Phase 7 contract).

---

## Phase 8 roadmap compliance

**Status:** **PASS** (practical 8.4 matrix; aspirational multi-runtime expansion non-blocking).  
**Note:** Independent re-audit completed 2026-08-03 (dedicated pass) — **PASS** overall for A1–A3 and tasks 8.1–8.3/8.5; task **8.4 PARTIAL** (practical CI + static/portable gates meet acceptance; full multi-runtime roadmap matrix remains aspirational). See [Phase 8 independent re-audit (dedicated pass)](#phase-8-independent-re-audit-dedicated-pass). Prior reconstruction from phase-8 gate report + live portability remains consistent with that pass (runtime wired on plugin **and** legacy paths; empty production `node:` allowlist).

### Tasks 8.1–8.5

| Task | Result | Evidence |
| --- | --- | --- |
| **8.1** Inject runtime dependencies | **PASS** | `PaymentRuntime` = `fetch` / `crypto` / `clock` / `randomUUID`; `createPaymentRuntime` / `mergePaymentRuntime` / `paymentRuntimeFromContext`; `GatewayContext extends PaymentRuntime`; **both** `createPaymentClient({ runtime })` (plugin → factories) **and** legacy `PaymentClientConfig.runtime` (ctor 4th arg) |
| **8.2** Prefer Web APIs / portable crypto | **PASS** | Pure sync SHA/HMAC in `crypto-portable.ts` (Stripe SHA-256, Paymob SHA-512, Moyasar timing-safe compare); production src+dist zero banned builtins; empty `node:` allowlist |
| **8.3** AbortSignal on network ops | **PASS** | `OperationRequestOptions.signal` on create/capture/refund/void/get; base strip→Zod→reattach; all four gateways `combineAbortSignals` + timeout `clear()` in `finally`; abort → `PaymentAbortedError`, timeout → `NetworkError` |
| **8.4** Runtime test matrix | **PARTIAL** (practical **PASS** for A1–A3) | Bun + Node consumer-smoke; CI Bun 1.2.18 + Node 20; portability scan; unit suites for abort/crypto/runtime injection. Full roadmap multi-LTS / Bun min+latest / Deno functional / workerd smoke **not** implemented — documented aspirational in `runtime.md`, not AC failures |
| **8.5** Published exports portable | **PASS** | Single ESM entry; `dist` free of `node:`; publint/attw policy; packed docs include `runtime.md` |

### Acceptance A1–A3

| ID | Criterion | Result |
| --- | --- | --- |
| **A1** | Core imports in supported runtimes | **PASS** — consumer-smoke Bun+Node against packed tarball; dist import smoke; engines `node >= 18`, `bun >= 1.0.0`; static zero-`node:` gate substitutes for Workers/Deno when binary absent |
| **A2** | Webhook verification across runtimes | **PASS** — pure HMAC paths; no `node:crypto` production import; NIST/RFC-style vectors; smoke accepts valid Stripe header / rejects wrong v1 |
| **A3** | Provider HTTP does not require Node globals | **PASS** — all four gateways use injected `this.fetch`; injection tests with `globalThis.fetch` patched to throw still hit mocks only |

### Phase 8 anti-pattern scan (gate)

| Anti-pattern | Status |
| --- | --- |
| Signal stripped by Zod and never reattached | **Not found** |
| Factories ignore `context.fetch` | **Not found** |
| `verifyWebhook` requires `node:crypto` | **Not found** |
| `Buffer` required via `node:buffer` import | **Not found** (optional feature-detect only) |
| Timeout timer leaks | **Not found** (`clear()` in `finally`) |
| Core → testkit dependency | **Not found** |

### Non-blocking observations (Phase 8)

- Deno smoke SKIP when `deno` binary absent (static scan remains required).
- Multi-version / workerd functional matrix aspirational in `runtime.md`.
- ~~CI currently runs `bun test packages/core` only (testkit green locally; include in CI recommended).~~ **Remediated (STREAM C):** CI Test step now runs `bun test packages/core packages/testkit packages/webhooks` (matches root `bun run test` monorepo intent).
- `runtime.md` examples emphasize `createPaymentClient({ runtime })`; legacy `PaymentClientConfig.runtime` is implemented and gate-covered but less prominent.
- `Buffer.isBuffer` feature-detect (no `node:buffer` import); `resolveDefaultCrypto` Math.random last-resort when Web Crypto absent; `bun build --target node` does not put `node:` into published `dist`.

---

## Phase 8 independent re-audit (dedicated pass)

| Field | Value |
| --- | --- |
| **Date (UTC)** | 2026-08-03 |
| **Why this pass exists** | Prior multi-phase agent network did not include a dedicated Phase 8 deep-audit agent; Phase 8 compliance in this report was initially reconstructed from the phase-8 gate report + live portability only. This pass is an independent, fail-closed re-audit of Runtime Portability (tasks 8.1–8.5, A1–A3) with source + live command evidence. |
| **Production source modified** | **No** (report-only) |
| **live_ok** | **true** |
| **confirmed_blocking** | `[]` |
| **Phase 8 verdict** | **PASS** |

### Live commands re-run

| Command | Result |
| --- | --- |
| `bun run typecheck` | exit 0 (`typecheck_ok: true`) |
| `bun run check:runtime-portability` | exit 0 (`portability_ok: true`; Deno import smoke **SKIP** when `deno` not on PATH) |
| `bun test packages/core/src/runtime packages/core/src/gateways/gateway-runtime-injection.test.ts scripts/check-runtime-portability.test.ts` | **84 pass, 0 fail**, 5 files (`runtime_tests_ok: true`) |

**Live summary:** Phase 8 live-check **PASS**. Production core has zero banned runtime imports (`node:` / `bun:` / `cloudflare:` under `packages/core/src`, non-test). `PaymentRuntime` + `createPaymentRuntime` exported. All four gateways use injected `this.fetch` with `combineAbortSignals` / timeout `clear()` in `finally`. Stripe/Paymob/Moyasar webhooks use portable HMAC/timing-safe helpers. `createPaymentClient` and legacy `PaymentClientConfig.runtime` wired. CI runs `check:runtime-portability` and `scripts/consumer-smoke.mjs`.

#### Grep / static hits (dedicated pass)

| Tag | Finding |
| --- | --- |
| A | No production hits for `from 'node:'` / `bun:` / `cloudflare:` under `packages/core/src` (glob `!**/*.test.ts`) |
| B | `PaymentRuntime` interface + `createPaymentRuntime` in `payment-runtime.ts` (`fetch`, `crypto`, `clock`, `randomUUID`); exported from `runtime/index.ts` and `packages/core/src/index.ts` |
| C | `base.gateway.ts` `this.fetch = this.runtime.fetch`; all four gateways call `this.fetch` only (stripe / paymob / moyasar / paypal) |
| D | Stripe `hmacSha256Hex` + `timingSafeEqualHex`; Paymob `hmacSha512Hex` + timing-safe; Moyasar `timingSafeEqualBytes` (portable) |
| E | stripe/paymob/moyasar/paypal HTTP paths use `combineAbortSignals` + `createTimeoutSignal` + `clear()` in `finally` |
| F | `createPaymentClient` wires `options.runtime`; legacy `PaymentClientConfig.runtime` in config types + client ctor |
| G | CI: `check:runtime-portability` + `scripts/consumer-smoke.mjs` after build |

### Tasks 8.1–8.5 (dedicated pass)

| Task | Status | Evidence |
| --- | --- | --- |
| **8.1** Inject runtime dependencies | **PASS** | `PaymentRuntime` in `packages/core/src/runtime/payment-runtime.ts` (`fetch`, `crypto: CryptoProvider`, `clock: Clock`, `randomUUID`) matches roadmap. `createPaymentRuntime` / `mergePaymentRuntime` / `paymentRuntimeFromContext` exported from `runtime/index.ts` and `packages/core/src/index.ts`. `GatewayContext` extends `PaymentRuntime`; `createDefaultGatewayContext` merges nested runtime. Factories (`stripeGateway` / `moyasarGateway` / `paypalGateway` / `paymobGateway`) pass `paymentRuntimeFromContext(context)` as 4th ctor arg. `create-payment-client.ts` + `client.ts` `initFromPlugin` `options.runtime` → `createDefaultGatewayContext`; legacy `PaymentClientConfig.runtime` (`config.types.ts`) passed to gateway ctors. Live: gateway-runtime-injection **14/0** including `createPaymentClient` + legacy `runtime.fetch` paths. |
| **8.2** Prefer Web APIs / portable crypto | **PASS** | `crypto-portable.ts` pure SHA-256/512 + HMAC + timing-safe equal + TextEncoder/btoa (no `node:crypto`/`buffer`). `crypto-provider.ts` resolves `globalThis.crypto` / `getRandomValues`. `abort.ts` uses `AbortController` / `AbortSignal.any` polyfill. Production grep of `packages/core/src` (non-test): zero `node:` / `bun:` / `cloudflare:` imports; `packages/core/dist/**/*.js` zero `node:`. `scripts/check-runtime-portability.ts` empty allowlist + banned bare builtins; live CLI exit 0 src+dist clean. `hashWebhookPayload` uses `sha256Hex`. Stripe/Paymob/Moyasar `verifyWebhook` use portable helpers. |
| **8.3** AbortSignal on network ops | **PASS** | `OperationRequestOptions.signal` on Create/Capture/Refund/Void/GetPaymentParams; `CreateCheckoutSessionParams.signal`. `BaseGateway.executeWithHooks`: extract → strip → Zod → `withAbortSignal` (and again after before-hooks). All four HTTP layers: `createTimeoutSignal` + `combineAbortSignals` + `mapHttpAbortError`; `clear()` in `finally` — stripe `stripeRequest`, moyasar `request()`, paypal `performFetch`, paymob `fetchPaymob`. Per-op `extractAbortSignal` at call sites. Tests: `abort.test.ts`; stripe pre-abort / mid-flight / survives Zod. Live runtime suite green. |
| **8.4** Runtime test matrix | **PARTIAL** | **Practical matrix present:** `.github/workflows/ci.yml` Bun 1.2.18 + Node 20; steps `check:boundaries`, typecheck, `bun test packages/core`, build, `check:runtime-portability`, pack/publint/attw, `consumer-smoke.mjs` (Bun+Node tarball). engines `node>=18` `bun>=1.0.0`. `docs/runtime.md` documents required vs aspirational matrix. Unit coverage for runtime/crypto/abort/injection. Live: typecheck 0, portability 0 (Deno SKIP), injection+runtime tests green. **Gap:** full roadmap 8.4 list not executed — no Node 18 + all LTS matrix, no Bun min+latest matrix, Deno import only SKIP-tolerant when binary absent, no Cloudflare Workers/workerd functional smoke (static dist `node:` scan substitutes). Status checklist in `runtime.md` leaves multi-version and workerd unchecked. Practical bar meets A1–A3. |
| **8.5** Published exports portable | **PASS** | `packages/core/package.json` `exports["."]` → `dist/index.js` + types only (ESM). `dist/index.js` free of `node:` imports (scan + grep); re-exports `createPaymentRuntime`, `hmacSha256Hex`, `combineAbortSignals`, etc. `check-runtime-portability` scans `dist/**/*.js`. `consumer-smoke.mjs` installs packed tarball and asserts public exports + portable Stripe `verifyWebhook` + injected fetch under Bun and Node. `files`: dist, docs, README, LICENSE. CI runs portability + consumer-smoke after build. |

### Acceptance A1–A3 (dedicated pass)

| ID | Status | Evidence | Honest gap |
| --- | --- | --- | --- |
| **A1** Core imports in supported runtimes | **PASS** | `consumer-smoke.mjs`: Bun+Node import of published `@paykernel/core` asserts `PaymentClient`, `createPaymentClient`, `createPaymentRuntime`, `createDefaultGatewayContext`, pure crypto. `dist/index.js` exports present. `check-runtime-portability` production src+dist clean (Workers/Deno static gate). engines `node>=18` `bun>=1.0.0`. Live typecheck exit 0; portability OK. | Deno functional import SKIP without deno binary; CF Workers only static zero-`node:` gate (no workerd runtime smoke). |
| **A2** Webhook verification across runtimes | **PASS** | Stripe `verifyWebhook`: `hmacSha256Hex` + `timingSafeEqualHex` + clock skew (`stripe.gateway.ts`). Paymob: `hmacSha512Hex` + `safeCompareHex`. Moyasar: `timingSafeEqualBytes` on `secret_token`. `crypto-portable.test.ts` NIST/RFC vectors; gateway-runtime-injection portable webhook cases 4/4; consumer-smoke valid/invalid Stripe signature. No `node:crypto` on production verify path. PayPal sync `verifyWebhook` throws by design; `verifyWebhookAsync` uses injected `this.fetch` (portable HTTP). | — |
| **A3** Provider HTTP does not require Node globals | **PASS** | All four gateways call `this.fetch` only in HTTP helpers (stripe `stripeRequest`, moyasar `request`, paypal `performFetch`, paymob `fetchPaymob`) — not bare global `fetch`. `BaseGateway` assigns `this.fetch = this.runtime.fetch` from `createPaymentRuntime`. gateway-runtime-injection: `globalThis.fetch` patched to throw; ctor runtime, factory context, `createPaymentClient` runtime, legacy `PaymentClient` runtime all hit mock only (**14/0**). No production `node:http`/`https`. | — |

### Confirmed blocking (dedicated pass)

_None._

`confirmed_blocking: []`

No blocking correctness, security, or contract defects: zero production `node:` imports, injected fetch wired end-to-end, portable webhook HMAC, AbortSignal strip/reattach, timeout clear-in-finally on all four gateways.

### Confirmed non-blocking (dedicated pass)

Independently confirmed; do **not** fail Phase 8 A1–A3 or practical runtime portability.

1. **CI core-only tests** — CI workflow runs `bun test packages/core` only; does not run `packages/testkit` (or webhooks). Local monorepo `test` script is `bun test packages/core packages/testkit packages/webhooks`. Typecheck/build cover all packages but do not execute testkit unit tests. Incomplete CI matrix / quality gap, not a production portable-runtime blocker. Evidence: `.github/workflows/ci.yml` Test step `bun test packages/core`; root `package.json` `"test"` includes testkit+webhooks.

2. **`Buffer.isBuffer` feature-detect** — Remains in `payment-event.ts` and `paypal.gateway.ts` for Node raw-body interop **without** importing `node:buffer`. Grep for `node:buffer` under `packages/core/src`: no matches. Portable feature-detect only; not a required Node builtin dependency.

3. **`resolveDefaultCrypto` Math.random last-resort** — When Web Crypto absent, documented non-crypto-strong polyfill via `Math.random`. Webhooks (Stripe/Paymob HMAC, Moyasar timing-safe compare) use `crypto-portable` pure HMAC/SHA **independent** of `CryptoProvider`. Intentional portable limit, not an acceptance/blocker class. Covered by `gateway-registry.test.ts` polyfill case.

4. **`bun build --target node` vs published dist** — `packages/core/package.json` build uses `bun build ... --target node`, but published `dist/index.js` has zero `node:` import/require (only external `zod`). Dist mentions of `node:crypto` are JSDoc in `.d.ts` only. Bundler flag is not a blocking portability failure; portability CI fails if `node:` appears in `dist/**/*.js`.

5. **`runtime.md` aspirational checklist open** — Unchecked optional items: multi-version CI matrix; workerd functional smoke. Docs label them aspirational/SKIP-tolerant, not Phase 8 ACs. Aligns with 8.4 PARTIAL and CHANGELOG “not in this phase” scope.

### Honest gaps / missing tests (dedicated pass — non-blocking)

- Deno smoke **SKIP** when `deno` not on PATH (`scripts/check-runtime-portability.ts` `tryDenoImportSmoke`; documented in `runtime.md`).
- Full roadmap 8.4 matrix (all Node LTS, Bun min+latest, Deno, CF Workers functional) is aspirational; practical bar is Bun+Node CI + static portability + consumer-smoke.
- Cloudflare Workers support is static-export + unit-test based, not live workerd.
- Browsers with secret keys explicitly unsupported (`runtime.md`).
- No multi-version Node 18 / latest LTS or Bun min+latest CI jobs.
- No workerd/miniflare functional import/HTTP smoke.
- Deno import smoke pass branch not exercised on hosts without the binary.

### Dismissed (dedicated pass)

_None newly dismissed in this pass._

`dismissed: []`

(Prior consolidated report dismissals for dual plugin+legacy runtime wiring, Buffer feature-detect as import, and aspirational matrix-as-AC remain valid; this pass did not re-propose them as defects.)

### Dead code (dedicated pass)

`dead_code: []` — no abandoned Phase 8 production APIs identified.

### Logic bugs (dedicated pass)

`logic_bugs: []`

### Dedicated-pass summary

Phase 8 **PASS** overall for acceptance **A1–A3** and tasks **8.1–8.3 / 8.5** with independent source + command evidence. Task **8.4** is **PARTIAL**: practical CI matrix and static/portable gates meet A1–A3, but the full multi-runtime matrix listed in the roadmap is not implemented (documented aspirational). No blocking correctness/security/contract defects.

**pass contribution:** `live_ok = true` ∧ `confirmed_blocking = []` → Phase 8 dedicated pass **PASS**.

---

## Cross-cutting findings

### Coherence summary

Phase 5–8 surfaces are **coherent and live-check green**:

| Area | Cross-cut result |
| --- | --- |
| Money | Bigint conversion shared; no production float convert |
| Payment dual-write | `applyOutcomeToGatewayResult` on all four built-ins |
| Webhook dual-write | `attachPaymentEvent` on all four + client `handleWebhook` safety-net |
| Fulfillment | `isPaidOutcome` = succeeded + paid/approved only (not authorized, not bare `success`) |
| Runtime | `PaymentRuntime` on plugin **and** legacy paths |
| Portability | Empty production `node:` allowlist; portable `hashWebhookPayload` / HMAC |
| Boundaries | No core↔testkit/webhooks cycle; webhooks depends on core contracts |
| After-hook freeze | Money/identity keys block false-paid forges (`success` / `outcome` / `status` / references / reconciliation) |

### Export / freeze alignment

| Check | Result |
| --- | --- |
| Value freeze `public-api.test.ts` length | **143** matches index value re-exports for Phase 5–8 symbols (money, outcomes, events, runtime, crypto, abort) |
| Dist types | Present for money, operation-result, payment-event, runtime (`PaymentRuntime`); re-exported via `dist/index.d.ts` |
| Type-level freeze | **Incomplete** — many index type exports not exercised in `public-api.types.test.ts` (option bags, `MoneyFailureKind`, `GatewayRuntimeDeps`, `TimeoutSignalHandle`, codec/envelope option types, mapped/unmapped event types, etc.) |
| Missing Phase 5–8 **value** symbols | **None** between index and runtime freeze list |

### Doc drift (non-blocking)

| Drift | Notes |
| --- | --- |
| `roadmap.md` Phase 6 sketch | `amount: Money` and `failed.error: PaymentError` vs shipped `AmountInput` + `PaymentErrorLike` |
| `roadmap.md` CommonPaymentInput target | Money-only sketch vs 0.x dual-accept `AmountInput` (authoritative docs: `money.md` / `operation-results.md`) |
| `behavioral-contracts.md` critical rule short form | ~~Emphasizes `status === 'paid'` without always naming `approved`~~ **Remediated (STREAM C):** critical rule + terminal-ish table name **`paid` OR `approved`** (paid-like) and point to **`isPaidOutcome`** (`outcome === 'succeeded'` + `PAID_LIKE`; authorized excluded) |
| `runtime.md` examples | Center `createPaymentClient`; legacy `new PaymentClient({ runtime })` implemented but lightly documented |
| Money / operation-results / webhook-events API names | Largely match implementation (14 events, 5 payment outcome arms, portable hash) |
| Success vs paid | Core README production checklist correctly deprecates `success` for fulfillment — no conflicting “success means paid” claim found |
| `paypal.md` fulfillment examples | **Remediated (STREAM C):** capture/auth keep success for terminal API failure; fulfillment uses `isPaidOutcome`; void prefers status/outcome (success = API-ok); refund section reinforces status + map/infer over bare success / optional outcome dual-write |

### Regression risks (documented, not live defects)

| Risk | Mitigation / classification |
| --- | --- |
| Ledgering from `result.amount` major `number` without re-validation | Documented 0.x float-display risk; conversion itself is bigint |
| Apps switching only on refund `result.outcome` | Prefer `mapGatewayRefundToOperationResult` / status; production refunds omit optional dual-write |
| `payloadHash` algorithm/redaction change | Single core implementation; version skew of hash helpers would desync inbox conflict detection — intentional single path |
| Custom gateways skip `applyOutcome` | Still work via `inferOperationOutcome` |
| Custom gateways skip `attachPaymentEvent` | Mitigated on `client.handleWebhook`, not bare `parseWebhookEvent` (documented lower-level API) |
| Void with `forceOutcome: succeeded` + cancelled status | `isPaidOutcome` stays false; apps using only `outcome === 'succeeded'` without paid-like check could mis-fulfill (mitigated by `isPaidOutcome`) |

### Inconsistencies inventory (real vs dismissed)

| Item | Classification |
| --- | --- |
| Refund outcome dual-write incomplete on all four built-ins | **Confirmed non-blocking** (0.x parity gap) |
| Testkit refunds dual-write outcome; production does not | **Confirmed non-blocking** (mock vs prod shape skew) |
| Zod `MoneyAmountSchema` shape-only | **Dismissed** — intentional layered validation |
| `success` dual-write ≠ `isPaidOutcome` | **Dismissed** — intentional dual semantics |
| `CommonPaymentInput.amount` AmountInput vs roadmap Money-only | **Dismissed** as defect — docs drift / intentional 0.x |
| Runtime injection on plugin + legacy | **Dismissed** as defect — intentional dual support |
| Payment applyOutcome + attachPaymentEvent on all four | **Dismissed** as defect — gate PASS, no missing path |
| `isPaidOutcome` vs authorized | **Dismissed** — code/docs agree authorized is not paid-like |

---

## Confirmed blocking findings

_None._

`confirmed_blocking: []`

No money-safety, false-paid, secret-envelope, portability, or Phase 5–8 acceptance-breaking defects were independently confirmed under fail-closed review.

---

## Confirmed non-blocking findings

These items are **real** and independently confirmed, but do **not** fail Phase 5–8 acceptance, money safety, fulfillment contracts, or live gates.

### 1. Refund outcome dual-write incomplete on production gateways

- **Kind:** Cross-gateway / dual-write parity gap (0.x)
- **Detail:** `GatewayRefundResult.outcome` is typed (`RefundOperationOutcome?`). Payment paths dual-write via `applyOutcomeToGatewayResult`. All four built-in `refundPayment` implementations (stripe ~1126–1132, moyasar ~839–848, paypal ~675–681, paymob ~933–945) return only `success` / `status` / ids **without** `outcome`. No `applyOutcomeToGatewayRefund*` helper exists. Operation-result helpers (`successFromRefundOutcome` / `inferRefundOperationOutcome` / `mapGatewayRefundToOperationResult`) and AC7 map completed refunds with success+status only → `succeeded`.
- **Impact:** Omission does **not** forge refund-settled/paid. Status remains authoritative. Apps that switch **only** on optional `result.outcome` without the map helper or status may mis-handle production refunds — outside the documented preferred path.
- **Action hint:** Optional 0.x polish: add apply helper + dual-write on built-ins for symmetry with payments; keep infer path as fallback.

### 2. Testkit refunds dual-write outcome; production gateways do not

- **Kind:** Mock vs prod shape skew
- **Detail:** Testkit `mock-gateway` refund paths set `outcome: 'indeterminate'` (+ `reconciliationRequired`) and `outcome: 'failed'`; `defaultRefundResult` in testkit outcomes also sets `outcome`. Production four gateways omit `outcome`.
- **Impact:** Not blocking — `outcome` is optional; map/infer derive arms from status/success. No false-paid or wrong-fulfillment path.
- **Action hint:** Align mock default closer to production (omit outcome) **or** dual-write production to match mock; document skew if kept.

### Additional non-blocking inventory (cross-cut)

| Item | Notes |
| --- | --- |
| Incomplete type-export freeze coverage | Many Phase 5–8 types not in `public-api.types.test.ts` |
| After-hook `MONEY_IDENTITY_KEYS` omit `nextAction` | Cannot forge paid; can still alter action/raw presentation (`rawResponse` additive) |
| `encryptRawWebhookPayload` string/Buffer/Uint8Array path | No redaction of non-object plaintext (documented opt-in / app-owned) |
| 0.x Payment / GatewayPaymentResult majors remain `number` | Float display / re-input risk if fed back without re-validation |
| Gateway-local `toMinorUnits` / `fromMinorUnits` wrappers | Thin shared-helper adapters; optional DRY |
| Runtime docs emphasize plugin path | Legacy `PaymentClientConfig.runtime` less prominent in primary guide |
| Phase 8 aspirational matrix + CI testkit | Deno/workerd multi-version expansion remains aspirational; **CI testkit/webhooks inclusion remediated (STREAM C)** — Test step runs core + testkit + webhooks |

---

## Dismissed false positives (brief)

These were proposed as defects but independently dismissed as intentional design, documented public API, process notes, or mislabeled “inconsistencies.”

| Finding | Why dismissed |
| --- | --- |
| META: phase audit agent slot 3 failed | Process note only; no concrete product defect; prior baseline passes + live green |
| `validateMoney` no production importers | Intentional documented consumer helper |
| `formatMoney` no production importers | Intentional display helper |
| `encryptRawWebhookPayload` usage limited to tests/docs | Intentional Phase 7 public opt-in API |
| `assertNoSecretsInEnvelope` primarily test/guard | Intentional test/debug helper; runtime strip via envelope builder |
| `isPaymentSucceededEvent` / failed / refund.completed / provider.unmapped guards | Intentional public consumer type-guards |
| Gateway-local toMinorUnits/fromMinorUnits “dead” | Live production adapters (not abandoned) |
| Zod MoneyAmountSchema shape-only | Intentional 0.x layered validation |
| success dual-write ≠ isPaidOutcome | Intentional dual semantics (API-ok vs fulfillment) |
| CommonPaymentInput AmountInput vs roadmap Money-only | Intentional 0.x dual-accept; roadmap sketch stale |
| Runtime on plugin + legacy (hypothesis legacy missing) | Intentional dual wiring — not a bug |
| Payment applyOutcome + attachPaymentEvent on all four | Confirms completeness; not a defect |
| isPaidOutcome matches docs (authorized not paid) | Code/docs agree; no false-paid |
| Payment.amount major number float-risk | Intentional 0.x result shape until 1.0 |
| Refunds without dual-written outcome as regression | Intentional Phase 6 design; map helper is preferred path |
| payloadHash depends on Phase 8 sha256Hex | Intentional single-implementation design |
| Custom gateways skip applyOutcome / attach only on handleWebhook | Intentional 0.x fallback + safety-net scope |

---

## Dead code / cleanup opportunities

Cross-cut inventory of intentional public helpers and soft cleanup. Prefer **public-API review** before removing anything re-exported.

| Item | Classification | Action hint |
| --- | --- | --- |
| `validateMoney` | Public export; no in-repo production callers beyond money + tests | Keep (consumer helper) unless deprecation planned |
| `formatMoney` | Public display helper; same | Keep |
| `encryptRawWebhookPayload` | Public opt-in; production callers only via re-export | Keep |
| `assertNoSecretsInEnvelope` | Test/debug sanitizer | Keep |
| `isPaymentSucceededEvent` / `isPaymentFailedEvent` / `isRefundCompletedEvent` / `isProviderUnmappedEvent` | Public type-guards | Keep |
| Gateway-local toMinorUnits/fromMinorUnits | Live thin wrappers over shared helpers | Optional DRY |
| Abort helpers | Live production; index re-binds for tree-shake | Keep |
| No abandoned Phase 7 codec | Documented opt-in encrypt path only | N/A |
| No unused private abort APIs | Live | N/A |
| Type freeze gaps | Hygiene | Expand `public-api.types.test.ts` for Phase 5–8 option/types surface |
| Refund dual-write helpers | Missing apply helper | Optional parity with payments |

---

## Verdict

| Dimension | Result |
| --- | --- |
| Live checks | **PASS** (typecheck, typecheck:types, 1113 tests, boundaries, runtime-portability) |
| Confirmed blocking | **None** |
| Phase 5 | **PASS** (A1–A3, tasks 5.1–5.4; bigint money; no float leftovers) |
| Phase 6 | **PASS** (A1–A3, tasks 6.1–6.4; isPaidOutcome + after-hook freeze; refund outcome dual-write sparse non-blocking) |
| Phase 7 | **PASS** (A1–A3, tasks 7.1–7.5; 14 stable events; secret-free envelope; dual-write + client safety-net) |
| Phase 8 | **PASS** (dedicated independent re-audit 2026-08-03: A1–A3 PASS; 8.1–8.3/8.5 PASS; **8.4 PARTIAL** practical matrix only; PaymentRuntime plugin+legacy; portable crypto/abort; empty `node:` allowlist; `confirmed_blocking: []`) |
| **Overall** | **PASS** |

### Summary

Phase 5–8 surfaces are coherent under a green live gate: bigint money conversion, payment `applyOutcome` dual-write on all four gateways, `PaymentEvent` attach on all four plus client safety-net, `isPaidOutcome` requiring succeeded + paid/approved (not authorized), `PaymentRuntime` on plugin and legacy paths, portable hash for envelopes, empty production `node:` allowlist, no core↔testkit/webhooks cycle, and after-hook freeze blocking false-paid forges. **No blocking defects.**

Phase 8 is no longer “reconstructed only”: a **dedicated independent re-audit** re-ran typecheck, runtime-portability, and 84 runtime/injection/portability tests (0 fail), confirmed A1–A3 and tasks 8.1–8.3/8.5, and recorded 8.4 as PARTIAL (aspirational multi-runtime matrix not implemented; practical bar meets acceptance).

Main non-blocking gaps: refund outcome dual-write parity (production omits optional `outcome`; testkit sometimes sets it), incomplete type-export freeze coverage, intentional public helpers without in-repo production callers, roadmap/0.x wording drift on Money-only targets, Phase 8 aspirational multi-runtime matrix / workerd smoke, Buffer feature-detect, Math.random crypto last-resort, and `bun build --target node` bundler flag vs clean dist.

**STREAM C remediation (docs + CI, 2026-08-03):** CI Test now includes `packages/testkit` and `packages/webhooks`; `paypal.md` fulfillment guidance uses `isPaidOutcome` (success retained only for terminal API failure); void example prefers status/outcome; refund docs reinforce map/infer + optional outcome dual-write; `behavioral-contracts.md` critical rule names paid-like **`paid` \| `approved`** and points to `isPaidOutcome`. Intentional 0.x Money-only-at-1.0 design docs left unchanged.

**pass = true** (live checks OK ∧ confirmed_blocking empty).

---

## Remediation (2026-08-03)

Post-audit fixes for confirmed non-blocking findings (and hygiene items) from streams A–D. **Original findings history above is preserved** — this section only records what was FIXED and where. Intentional skips (0.x major-unit `number` results, `Math.random` crypto last-resort, `Buffer.isBuffer` feature-detect, `bun build --target node` bundler flag, full Deno/workerd multi-runtime matrix, gateway-local money wrapper DRY) were **not** remediated.

### FIXED

| Finding (audit) | Status | Files |
| --- | --- | --- |
| Refund outcome dual-write incomplete on production gateways | **FIXED** | `packages/core/src/types/operation-result.ts` (`applyOutcomeToGatewayRefundResult` + `ApplyOutcomeGatewayRefundBase`); `packages/core/src/index.ts`; all four built-ins: `packages/core/src/gateways/stripe/stripe.gateway.ts`, `moyasar/moyasar.gateway.ts`, `paypal/paypal.gateway.ts`, `paymob/paymob.gateway.ts`; tests: `packages/core/src/types/operation-result.test.ts`, `packages/core/src/types/operation-results.acceptance.test.ts`; docs: `packages/core/docs/operation-results.md`, `packages/core/docs/baseline/public-api.md`, `packages/core/docs/baseline/entry-points.md`; freeze: `packages/core/src/public-api.test.ts` |
| Testkit refunds dual-write outcome; production gateways do not (shape skew) | **FIXED** | Production dual-write as above; testkit aligned via shared helper: `packages/testkit/src/mock/mock-gateway.ts`, `packages/testkit/src/mock/outcomes.ts` (`defaultRefundResult`) |
| After-hook `MONEY_IDENTITY_KEYS` omit `nextAction` | **FIXED** | `packages/core/src/gateways/base.gateway.ts` (`nextAction` frozen with money/identity keys); tests: `packages/core/src/client.test.ts` (forged / invented `nextAction` rejected; `rawResponse` still additive) |
| Incomplete type-export freeze coverage (Phase 5–8 types) | **FIXED** (hygiene expansion) | `packages/core/src/public-api.types.test.ts` — `MoneyFailureKind`, `Clock` / `CryptoProvider`, `PaymentRuntime` / `GatewayRuntimeDeps`, `ApplyOutcomeGatewayBase`, `RawWebhookPayloadCodec`, `StablePaymentEventType` negatives, `ProviderEventMetadata` / `PersistedPaymentEventEnvelope` keys, refund outcome closed union + map helpers |
| CI core-only tests | **FIXED** | `.github/workflows/ci.yml` — Test step runs `bun test packages/core packages/testkit packages/webhooks` |
| Doc drift: fulfillment short form / PayPal success vs paid | **FIXED** | `packages/core/docs/behavioral-contracts.md` (paid-like `paid` \| `approved`; prefer `isPaidOutcome`); `packages/core/docs/paypal.md` (capture/void/refund examples use `isPaidOutcome` / status; success only for terminal API failure) |
| `encryptRawWebhookPayload` string/Buffer/Uint8Array path (JSON string secrets not redacted) | **FIXED** (string JSON path) | `packages/core/src/types/payment-event.ts` — `prepareEncryptPlaintext`: JSON **string** that parses to object/array is redacted via `redactWebhookPayloadSecrets` then canonical-stringified before the app codec; non-JSON strings and `Uint8Array`/`Buffer` remain app-owned pass-through; test: `packages/core/src/types/payment-event.test.ts`; docs: `packages/core/docs/webhook-events.md` |

### Intentionally not fixed (still non-blocking / design)

| Item | Reason |
| --- | --- |
| 0.x major-unit `number` on Payment / GatewayPaymentResult | Deferred to 1.0 Money-on-results |
| `resolveDefaultCrypto` Math.random last-resort | Documented portable limit; webhooks use pure HMAC independent of CryptoProvider |
| `Buffer.isBuffer` feature-detect | No `node:buffer` import; Node raw-body interop only |
| `bun build --target node` vs clean dist | Dist remains free of `node:`; portability CI guards |
| Full Deno / workerd multi-runtime matrix | Aspirational Phase 8.4; practical Bun+Node + static gate remain |
| Gateway-local `toMinorUnits` / `fromMinorUnits` wrappers | Optional DRY; shared helpers already used |
| Binary redaction of `Uint8Array` / `Buffer` encrypt plaintext | App-owned crypto; no invented binary redaction |

---

*Report path: `packages/core/docs/baseline/phase-5-8-audit-report.md`*
