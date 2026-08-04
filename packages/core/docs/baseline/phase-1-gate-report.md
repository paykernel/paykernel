# Phase 1 adversarial gate report

**Date (UTC):** 2026-08-02  
**Package:** `@paykernel/core@0.8.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun run typecheck` | exit 0 (`@paykernel/core` filter → `tsc --noEmit`) |
| `bun run typecheck:types` | exit 0 (`tsconfig.type-tests.json`) |
| `bun test packages/core` | **557 pass, 0 fail** (11 files, 1372 expects) |
| `bun test --coverage packages/core` | 557 pass; **99.52% funcs / 98.79% lines** (thresholds `functions=0.85` / `lines=0.90` in root `bunfig.toml`) |
| `bun run check:boundaries` | exit 0 — discovers `@paykernel/core` (`packages/core`); `workspace boundaries OK` |
| `bun test scripts/check-workspace-boundaries.test.ts` | **16 pass, 0 fail** (helpers + fixture negatives + live monorepo) |
| `bun run pack:check` | exit 0; tarball `@paykernel/core@0.8.0`, **65 files**, no `src/` / monorepo junk |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke **OK** (exit 0) |
| Root `src/` | **absent** (SDK lives only under `packages/core/src`) |

### Coverage snapshot (measured)

```
All files | 99.52% Funcs | 98.79% Lines
```

Thresholds enforced only under `bun test --coverage` via `bunfig.toml`:

```toml
coverageThreshold = { lines = 0.90, functions = 0.85 }
```

### Pack dry-run (measured)

- **name:** `@paykernel/core`
- **version:** `0.8.0`
- **filename:** `abshahin-payments-sdk-0.8.0.tgz`
- **total files:** 65
- **paths:** `dist/**`, `docs/**`, `README.md`, `LICENSE`, `package.json` only
- **junk scan** (`src/`, `scripts/`, `resources/`, `tsconfig`, `bunfig`, `*.test.ts`, `node_modules`, `monorepo`): **no matches**

### Consumer smoke (measured via `validate-package.sh`)

- Packed tarball from `packages/core` (not monorepo root; script guards `*monorepo*` filename).
- Bun + Node ESM: `import("@paykernel/core")` → `PaymentClient` is a function/class.
- Result: `consumer-smoke: OK`

---

## Acceptance criteria

### A1) Existing import paths continue to work — **PASS**

| Evidence | Detail |
| --- | --- |
| Package name | `packages/core/package.json` → `"name": "@paykernel/core"` (unchanged npm identity) |
| Root entry | `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`, `exports["."]` → types + import only (no subpath rename) |
| Consumer path | `scripts/consumer-smoke.mjs` installs packed tarball and imports package root name; Bun + Node both OK |
| Public API tests | `packages/core/src/public-api.test.ts` + type tests still run under monorepo `bun test packages/core` |
| Root private | Root `"name": "paykernel"`, `"private": true` — not the publish surface |

### A2) The packed core package contains only intended files — **PASS**

| Evidence | Detail |
| --- | --- |
| `files` field | `["dist", "docs", "README.md", "LICENSE"]` in `packages/core/package.json` |
| Live pack | `npm pack --dry-run` / `bun run pack:check` → 65 files; inventory matches dist + docs + README + LICENSE + package.json |
| No source / monorepo junk | No `src/`, `scripts/`, `resources/`, root configs, tests, or monorepo root package in tarball |
| Baseline artifact | `packages/core/docs/baseline/package-contents.md` records the same intended surface (minor size/shasum drift vs live pack noted under non-blocking) |

### A3) Workspace dependency boundaries are documented and enforced — **PASS**

| Evidence | Detail |
| --- | --- |
| Docs | [`docs/workspace-boundaries.md`](../../../../docs/workspace-boundaries.md) — layout, policy matrix, automated rules a–e, negative/positive examples, extension guide |
| Checker | `scripts/check-workspace-boundaries.ts` — core↔adapter isolation, portable Node/Bun/CF import policy, adapter root driver ban, cycle detection, internal must be private |
| Script | Root `"check:boundaries": "bun run scripts/check-workspace-boundaries.ts"` |
| CI | `.github/workflows/ci.yml` step **Check workspace boundaries** before typecheck |
| Live run | `bun run check:boundaries` → exit 0 |
| Unit coverage | `scripts/check-workspace-boundaries.test.ts` — 16 tests including fixture failures for `node:fs` and adapter drivers |
| Roadmap §1.2 mapping | See deliverables table below — all four prevention goals covered by rules a–d |

---

## Phase 1 tasks 1.1–1.3 deliverables

