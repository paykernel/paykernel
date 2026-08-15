# Phase 20 adversarial gate report

**Date (UTC):** 2026-08-04  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Scope:** `@paykernel/opentelemetry` + core OperationContext / redacting telemetry foundation  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> Primary package: [`packages/observability`](../../observability/)  
> Baseline twin: [`packages/core/docs/baseline/phase-20-gate-report.md`](../../core/docs/baseline/phase-20-gate-report.md)  
> Docs: [overview](./overview.md) · [operation-context](./operation-context.md) · [metrics](./metrics.md) · [instrumentation](./instrumentation.md) · [redaction](./redaction.md) · [opentelemetry](./opentelemetry.md) · [core telemetry](../../core/docs/telemetry.md)

---

## Verdict summary

Phase 20 **Observability and Operational Diagnostics** is **complete and green**. Independent adversarial re-verification confirms:

| Area | Independent result |
| ---- | ------------------ |
| Package tests (Phase 0–20 safety net) | **1738 pass, 15 skip, 0 fail** (1753 tests / 139 files) |
| Observability package alone | **29 pass, 0 fail** (7 files) |
| typecheck (all workspace packages) | **OK** (exit 0) |
| check:boundaries | **OK** |
| check:runtime-portability | **OK** |
| Core coverage | **99.53% funcs / 98.66% lines** |
| Full monorepo build | **OK** (exit 0; observability `dist/index.js` + `dist/otel.js` + `.d.ts`) |
| validate:package | **OK** (pack + publint + attw + consumer smoke) |
| `@paykernel/opentelemetry` portable + core-only dep | **PASS** (`paymentsSdk.portable: true`; deps = core only) |
| Phase 21 routing sneak-in | **absent** (no `createPaymentRouter` / routing package) |
| Blocking issues | **0** |

Implementer summary claims (`ok=true`, failures `[]`, 1738 tests, core 98.66% lines, typecheck/boundaries/portability/build/validate:package green) match independent re-runs.

---

## Acceptance criteria (roadmap Phase 20)

| ID | Criterion | Verdict | Evidence |
| -- | --------- | ------- | -------- |
| **A1** | Provider request IDs support operational debugging | **PASS** | `OperationContext.providerRequestId` in `packages/core/src/runtime/operation-context.ts`; allow-listed in `SAFE_KEY_ALLOWLIST` (`logger.ts` → `providerrequestid`); not redacted by `createRedactingTelemetrySink`. Tests: `operation-context.test.ts` (round-trip through redacting sink), `redaction.test.ts` (A1), `instrumentation.test.ts` (emit keeps `req_visible`). Docs: `core/docs/telemetry.md`, `operation-context.md`, observability README. |
| **A2** | Core has no mandatory OpenTelemetry dependency | **PASS** | `packages/core/package.json`: deps = `{ zod }` only; no `@opentelemetry/*` peer. No static OTEL import under `packages/core/src`. Observability optional bridge: duck-typed `createOpenTelemetryBridge(injectedApi)` — **no** `from "@opentelemetry/api"` in production sources (only JSDoc example). `@opentelemetry/api` is **optional** peer of observability only. Root import works without OTEL (`public-api.test.ts` A2). Boundaries rules forbid core OTEL deps. |
| **A3** | Sensitive values are never emitted by default | **PASS** | Core `createRedactingTelemetrySink` wraps via `redact()` (`gateway-context.ts`). Observability owns a **package-local** `createRedactingTelemetrySink` / `redactTelemetryData` (OBS-1: not a pure re-export) that still uses core `redact` policy + defense-in-depth `authorized` restore (OBS-2: core already allow-lists). `withPaymentOperation` / `recordPaymentOperation` always wrap through the package sink; do not attach `error.message`. Tests: core `operation-context.test.ts` secrets → `[REDACTED]`; observability `redaction.test.ts` (A3); instrumentation scrub path. |

---

## Roadmap 20.1–20.4 surface

