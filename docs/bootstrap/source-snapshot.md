# Source Snapshot

| Field | Value |
|---|---|
| Bootstrap date | 2026-08-04 |
| Source project | prior personal payment monorepo (local snapshot only) |
| Source commit SHA | `f83a3119b57bbdaad9a5f6a06189a827b010053e` |
| Git history imported | **No** — intentionally not imported |
| Legacy repository | Remains a separate personal project; not transferred or renamed |
| Legacy npm packages | Remain separate; not migrated, deprecated, or republished |
| Snapshot method | `rsync` excluding `.git`, `node_modules`, `dist`, caches, and env files |

## Included implementation

The snapshot includes architecture roadmap work through Phase 21 (core, webhooks, reconciliation, observability, routing, testkit, internal SQL store, and durable store adapters for Postgres, Redis, SQLite, Turso, Cloudflare D1, and Durable Objects).

This SHA is recorded only for traceability. It is **not** part of PayKernel Git history.
