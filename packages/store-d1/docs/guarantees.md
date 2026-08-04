# D1 adapter guarantees

**Package:** `@paykernel/store-d1`  
Machine-readable: `D1_STORAGE_ADAPTER_MANIFEST` / `getD1StorageAdapterManifest()`.

Aligned with Phase 9 `StorageAdapterManifest` in testkit. D1 Binding API verification pin: **2026-08-03**  
https://developers.cloudflare.com/d1/worker-api/

---

## Declared fields

| Field | Value | Honesty |
| ----- | ----- | ------- |
| `name` | `cloudflare-d1` | — |
| `coordinationScope` | `multi-host` | Assumes **one shared D1** bound into all Worker instances |
| `durability` | `durable` | D1 persists beyond a single isolate |
| `consistency.claims` | `strong` | Single-statement conditional UPSERT / UPDATE RETURNING (or multi-step only in `batch()`) |
| `consistency.readAfterWrite` | `session` | Sequential consistency via D1 Sessions (`first-primary` / bookmarks); without sessions under replication, stale reads possible |
| `consistency.staleReadsPossible` | `true` | Without Sessions under D1 read replication, replica reads may be stale |
| `supportsTransactions` | `true` | Via `batch()` (SQL transaction; failure rolls back sequence) |
| `supportsLeases` | `true` | Opaque TEXT lease tokens + generation fencing |
| `supportsRetentionCleanup` | `true` | `deleteExpired` for terminal rows only (not indeterminate by default) |

---

## Manifest notes (summary)

- Workers/Pages D1 binding; multi-instance Workers sharing one D1  
- **Not** `adapter-sqlite` (single-host local)  
- **Not** `adapter-turso` (Turso/libSQL clients)  
- **Not** Durable Objects (Phase 17)  
- Normal operation: binding only — **no** Cloudflare REST/account token required  
- Claims: single-statement ON CONFLICT/RETURNING preferred; multi-statement only via `batch()`  
- Never unprotected get-then-set  
- Prepared statements only  
- Explicit `migrateD1Adapter` only — never on import or default `createD1PaymentStores`  
- Injectable clock / FakeClock for lease reclaim tests  
- TEXT for IDs, lease tokens, hashes, money-like values; ISO-8601 TEXT timestamps  
- Async API only — no local sync `BEGIN IMMEDIATE` callbacks  
- Workers-only deployment surface; do not import `cloudflare:workers` into portable packages  

Full notes live on `D1_STORAGE_ADAPTER_MANIFEST.notes` in source.

---

## What we do **not** claim

- Multi-primary consensus across independent D1 databases  
- Local SQLite `BEGIN IMMEDIATE` sync transaction callbacks  
- Interchangeability with Turso/libSQL or Durable Objects  
- Strong read-after-write **without** Sessions when read replication is enabled  
- Multi-region strong consistency for unbound reads  
- Auto-migration on import or default factory construction  

---

## Secrets

StoreError messages sanitize API tokens, Bearer tokens, account IDs, and Cloudflare URLs. Never log raw driver errors with credentials.

---

## Related

- [limits.md](./limits.md) — platform / multi-region honesty  
- [sessions-and-replication.md](./sessions-and-replication.md)  
- [claims.md](./claims.md)  
- [numeric-portability.md](./numeric-portability.md)  
