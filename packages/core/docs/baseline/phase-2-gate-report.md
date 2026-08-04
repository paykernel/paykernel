# Phase 2 adversarial gate report

**Date (UTC):** 2026-08-02  
**Package:** `@paykernel/core@0.8.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test` / `bun test packages/core` | **622 pass, 0 fail** (15 files, 1697 expects) — **not** the implementer’s claimed 657 |
| `bun test --coverage packages/core` | 622 pass; **99.33% funcs / 98.87% lines**; global thresholds `functions=0.85` / `lines=0.90` met |
| `bun run typecheck` | exit 0 (`tsc --noEmit` via package filter) |
| `bun run typecheck:types` | exit 0 (`tsconfig.type-tests.json`) |
| `bun run build` | exit 0 — bundles `dist/index.js` + declaration emit |
| `bun run check:boundaries` | exit 0 — `workspace boundaries OK` |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke **OK** (exit 0) |
| Dist runtime surface (import `dist/index.js`) | `createPaymentClient`, `createGatewayRegistry`, `createDynamicGatewayRegistry`, `stripeGateway` / `moyasarGateway` / `paypalGateway` / `paymobGateway`, `createDefaultGatewayContext`, `PaymentClient` are functions; **no** `unregisterGateway` export |
| Ad-hoc third-party gateway script | `acme` adapter via `createPaymentClient({ gateways })` — createPayment + handleWebhook + hasGateway/configuredGateways + frozen registry OK |

### Coverage snapshot (measured)

```
All files | 99.33% Funcs | 98.87% Lines
```

Notable per-file (global floors only; see non-blocking):

| File | Funcs | Lines | Notes |
| --- | --- | --- | --- |
| `client.ts` | 100% | 100% | |
| `create-payment-client.ts` | 100% | 100% | |
| `gateways/gateway-context.ts` | 100% | 100% | crypto fallback + telemetry tests present |
| `gateways/gateway-registry.ts` | 94.44% | 96.58% | uncovered ~247–250 (`registerDynamic` body) |
| Aggregate | **99.33%** | **98.87%** | above `0.85` / `0.90` |

`gateway-context` crypto fallback / telemetry coverage is backed by tests in
`packages/core/src/gateways/gateway-registry.test.ts`
(`falls back to getRandomValues UUID when randomUUID is missing`,
`uses Math.random polyfill when Web Crypto is absent`,
`attaches optional telemetry when provided`).

### Pack / consumer (via `validate-package.sh`)

- Tarball `@paykernel/core@0.8.0`, **124 files**, no monorepo `src/` junk in pack inventory (dist + docs + README + LICENSE + package.json).
- publint: All good.
- attw: ESM/bundler green; CJS dynamic-import-only ignored per package script.
- consumer-smoke: Bun + Node import package root; asserts `PaymentClient` is a function.

### Working tree note

Phase 2 sources are largely **uncommitted** at gate time (new plugin modules + tests + docs; modified client/types/index). Gate evaluates code + green suite, not git cleanliness.

---

## Acceptance criteria

### A1) Third-party gateway participates without editing core — **PASS**

| Evidence | Detail |
| --- | --- |
| Runtime suite | `packages/core/src/plugin-architecture.test.ts` — custom `CustomGateway` + `GatewayAdapter<"custom", …>` through `createPaymentClient({ gateways })` |
| Payments | `createPayment` → normalized `GatewayPaymentResult` |
| Webhooks | `handleWebhook` verify/parse; invalid signature → `InvalidWebhookError`; `onWebhookVerified` runs |
| Hooks | `beforeCreatePayment` sees `ctx.gateway === "custom"` |
| Logging | custom gateway logs secret-shaped keys; sink never receives cleartext (`sk_live_…`, `api_key_value` redacted) |
| Error normalization | `CardDeclinedError` / `PaymentError` propagate from adapter |
| No core name hardcode | `"custom"` / `"acme"` appear only in **tests** / type fixtures — not production `src/` gateway unions or switch tables |
| Independent script | ad-hoc `acme` adapter exercised against package entry without core edits |

