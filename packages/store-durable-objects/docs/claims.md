# Atomic claims (Durable Objects)

**Package:** `@paykernel/store-durable-objects`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md)

How Phase 9 `reserve` / `claim` atomicity is achieved on **SQLite-backed Durable Objects**.

## Preferred strategy

Single-statement SQLite UPSERT + RETURNING via sync `storage.sql.exec`:

```sql
INSERT INTO payment_idempotency (…) VALUES (…)
ON CONFLICT (key) DO UPDATE SET …
WHERE … lease / fingerprint predicates …
RETURNING …;
```

Cursor is fully consumed with `.toArray()` before any await.

## Multi-statement

Only inside `storage.transactionSync(() => { … pure sync sql … })`.

- Callback **must** be synchronous — no `await`, no `fetch`, no provider I/O.
- Do **not** issue `BEGIN`/`COMMIT` via `sql.exec` (use `transactionSync`).

## Forbidden

```text
// FORBIDDEN — get-then-set as claim strategy
const row = get(key);
if (!row || expired(row)) writeClaim(key, …);
```

```text
// FORBIDDEN — external work inside transactionSync
storage.transactionSync(() => {
  claim();
  await fetch(provider); // NEVER
});
```

## Correct runtime pattern

```text
1) claim atomically (UPSERT or transactionSync)
2) commit / leave storage transaction
3) external provider network work
4) complete / fail with lease token
```

Mismatching lease tokens → `StoreLeaseLostError`.  
Indeterminate rows block reserve (returned as `kind: "indeterminate"`); cleanup does not delete them by default.