| Item | Required | Evidence | Verdict |
| ---- | -------- | -------- | ------- |
| **20.1** OperationContext fields | operation ID, gateway, operation type, tenant/namespace, internal ref, provider object ID, provider request ID, attempt, duration, normalized outcome, retry/recon flags, inbox event key | Exact fields on `OperationContext` / builders in `operation-context.ts`; re-exported from observability `context.ts` / `index.ts` | **PASS** |
| **20.2** Span names | `payment.create` / `.capture` / `.refund` / `.void` / `.webhook.verify` / `.webhook.claim` / `.webhook.process` / `.reconcile` / `.store.claim` | `PAYMENT_SPAN_NAMES` in `spans.ts`; tests `spans.test.ts` + `public-api.test.ts` exact set | **PASS** |
| **20.3** Metrics instruments | outcomes, provider latency, rate limits, retries, webhook duplicates, payload conflicts, handler failures, expired/reclaimed leases, recon drift, indeterminate, adapter latency/errors | 13 instruments on `PaymentMetrics` (`metrics.ts` / `PAYMENT_METRICS_KEYS`); `METRIC_NAMES` under `payments.*`; tests exhaustiveness + recording | **PASS** |
| **20.4** Redaction | same model as logs | Core + package-owned sinks both use `redact()`; observability `redaction.ts` is **not** a pure re-export (OBS-1); tests secrets + keep `providerRequestId` / `authorized` | **PASS** |

---

## Package / monorepo constraints

| Constraint | Evidence | Verdict |
| ---------- | -------- | ------- |
| Package name `@paykernel/opentelemetry` | `packages/observability/package.json` | **PASS** |
| Portable (`paymentsSdk.portable: true`) | package.json + portability.test.ts (no `node:`/`bun:`/`@opentelemetry` static imports in prod src) | **PASS** |
| Production dep = core only | `dependencies: { "@paykernel/core": "workspace:*" }` | **PASS** |
| Optional OTEL peer only | `peerDependencies` + `peerDependenciesMeta.optional: true` | **PASS** |
| No observability → testkit/webhooks/recon/adapters | package.json + boundaries `a/observability-*` rules; green `check:boundaries` | **PASS** |
| Core must not depend on observability / OTEL | core package.json + boundaries; green check | **PASS** |
| Root scripts wired | root `build` / `typecheck` / `test` / `test:observability` include observability | **PASS** |
| Dist + types present | `dist/index.js`, `dist/otel.js`, module `.d.ts` files after build | **PASS** |
| Docs present | overview, operation-context, metrics, instrumentation, redaction, opentelemetry + core `telemetry.md` | **PASS** |
| No Phase 21 routing | no `createPaymentRouter` / route() API in packages | **PASS** |
| No production node:/bun: in observability src | portability.test.ts + independent `rg` (none outside tests) | **PASS** |

---

## Logical anti-bug checklist

| Anti-bug | Check | Verdict |
| -------- | ----- | ------- |
| OTEL hard-required | Root import + metrics path work without `@opentelemetry/api`; bridge is inject-only | **PASS** |
| Secrets in attributes / telemetry | Redacting sink + allow-list; instrumentation does not emit error messages; metric attrs are primitives only (documented) | **PASS** |
| core → observability dep | Absent (core deps = zod only) | **PASS** |
| node-only imports in observability prod | None | **PASS** |
| Indeterminate collapsed to failure-only | `withPaymentOperation` keeps `outcome: "indeterminate"` on `operationOutcomes` **and** increments `indeterminateOperations`; test asserts not synthetic `failed` | **PASS** |

---

## Independent command results

```text
# Tests (required re-run list)
bun test packages/core packages/testkit packages/webhooks packages/reconciliation \
  packages/observability internal/sql-store packages/store-postgres \
  packages/store-redis packages/store-sqlite packages/store-turso \
  packages/store-d1 packages/store-durable-objects
→ 1738 pass, 15 skip, 0 fail (1753 tests / 139 files)

# typecheck
bun run typecheck → exit 0 (all workspace packages including observability)

# boundaries
bun run check:boundaries → workspace boundaries OK

# runtime-portability
bun run check:runtime-portability → runtime portability OK

# coverage (core)
bun test --coverage packages/core → All files 99.53% funcs / 98.66% lines

# build + package validation
bun run build → exit 0
bun run validate:package → package validation OK (publint All good; attw green ESM/bundler; consumer smoke OK)
```

---

## Notes / non-blocking

- Deno import smoke was skipped (`deno` binary not found); static `node:` scan still required and green (same as prior phases).
- Live Postgres/Redis integration suites remain skip-clean without env URLs (15 skips) — expected; not Phase 20 regressions.
- `GatewayContext.telemetry` is optional. `createDefaultGatewayContext` auto-wraps a provided sink with `createRedactingTelemetrySink` (double-wrap stays safe). `withPaymentOperation` always redacts emit bags and span attributes.

---

## Final verdict

**PASS** — Phase 20 acceptance criteria A1–A3, roadmap 20.1–20.4 surface, portability, boundaries, safety net (1738 tests), typecheck, build, validate:package, and anti-bug checks all independently verified with evidence. Zero blocking issues.