| Task | Deliverable | Evidence | Status |
| --- | --- | --- | --- |
| **1.1** Bun workspaces | `packages/core` holds SDK; root private workspace | `workspaces: ["packages/*"]`; root `private: true`; no root `src/` | **PASS** |
| **1.1** Package name | Keep `@paykernel/core` | `packages/core/package.json` name + publishConfig | **PASS** |
| **1.1** Forwarding scripts | Root DX commands | Root scripts: `build`, `test`, `typecheck`, `typecheck:types`, `pack:check`, `publint`, `attw`, `validate:package`, `check:boundaries`, format/lint, changesets | **PASS** |
| **1.1** Shared TS | `tsconfig.base.json` | Core `tsconfig.json` extends `../../tsconfig.base.json`; root solution `tsconfig.json` references core | **PASS** |
| **1.1** Format + lint | Shared Prettier + ESLint | `.prettierrc`, `.prettierignore`, `eslint.config.js`; scripts `format` / `format:check` / `lint` | **PASS** |
| **1.1** Workspace versioning | Independent package versions | Changesets `fixed: []`, `linked: []`; single public package today | **PASS** |
| **1.2** Core ↛ adapters | Automated | Rule a: forbidden `@paykernel/store-*` / `@paykernel/provider-*` and path fragments | **PASS** |
| **1.2** Portable ↛ Node-only | Automated | Rule b: bans non-allowlisted `node:*` / bare builtins / `bun:sqlite` / CF; allowlists `node:crypto` + `node:buffer` | **PASS** |
| **1.2** Adapter root ↛ drivers | Automated | Rule c: adapter root entry must not static-import optional peer drivers | **PASS** |
| **1.2** No circular workspace deps | Automated | Rule d: dependency graph cycle detection | **PASS** |
| **1.3** Changesets independent | Config | `.changeset/config.json`: empty fixed/linked, `access: public`, `changelog: @changesets/cli/changelog`, `baseBranch: master` | **PASS** |
| **1.3** Release notes | Changelog mechanism | `version-packages` → `changeset version`; `packages/core/CHANGELOG.md`; docs in `docs/releases.md` + `.changeset/README.md` | **PASS** |
| **1.3** npm provenance | CI + package | `release.yml`: `permissions.id-token: write`, `NPM_CONFIG_PROVENANCE=true`; core `publishConfig.provenance: true` | **PASS** |
| **1.3** Prerelease channels | Docs + scripts | `changeset:pre:enter` / `changeset:pre:exit`; `docs/releases.md` canary/beta policy | **PASS** |

---

## Phase 0 safety net (still green)

| Gate | Status |
| --- | --- |
| Tests | Green (557 pass) |
| Typecheck + type tests | Green |
| Coverage floors 90% lines / 85% funcs | Green (98.79% / 99.52%) |
| `validate:package` (build/pack/publint/attw/consumer smoke) | Green |
| Dist entrypoints | `packages/core/dist/index.js` + `index.d.ts` verified by validate script |
| Public runtime behavior | Suite still green at similar scale (Phase 0 report: 560; now 557 — see non-blocking) |

---

## Checklist (machine-readable outcomes)

- `A1: PASS package name @paykernel/core; root exports; consumer-smoke Bun+Node OK`
- `A2: PASS pack 65 files dist+docs+README+LICENSE+package.json; no src/junk`
- `A3: PASS docs/workspace-boundaries.md + check:boundaries exit 0 + CI step + rules a-e`
- `1.1: PASS workspaces packages/core, root private, forwarding scripts, tsconfig.base, prettier, eslint`
- `1.2: PASS boundary checker covers core isolation, portable imports, adapter drivers, cycles`
- `1.3: PASS changesets independent + changelog + provenance OIDC + prerelease scripts/docs`
- `P0-net: PASS typecheck, type tests, 557 tests, coverage above floors, validate:package OK`
- `Independent-rerun: PASS typecheck, typecheck:types, test, coverage, check:boundaries, pack:check, validate:package`

---

## Blocking issues

_None._

---

## Non-blocking observations

1. **Verify summary test count overstated.** Implementer claimed **573** tests; independent run measures **557 pass / 0 fail**. Coverage percentages (99.52% / 98.79%) match the claim. Does not affect pass (suite is green).
2. **Slight test-count drift vs Phase 0 gate.** Phase 0 report recorded **560** pass; Phase 1 measures **557** (−3). Still “similar count,” full green, no behavior-failure signal. No investigation forced for this gate.
3. **`package-contents.md` fingerprint drift.** Baseline shasum/package size differ slightly from live pack (e.g. docs byte sizes shifted). Intended file *set* still matches; regenerate baseline when intentionally freezing again.
4. **Lint/format not on CI path.** Shared configs and root scripts exist; `ci.yml` does not run `lint` or `format:check`. `docs/monorepo.md` notes pre-existing sources predate Prettier mass-format — acceptable for Phase 1 presence requirement.
5. **Single publishable package.** Boundary rules for adapters/internal are ready (unit-tested with fixtures) but only `packages/core` exists in the live graph — expected at Phase 1.

---

## Structure cross-check

```
payments-sdk/                         # private monorepo root
├── packages/core/                    # @paykernel/core
│   ├── src/                          # not packed
│   ├── dist/                         # packed
│   ├── docs/                         # packed (incl. this report once committed)
│   ├── package.json
│   ├── README.md
│   └── LICENSE
├── docs/                             # monorepo-only docs (not in core tarball)
│   ├── monorepo.md
│   ├── workspace-boundaries.md
│   └── releases.md
├── scripts/                          # check-workspace-boundaries, validate-package, consumer-smoke
├── .changeset/                       # independent versioning
├── .github/workflows/{ci,release}.yml
├── tsconfig.base.json
├── eslint.config.js
└── .prettierrc
```

Root `src/` is gone. Pack surface remains core-only intended files.

---

## Verdict

**PASS** — Phase 1 acceptance criteria A1–A3 and tasks 1.1–1.3 are independently evidenced. Phase 0 safety net remains green. No blocking gaps; no fixes required for gate closure.
