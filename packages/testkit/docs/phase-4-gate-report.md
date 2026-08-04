# Phase 4 gate report — `@paykernel/testkit`

**Status:** implemented (Stream A scaffold + working public surface)  
**Package version:** `0.1.0` (new package; independent of core `0.8.0`)  
**Date:** 2026-08-02

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Custom gateways validated via shared suite | `runGatewayConformanceSuite` + `mockGateway` golden path tests |
| Custom stores validated via shared suites | `run*StoreConformanceSuite` self-proved on memory stores |
| Apps can test without real providers | `mockGateway` scripted outcomes, dual-outcome timeout, webhook helpers |
| Built-ins offline-safe | `builtin-conformance.test.ts` capabilities + verify rejection; no live HTTP |
| Core does not depend on testkit | `check:boundaries` + package graphs; dep is testkit → core only |
| Memory stores NON-PRODUCTION | `NON_PRODUCTION` / `NON_DISTRIBUTED` / `MEMORY_STORE_WARNING` + README crash boundaries |
| Storage harness 4.3 topics | Concurrent claim, fake-clock expiry, crash abandon+reclaim, hash conflicts, cleanup, `withTransaction` rollback |
| Portable package | No banned Node builtins in production `src/`; checker treats testkit portable |

## Commands run (gate)

```bash
bun install
bun run typecheck          # core + testkit
bun test packages/core packages/testkit
bun run --filter @paykernel/testkit build
bun run check:boundaries
```

## Explicit non-goals (this phase)

- Phase 5 money model
- Phase 6 outcome unions rewrite
- Extract gateway packages / new PSPs
- Production webhooks/reconciliation packages (contracts live in testkit)
- Publishing testkit to npm

## Notes

- Lease-aware `IdempotencyStore` in testkit is **not** core 0.x `IdempotencyStore` (get/set/reserve).
- Built-in HTTP paths still use global `fetch`; full offline HTTP fixture runners need context.fetch wiring later.
- In-memory concurrency is single-isolate only.
