# Atomic claims (D1)

**Package:** `@paykernel/store-d1`  
**Contracts:** [store-contracts.md](../../store-contracts/docs/contracts.md)  
**Templates / algorithms:** [`@paykernel/sql-foundation` atomic claims](../../sql-foundation/docs/atomic-claims.md)

How Phase 9 `reserve` / `claim` atomicity is achieved on **async multi-host D1**.  
Contrast: local [`@paykernel/store-sqlite`](../../store-sqlite/docs/claims.md) (`BEGIN IMMEDIATE` sync); remote [`@paykernel/store-turso`](../../store-turso/docs/claims.md) (libSQL clients — different package).

---

## Strategy

**Preferred:** single-statement SQLite UPSERT + RETURNING (engine-atomic).

```sql
INSERT INTO payment_idempotency (…) VALUES (…)
ON CONFLICT (key) DO UPDATE SET …
WHERE … lease / fingerprint predicates …
RETURNING …;
```

Executed via D1 Binding API:

```ts
db.prepare(sql).bind(...params).all()  // results include RETURNING rows
// or .first() when a single row is expected
```

**Fallback for multi-statement:** only inside `db.batch([...])`, which D1 documents as a SQL transaction — on failure the entire sequence aborts/rolls back.

**Forbidden:** unprotected get-then-set across separate round-trips as the claim strategy.

```text
// FORBIDDEN — not engine-atomic under concurrent Workers
const row = await store.get(key);
if (!row || expired(row)) {
  await writeClaim(key, …); // race with another isolate
}
```

---

## Lease rules

- `generation` increments on successful reserve/claim/renew that issues a new lease
- `leaseToken`: unguessable (`crypto.getRandomValues` → `lt_<hex>`)
- `complete` / `fail` / `renew` require matching `leaseToken`; mismatch → `StoreLeaseLostError`
- Fingerprint / payloadHash conflicts return explicit conflict kinds
- Indeterminate: reserve returns `kind: "indeterminate"`; cleanup does **not** remove indeterminate by default
- Prepared/bound only — never string-interpolate user values
- Injectable clock: lease predicates use `clock.now()` / ISO TEXT timestamps

---

## RETURNING on D1

D1 docs note that plain writes may return empty `results`. This adapter uses **UPSERT/UPDATE/DELETE with RETURNING** and reads rows via `.all()` / `.first()` so claim classification has engine-returned rows. Mock D1 (bun:sqlite) and conformance suites prove the SQL path; live Workers verification is recommended for your D1 version.

If multi-statement is unavoidable, keep the sequence inside `batch()` and verify rollback behavior in tests (`batch.d1.test.ts`).

---

## Portability

Keys, lease tokens, fingerprints/hashes, and ISO timestamps are **TEXT**. `generation` is INTEGER. Do not store opaque IDs as JS Number/float.

Full rules: [numeric-portability.md](./numeric-portability.md).

---

## Related

- [binding.md](./binding.md) — prepare/bind/batch  
- [crash-boundaries.md](./crash-boundaries.md) — crash before/after side effect  
- [limits.md](./limits.md) — batch size guidance  
