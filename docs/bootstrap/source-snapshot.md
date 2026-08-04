# Source Snapshot

| Field | Value |
|---|---|
| Bootstrap date | 2026-08-04 |
| Source project | aashahin/payments-sdk (local monorepo) |
| Source commit SHA | `f83a3119b57bbdaad9a5f6a06189a827b010053e` |
| Git history imported | **No** — intentionally not imported |
| Legacy repository | Remains independent at `aashahin/payments-sdk` |
| Legacy npm package | Remains independent at `@abshahin/payments-sdk` (and sibling `@abshahin/payments-*` packages) |
| Snapshot method | `rsync` excluding `.git`, `node_modules`, `dist`, caches, and env files |

## Included implementation

The snapshot includes the architecture roadmap work completed in the source tree through Phase 21 (core, webhooks, reconciliation, observability, routing, testkit, internal SQL store, and durable store adapters for Postgres, Redis, SQLite, Turso, Cloudflare D1, and Durable Objects).

This SHA is recorded only for traceability. It is **not** part of PayKernel Git history.