### A2) Gateway names inferred from the registry — **PASS**

| Evidence | Detail |
| --- | --- |
| Type tests | `public-api.types.test.ts`: `createPaymentClient({ gateways: { stripe, moyasar } })` → `gateway("stripe")` is `StripeGateway`; `@ts-expect-error` on unregistered names (`adyen`, `paypal`, `nope`) |
| Generics | `PaymentClient<TGateways>`; `InferGatewayMapFromAdapters`; `ImmutableGatewayRegistry<TMap>` |
| `BuiltInGatewayName` retained | `payment.types.ts` + type equality tests; open contracts use `GatewayId` / registry keys |
| Runtime | `gateway()`, `hasGateway`, `configuredGateways` reflect registered map only |

### A3) Built-in / legacy configuration remains usable — **PASS**

| Evidence | Detail |
| --- | --- |
| Legacy constructor | `new PaymentClient({ moyasar, … })` still works (`plugin-architecture.test.ts`, `create-payment-client.test.ts`, `public-api.test.ts`, existing `client.test.ts`) |
| Deprecation | Constructor + `PaymentClientConfig` JSDoc mark deprecated in favor of `createPaymentClient` |
| Built-in factories | `stripeGateway` / `moyasarGateway` / `paypalGateway` / `paymobGateway` close over credentials; fail-fast on empty secrets |
| Credential validation | Legacy path still fails fast (empty stripe/moyasar/paypal/paymob credentials) |

### A4) Duplicate registration, immutability, concurrent usage — **PASS**

| Evidence | Detail |
| --- | --- |
| Duplicate register | `register` throws `InvalidRequestError` / “already registered”; `replace` overwrites intentionally |
| Immutability | Built registry `Object.isFrozen`; no `register` on built registry; names/manifests frozen; further builder work does not mutate prior `build()` |
| Concurrent usage | `Promise.all` multi-gateway createPayment; same instance refs after ops; no public `registerGateway` / `unregisterGateway` on client |
| Client surface | Tests assert `unregisterGateway` / live `registerGateway` undefined on client |

---

## Phase 2 tasks 2.1–2.5 deliverables

| Task | Deliverable | Evidence | Status |
| --- | --- | --- | --- |
| **2.1** | `BuiltInGatewayName` retained | `payment.types.ts`; `GatewayName` alias; type tests | **PASS** |
| **2.1** | Extensibility-sensitive contracts open | `GatewayId` on hooks/webhooks; `PaymentGateway<TName>`; plugin client generics | **PASS** |
| **2.2** | `GatewayAdapter` | `gateways/gateway-adapter.ts` — `name`, `manifest`, `create(context)` | **PASS** |
| **2.2** | `GatewayManifest` | `gateways/gateway-manifest.ts` — no secrets | **PASS** |
| **2.2** | `GatewayContext` | hooks, logger, fetch, clock, crypto, uuid, optional telemetry + `createDefaultGatewayContext` | **PASS** |
| **2.3** | Type-safe registry | Builder map inference; typed `gateway()`; compile-time rejects | **PASS** |
| **2.3** | Dynamic less-typed API | `createDynamicGatewayRegistry`, `registerDynamic`, `getAdapterByName` | **PASS** |
| **2.4** | `createGatewayRegistry` builder | register / replace / build; freeze | **PASS** |
| **2.4** | No unregister on client | Runtime + tests | **PASS** |
| **2.4** | `hasGateway` / `configuredGateways` | Client methods + tests | **PASS** |
| **2.5** | Legacy config preserved | Deprecated constructor path + tests green | **PASS** |
| **2.5** | `createPaymentClient` preferred API | `create-payment-client.ts`; docs/README; `@deprecated` on legacy ctor | **PASS** |
| Safety net | Phase 0/1 style green suite | typecheck, typecheck:types, 622 tests, validate:package, boundaries | **PASS** |
| Logical safety | Credentials validation | Legacy `assertGatewayCredentials` + factory fail-fast | **PASS** |
| Logical safety | `defaultGateway` check | Throws if not in registry/map (plugin + legacy) | **PASS** |
| Logical safety | Frozen registry mid-flight | Immutable build; concurrent ops stable instances; no live unregister | **PASS** |
| Fail-closed config | Both/neither registry & gateways | `InvalidRequestError` | **PASS** |
| Map key hygiene | Key must equal `adapter.name` | Tests + `buildRegistryFromMap` | **PASS** |

