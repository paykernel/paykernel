# Phase 3 adversarial gate report

**Date (UTC):** 2026-08-02  
**Package:** `@paykernel/core@0.8.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Implementer claims under review

| Claim | Independent result |
| --- | --- |
| typecheck | **PASS** — `bun run typecheck` exit 0 |
| typecheck:types | **PASS** — `bun run typecheck:types` exit 0 |
| 709 tests | **PASS** — `bun test` → **709 pass, 0 fail**, 2689 expects, 19 files |
| coverage 99%+/99%+ (thresholds met) | **PASS** — measured **99.43% funcs / 99.05% lines**; floors in `bunfig.toml` are `functions=0.85` / `lines=0.90` |
| build | **PASS** — `bun run build` exit 0 (`dist/index.js` + declarations) |
| dist entrypoints | **PASS** — `dist/index.js`, `dist/index.d.ts`, capability modules present; root re-exports `supports`-related API |
| validate:package | **PASS** — pack + publint + attw + consumer smoke OK |
| boundaries | **PASS** — `bun run check:boundaries` → workspace boundaries OK |
| supports/capabilities public API | **PASS** — runtime + types exported; public-api tests + ad-hoc script |
| claim-validation tests | **PASS** — `capability-claims.test.ts` structural harness for all built-ins |
| generated gateway-capabilities.md + docs:capabilities | **PASS** — generator + drift test; regenerate writes matching file |
| verify failures `[]` / ok `true` | **Accepted** — independent re-run is all green (no need to trust unverified failure JSON) |

---

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test` | **709 pass, 0 fail** (19 files, 2689 expects) |
| `bun test --coverage packages/core` | **674 pass** (core only); **99.43% funcs / 99.05% lines**; thresholds met |
| `bun run typecheck` | exit 0 |
| `bun run typecheck:types` | exit 0 |
| `bun run build` | exit 0 — `index.js` 240.26 KB + `tsc --emitDeclarationOnly` |
| `bun run check:boundaries` | exit 0 |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke **OK** |
| `bun run docs:capabilities` | wrote `packages/core/docs/gateway-capabilities.md` (4 providers) |
| Sample `supports()` script (src + dist) | Stripe/Moyasar claims match constants; freeze + key parity OK |

### Coverage snapshot (measured)

```
All files | 99.43% Funcs | 99.05% Lines
```

Capability-critical files at 100% lines (measured):  
`client.ts`, `errors.ts`, `base.gateway.ts`, `gateway-capabilities.ts`, `builtin-capabilities.ts`, `capabilities-docs.ts`, `factories.ts`.

Policy floors (`packages/core/docs/baseline/coverage-policy.md` + root `bunfig.toml`): lines **0.90**, functions **0.85**. Current aggregate is well above floors.

### Dist / public surface (spot-checked)

From `packages/core/dist/index.d.ts` / `index.js`:

- Types: `GatewayCapabilityKey`, `GatewayCapabilities`, `OperationNotSupportedErrorOptions`
- Values: `GATEWAY_CAPABILITY_KEYS`, `DEFAULT_GATEWAY_CAPABILITIES`, `defineGatewayCapabilities`, `isGatewayCapabilityKey`, `CAPABILITY_OPERATION_MAP`, `freezeCapabilities`, `BUILTIN_*` capability constants/manifests, `generateGatewayCapabilitiesMarkdown`
- Errors: `OperationNotSupportedError` with optional `capability` / `claimedSupport`
- Runtime: `PaymentGateway.supports` / `.capabilities` on instances from `createPaymentClient` / factories

### Pack / consumer (via `validate-package.sh`)

- Tarball `@paykernel/core@0.8.0` includes `docs/gateway-capabilities.md` and capability dist modules
- publint: All good
- attw: ESM/bundler green; CJS dynamic-import-only ignored per package script
- consumer-smoke: Bun + Node import package root OK

---

## Acceptance criteria

### A1) Consumers can inspect support before invocation — **PASS**

| Evidence | Detail |
| --- | --- |
| Interface | `PaymentGateway.supports(capability)` + frozen `capabilities` snapshot (`gateway.interface.ts`) |
| Base implementation | `BaseGateway.supports` claim-driven (not method duck-typing); default all-false (`base.gateway.ts`) |
| Client access | `client.gateway(name).supports(...)` / `.capabilities` — tests in `client.test.ts`, `public-api.test.ts` |
| Public exports | Root package re-exports keys, helpers, builtin claims (`index.ts` + public-api suite) |
| Independent script | Stripe `partialRefunds`/`hostedCheckout` true; Moyasar `hostedCheckout` false / `marketplaceSplits` true; freeze true; supports ⇔ capabilities parity for all 15 keys |
| Dist path | Same behavior via `packages/core/dist/index.js` |

### A2) Unsupported operations fail consistently with capability metadata — **PASS**

