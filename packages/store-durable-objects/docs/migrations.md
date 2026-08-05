# Migrations (explicit only)

```ts
import {
  migrateDoAdapter,
  ensureDoSchema,
  verifyDoAdapterSchema,
} from "@paykernel/store-durable-objects";

await migrateDoAdapter(storage); // or executor
// ensureDoSchema is an alias for migrateDoAdapter
await verifyDoAdapterSchema(storage);
```

## Rules

- **Never** migrate on package import.
- **Never** migrate inside default `createDoPaymentStores` construction.
- DO constructor `blockConcurrencyWhile(() => ensureSchema())` is OK as **DO lifecycle**, not npm import side-effect.
- Dialect: **sqlite** foundation from `@paykernel/sql-foundation`.
- Prefer not wrapping foundation DDL in `BEGIN`/`COMMIT` via `sql.exec` (executor forbids those statements).
