# Numeric and string portability (D1)

**Package:** `@paykernel/store-d1`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md) § portable IDs/timestamps  
**Foundation codecs:** [`internal/sql-store` codecs](../../../internal/sql-store/docs/relational-foundation.md)

D1 is SQLite-backed. This adapter still stores **identity, lease, hash, and money-like** values as **TEXT** (and ISO-8601 strings for time) so JavaScript number precision and cross-runtime ports stay safe.

---

## Column / value rules

| Kind | Storage | Notes |
| ---- | ------- | ----- |
| Keys, owner IDs, event IDs | **TEXT** | Opaque strings; never JS Number IDs |
| `leaseToken` | **TEXT** | Unguessable opaque string (`lt_<hex>`-style) |
| Fingerprints / payload hashes | **TEXT** | Hex/base64 strings; not binary blobs required by contract |
| Timestamps (`createdAt`, `leaseExpiresAt`, …) | **TEXT** ISO-8601 | Portable; injectable clock returns ISO strings |
| `generation` | **INTEGER** | Monotonic fencing counter only |
| Money-like amounts / currency codes (if stored) | **TEXT** (or contract-safe decimals as strings) | Avoid IEEE float for money |

Do **not**:

- Store lease tokens or IDs as JS `number` / float  
- Rely on SQLite INTEGER affinity for large snowflake-style IDs that exceed `Number.MAX_SAFE_INTEGER`  
- Echo secrets, API tokens, or raw provider payloads into error fields or default columns  

---

## Clock injection

Lease predicates use an injectable clock (`clock.now()` → ISO TEXT). Conformance suites inject `FakeClock` so lease expiry and reclaim are deterministic without wall-clock waits.

```ts
import { createFakeClock } from "@paykernel/testkit";
import { createD1PaymentStores } from "@paykernel/store-d1";

const clock = createFakeClock();
const stores = createD1PaymentStores({ db, clock });
// clock.advance(ms) in tests
```

---

## Why TEXT for “numbers”

Workers and Node both use IEEE-754 doubles for JS numbers. Opaque tokens and financial exactness must not depend on that. sql-store codecs and this adapter keep the portable string surface aligned with Phase 9 contracts and Phase 11 foundation.

See also [claims.md](./claims.md) (lease tokens / generation) and [guarantees.md](./guarantees.md).