### Public exports (root)

Runtime symbols added for Phase 2 (asserted in `public-api.test.ts`):  
`createPaymentClient`, `createGatewayRegistry`, `createDynamicGatewayRegistry`, `createDefaultGatewayContext`, `stripeGateway`, `moyasarGateway`, `paypalGateway`, `paymobGateway`.

Types exported: `GatewayAdapter`, `GatewayManifest`, `GatewayContext`, `ImmutableGatewayRegistry`, `GatewayRegistryBuilder`, `CreatePaymentClientOptions`, `BuiltInGatewayName`, `GatewayId`, etc. (`src/index.ts`).

---

## Implementer summary reconciliation

| Claim | Independent finding |
| --- | --- |
| typecheck / typecheck:types green | **Confirmed** |
| 657 tests | **False** — measured **622** pass / 0 fail |
| coverage 99.33% / 98.87% | **Confirmed** under `bun test --coverage packages/core` |
| per-file floors met | **Partial** — Bun enforces **global** thresholds only; measured files are healthy; no per-file threshold config in `bunfig.toml` |
| build + dist exports | **Confirmed** (bundle + `.d.ts` for plugin modules) |
| validate:package | **Confirmed** exit 0 |
| boundaries OK | **Confirmed** |
| plugin + legacy covered | **Confirmed** |
| no public unregisterGateway | **Confirmed** |
| gateway-context fallback tests | **Confirmed** present and covering 100% of `gateway-context.ts` |

---

## Blocking issues

_None._

---

## Non-blocking observations

1. **Test count drift in verify summary:** implementer claimed 657; gate measures **622**. Do not treat count as a hard acceptance number without re-measurement.
2. **“Per-file floors” wording:** only aggregate `coverageThreshold` exists in root `bunfig.toml`. Per-file numbers are observational.
3. **`registerDynamic` body lightly covered:** lines ~247–250 in `gateway-registry.ts` uncovered; `createDynamicGatewayRegistry().register()` path is tested (same runtime rejection path via cast). Optional unit test calling `builder.registerDynamic(...)` would close the gap.
4. **consumer-smoke** still only asserts `PaymentClient`; plugin symbols are covered by package tests and a manual dist import, not the smoke script.
5. Phase 2 implementation remains largely uncommitted — commit/changelog/release are outside this gate’s pass criteria.

---

## Checklist (gate)

- [x] A1 third-party gateway full path (pay/webhook/hooks/log/errors) without core name edits
- [x] A2 registry-inferred gateway names (type + runtime)
- [x] A3 legacy constructor + built-ins during migration
- [x] A4 duplicate / immutable / concurrent tests green
- [x] 2.1 BuiltInGatewayName retained; open GatewayId where needed
- [x] 2.2 GatewayAdapter + Manifest + Context (full dependency set)
- [x] 2.3 Type-safe registry + dynamic less-typed API
- [x] 2.4 Immutable builder; no client unregister; hasGateway/configuredGateways
- [x] 2.5 Legacy preserved; createPaymentClient preferred
- [x] Independent typecheck / typecheck:types / tests / coverage / build / validate:package / boundaries
- [x] Credentials + defaultGateway + frozen mid-flight safety
- [x] No blocking logical bugs found in review of plugin init paths

---

## Verdict

**PASS** — Phase 2 open gateway plugin architecture meets roadmap acceptance criteria and tasks 2.1–2.5 with independent green evidence. Claim inaccuracies on exact test count / “per-file floors” are non-blocking.
