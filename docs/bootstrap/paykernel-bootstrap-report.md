# PayKernel Bootstrap Report

**Date:** 2026-08-04  
**Status:** local bootstrap complete; GitHub remote configured

## Source snapshot

| Field | Value |
|---|---|
| Source project | prior personal payment monorepo (local snapshot only) |
| Source commit SHA | `f83a3119b57bbdaad9a5f6a06189a827b010053e` |
| Git history imported | **No** |
| Snapshot method | `rsync` excluding `.git`, `node_modules`, `dist`, caches, env files |
| Destination | PayKernel monorepo (`paykernel/paykernel`) |

## Legacy isolation

| Check | Result |
|---|---|
| Prior personal repository transferred / renamed / archived | **No** |
| Prior personal remote used by PayKernel | **No** (`origin` is `paykernel/paykernel`) |
| Prior personal npm packages published / deprecated by this bootstrap | **No** |
| PayKernel depends on prior personal payment packages | **No** |
| Prior Git history / tags / branches imported | **No** |

## Package map

| New path | New name | Version | Access |
|---|---|---|---|
| `.` | `paykernel` | `0.1.0` | private root |
| `packages/core` | `@paykernel/core` | `0.1.0-next.0` | public |
| `packages/testkit` | `@paykernel/testkit` | `0.1.0-next.0` | public |
| `packages/webhooks` | `@paykernel/webhooks` | `0.1.0-next.0` | public |
| `packages/reconciliation` | `@paykernel/reconciliation` | `0.1.0-next.0` | public |
| `packages/observability` | `@paykernel/opentelemetry` | `0.1.0-next.0` | public |
| `packages/routing` | `@paykernel/routing` | `0.1.0-next.0` | public |
| `packages/store-postgres` | `@paykernel/store-postgres` | `0.1.0-next.0` | public |
| `packages/store-redis` | `@paykernel/store-redis` | `0.1.0-next.0` | public |
| `packages/store-sqlite` | `@paykernel/store-sqlite` | `0.1.0-next.0` | public |
| `packages/store-turso` | `@paykernel/store-turso` | `0.1.0-next.0` | public |
| `packages/store-d1` | `@paykernel/store-d1` | `0.1.0-next.0` | public |
| `packages/store-durable-objects` | `@paykernel/store-durable-objects` | `0.1.0-next.0` | public |
| `internal/sql-store` | `@paykernel/internal-sql-store` | `0.1.0` | **private** |

## Local validation

| Check | Result |
|---|---|
| `bun install --frozen-lockfile` | pass (with `--ignore-scripts` when optional native builds lack node-gyp) |
| `bun run build` | pass (all workspaces) |
| `bun run typecheck` | pass |
| `bun run check:boundaries` | pass |
| `bun test` | **1904 pass**, 26 skip (live DB integration), **0 fail** |
| `npm pack --dry-run --workspace=@paykernel/core` | pass (`@paykernel/core@0.1.0-next.0`) |
| Residual prior-personal package scope / product name in operational tree | scrubbed to PayKernel identity |

## Git

| Field | Value |
|---|---|
| Default branch | `main` |
| Initial commit | `df66280752504f18494f28f1eef8c5dacfa67c03` |
| Remote | `git@github.com:paykernel/paykernel.git` |

## Follow-ups

1. Configure CI, branch protection, and release workflows for `@paykernel/*` only.
2. Claim/create npm org `paykernel` and publish prerelease packages under `next`.
3. Rebuild optional native deps (`better-sqlite3`) where node-gyp is available if Node SQLite driver tests are required locally.
4. Optionally rename root-level script aliases `test:adapter-*` → `test:store-*` for naming consistency.
5. Continue architecture roadmap under PayKernel identity.

## Readiness

**PayKernel monorepo is ready** on `paykernel/paykernel`. Prior personal project history is not part of this repository.