| Evidence | Detail |
| --- | --- |
| Error shape | `OperationNotSupportedError` options: `capability`, `claimedSupport`; message embeds capability when provided (`errors.ts`) |
| Client gates | `payments` → createPayment; `refunds` + `partialRefunds` (amount present); `partialCapture` (amount present); `voids` authoritative even if method exists (`client.ts`) |
| Tests | `PaymentClient capability enforcement (Phase 3)` — voids false, claim-over-method, partial refunds, refunds false, payments false, partial capture |
| Base helper | `BaseGateway.assertCapability` throws with metadata (`gateway-capabilities.test.ts`) |
| Partial amount semantics | Full ops (omitted `amount`) allowed when partial flag false; `amount: 0` still gated (probe confirmed) |
| 0.x compat | `hasCapabilitySurface` — plain gateways without `supports`/`capabilities` fall back to method presence (`client.test.ts` legacy void test) |

### A3) Capability documentation is generated from code — **PASS**

| Evidence | Detail |
| --- | --- |
| Generator | `packages/core/scripts/generate-capability-docs.ts` |
| Source of truth | `BUILTIN_GATEWAY_MANIFESTS` / `builtin-capabilities.ts` via `generateGatewayCapabilitiesMarkdown` |
| Checked-in doc | `packages/core/docs/gateway-capabilities.md` — banner `auto-generated; do not hand-edit` |
| Drift test | `capabilities-docs.test.ts` asserts on-disk file === generator output |
| Script | `bun run docs:capabilities` (root + package) regenerates matching content |

---

## Phase 3 tasks 3.1–3.4

### 3.1 Stable capability keys — **PASS**

`GATEWAY_CAPABILITY_KEYS` (15, ordered, stable):

`payments`, `immediateCapture`, `authorization`, `partialCapture`, `refunds`, `partialRefunds`, `voids`, `hostedCheckout`, `tokenization`, `customers`, `paymentMethods`, `marketplaceSplits`, `disputes`, `paymentLinks`, `providerRecurring`

Covers all roadmap domains (payment creation, capture modes, refunds, void, hosted checkout, tokenization, customers, payment methods, marketplace splits, disputes, payment links, provider-native recurring as extension-only).

### 3.2 Capability queries (`supports`) — **PASS**

- Instance API on every `BaseGateway` / built-in
- Client access via `gateway(name)`
- Claim-authoritative (method present + claim false still `supports === false`)

### 3.3 Provider comparison docs from manifests/code — **PASS**

Generated matrix for Stripe / Moyasar / PayPal / Paymob with ✓/✗ cells; regenerate path and drift guard present.

### 3.4 Claim validation (structural/harness) — **PASS**

`capability-claims.test.ts` + `factories.test.ts`:

- Factory manifest ⇔ instance snapshot ⇔ `BUILTIN_GATEWAY_CAPABILITIES` for every key
- Claimed `true` implies required method for mappable ops (`createPayment`, `capturePayment`, `refundPayment`, `voidPayment`, `createCheckoutSession`)
- Built-in honesty: only Stripe `hostedCheckout`; only Moyasar `marketplaceSplits`; all deny disputes / paymentLinks / providerRecurring / tokenization / customers / paymentMethods
- All-false custom gateway: `supports` never true even when `voidPayment` method exists
- Frozen complete snapshots

Full Phase 4 conformance suite **not** required for this gate (roadmap Phase 4 owns live-provider depth).

---

## Logical correctness (gate checklist)

| Area | Result | Notes |
| --- | --- | --- |
| Partial amount gating | **OK** | Client gates only when `params.amount !== undefined`; full refund/capture remains allowed |
| Freeze | **OK** | `freezeCapabilities` on BaseGateway + builtins; mutation throws in tests |
| Factory / instance parity | **OK** | Shared constants wired into factory manifests and gateway `super(..., CAPS)` |
| 0.x adapter compat (no caps) | **OK** | `hasCapabilitySurface` no-op for assertCapability; method duck-typing retained for void |
| Honest built-in claims | **OK** | Conservative claims; true ⇒ method for mappable keys |
| Phase 0/1/2 safety net | **OK** | typecheck, tests, build, boundaries, plugin/public API green |

---

## Non-blocking observations

1. **Client does not assert `authorization` / `immediateCapture` on create** — those keys are inspectable; create is gated only by `payments`. Capture is not blocked solely by `authorization: false`. Consistent with current tests; document for consumers who need create-time auth inspection.
2. **`createCheckoutSession` is not a `PaymentClient` method** — `hostedCheckout` is primarily inspect-before-call on the gateway instance (Stripe-only among built-ins). Client-layer `OperationNotSupportedError` for hosted checkout is therefore N/A for the client facade.
3. **`CAPABILITY_OPERATION_MAP.authorization` → `capturePayment`** while prose describes create-path holds — mapping is intentional for “primary completion op”; do not treat as a create-time gate without further design.
4. **Coverage policy floors remain 90% lines / 85% funcs** — implementer “99%+” is measured reality, not the committed threshold.
5. **`validate:package` runs 674 core tests** vs monorepo `bun test` **709** (includes `scripts/check-workspace-boundaries.test.ts`). Both green.
6. **Working tree may be partially uncommitted** (e.g. `gateway-capabilities.md` untracked at review time). Gate evaluates code + green suite + generated artifact presence, not git cleanliness.

---

## Blocking issues

_None._

---

## Verdict

**PASS** — Phase 3 acceptance criteria A1–A3 and tasks 3.1–3.4 are evidenced by independent command re-runs and source inspection. No blocking gaps found under fail-closed review.
