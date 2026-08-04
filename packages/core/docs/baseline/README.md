# Phase 0 Baseline Artifacts

This directory freezes the **public contract** of `@paykernel/core` as of Phase 0.

## Purpose

Phase 0 is an engineering safety net, not a product release. It records:

1. **What the package exports** (runtime values and type-only names) so later refactors cannot silently change the public surface.
2. **How consumers resolve the package** (`main` / `types` / `exports`, ESM-only).
3. **What ships in the npm tarball** (file list, primary bundle size + SHA-256).

These artifacts are **source-of-truth snapshots**. Prefer regenerating them over hand-editing tables.

Related Phase 0 docs:

- [`coverage-policy.md`](./coverage-policy.md) — coverage thresholds and intentional gaps (this folder)
- [`../behavioral-contracts.md`](../behavioral-contracts.md) — cross-gateway money/webhook/retry contracts

## Files

| File | Generator | Description |
| --- | --- | --- |
| [`public-api.md`](./public-api.md) | `scripts/generate-api-baseline.ts` | Package identity, entry points, runtime exports + kinds, type-only exports, `dist/**/*.d.ts` tree |
| [`package-contents.md`](./package-contents.md) | `scripts/record-package-baseline.ts` | Bundle fingerprint, simulated `files` walk, `npm pack --dry-run` inventory |
| [`entry-points.md`](./entry-points.md) | hand-maintained (stable) | Consumer import map and examples (must stay consistent with `src/index.ts`) |
| [`coverage-policy.md`](./coverage-policy.md) | hand-maintained | Coverage thresholds, focus areas, and intentional gaps |
| [`README.md`](./README.md) | hand-maintained | This file |

## Prerequisites

- Bun ≥ 1.0 (scripts are Bun-runnable TypeScript)
- Built package: `dist/index.js` and declaration tree under `dist/`
- `npm` on `PATH` recommended for pack inventory (optional; simulated walk always runs)

```bash
bun run build
```

Scripts **do not** auto-build. A missing `dist/index.js` fails fast so baseline freezes never invent output.

## Regenerate

From the **monorepo root** (not `packages/core`):

```bash
# 1. Ensure a clean build matching the commit you intend to freeze
bun run build

# 2. Public API inventory (packages/core/src/index.ts + dist runtime + .d.ts tree)
# 3. Package contents (size/hash + pack list)
bun run baseline
# equivalent: bun run baseline:api && bun run baseline:package
```

After regeneration:

1. Diff `packages/core/docs/baseline/public-api.md` and `package-contents.md`.
2. Confirm export deltas match intentional public API changes only.
3. If you changed `packages/core/src/index.ts` exports, update `entry-points.md` consumer examples if needed.
4. Do **not** rewrite `src/index.ts` or `package.json` exports just to make a generator happy.

## Rules (Phase 0)

- **Do not invent exports** that are not re-exported from `src/index.ts`.
- **Do not change payment business logic** to satisfy baseline generation.
- **Do not commit secrets** into fixtures, pack lists, or docs.
- Bundle hash drift without a corresponding intentional change is a regression signal.
- Generators must remain deterministic for sorted tables (order of names/paths), aside from the ISO timestamp line.

## Related

- Public surface source: [`../../src/index.ts`](../../src/index.ts)
- Package manifest: [`../../package.json`](../../package.json)
- Generators (monorepo root): [`../../../../scripts/generate-api-baseline.ts`](../../../../scripts/generate-api-baseline.ts), [`../../../../scripts/record-package-baseline.ts`](../../../../scripts/record-package-baseline.ts)
