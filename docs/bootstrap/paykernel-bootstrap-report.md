# PayKernel Bootstrap Report

**Date:** 2026-08-04  
**Status:** local bootstrap complete — external gates pending

## Source snapshot

| Field | Value |
|---|---|
| Source project | `aashahin/payments-sdk` (local path `payments-sdk`) |
| Source commit SHA | `f83a3119b57bbdaad9a5f6a06189a827b010053e` |
| Git history imported | **No** |
| Snapshot method | `rsync` excluding `.git`, `node_modules`, `dist`, caches, env files |
| Destination | `/home/shahin/Documents/projects/personal/packages/paykernel` |

## Legacy isolation

| Check | Result |
|---|---|
| Legacy repo transferred / renamed / archived | **No** |
| Legacy remote changed | **No** (`origin` still `aashahin/payments-sdk`) |
| Legacy working tree modified by bootstrap | **No** (only pre-existing untracked plan file in legacy dir) |
| `@abshahin/payments-sdk` published / deprecated | **No** |
| PayKernel depends on legacy packages | **No** |
| Legacy history / tags / branches imported | **No** |

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

Independent personal packages intentionally left as historical references only:

- `@abshahin/subscriptions` (roadmap mention only)

## Local validation

| Check | Result |
|---|---|
| `bun install --frozen-lockfile` | pass (with `--ignore-scripts` due to optional `better-sqlite3` native build without node-gyp) |
| `bun run build` | pass (all 13 workspaces) |
| `bun run typecheck` | pass |
| `bun run check:boundaries` | pass |
| `bun test` | **1904 pass**, 26 skip (live DB integration), **0 fail** |
| `npm pack --dry-run --workspace=@paykernel/core` | pass (`@paykernel/core@0.1.0-next.0`, 142 files) |
| Operational `@abshahin/payments-sdk` / `aashahin/payments-sdk` refs | **none** outside bootstrap/history docs |

## Git

Initialized as a new repository with default branch `main` and a single bootstrap commit `df66280752504f18494f28f1eef8c5dacfa67c03`. No remotes at init time.

## External gates (not executed)

### Gate 1 — create/push `paykernel/paykernel`

Pending explicit approval. Proposed commands:

```bash
cd /home/shahin/Documents/projects/personal/packages/paykernel
gh repo create paykernel/paykernel \
  --public \
  --description "A type-safe payment orchestration toolkit for TypeScript and modern server runtimes."
git remote add origin git@github.com:paykernel/paykernel.git
git push -u origin main
```

### Gate 2 — npm publish `@paykernel/*`

Pending organization access, trusted publishing setup, and approval. Recommended first dist-tag: `next`.

## Follow-ups

1. Create GitHub org/repo `paykernel/paykernel` and push (Gate 1).
2. Configure CI, branch protection, and release workflows for `@paykernel/*` only.
3. Claim/create npm org `paykernel` and publish prerelease packages under `next`.
4. Rebuild optional native deps (`better-sqlite3`) where node-gyp is available if Node SQLite driver tests are required locally.
5. Optionally rename root-level script aliases `test:adapter-*` → `test:store-*` for naming consistency.
6. Continue architecture roadmap from remaining open phases under PayKernel identity.

## Readiness

**Local PayKernel monorepo is ready.** Architecture work can continue in this tree after Gate 1 lands the remote. Do not treat source snapshot SHA as PayKernel history.
