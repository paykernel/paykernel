import { createCheckoutKernel, type CheckoutKernel } from "@paykernel/example-checkout-kernel";
import { createHonoCheckoutApp } from "./app";
import { createPgPostgresExecutor, createPostgresStoresFromPg, migratePostgresAdapter } from "@paykernel/store-postgres/pg";
import { Pool } from "pg";

export { createHonoCheckoutApp } from "./app";

if (import.meta.main) {
  const pgUrl = process.env.PAYMENTS_SDK_PG_URL ?? process.env.DATABASE_URL;
  let kernel: CheckoutKernel;
  let pool: Pool | undefined;
  if (pgUrl) {
    pool = new Pool({ connectionString: pgUrl });
    const executor = createPgPostgresExecutor(pool);
    // Ops/CI only — migrate explicitly before kernel, never on import/request (see docs/getting-started.md:140-142)
    await migratePostgresAdapter(executor);
    const stores = createPostgresStoresFromPg({ client: pool });
    kernel = await createCheckoutKernel({
      storeFactory: async () => ({
        ...stores,
        close: () => {
          void pool?.end();
        },
      }),
    });
  } else if (process.env.ALLOW_MEMORY_FALLBACK === "1") {
    console.warn("[paykernel] PAYMENTS_SDK_PG_URL/DATABASE_URL not set — running with in-memory fallback (ALLOW_MEMORY_FALLBACK=1). Not for production PG RC.");
    kernel = await createCheckoutKernel();
  } else {
    console.error("[paykernel] PAYMENTS_SDK_PG_URL or DATABASE_URL is required for bun-hono-postgres PG RC. Set ALLOW_MEMORY_FALLBACK=1 to run without Postgres (test/dev only).");
    process.exit(1);
  }
  const app = createHonoCheckoutApp(kernel);
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({
    port,
    fetch: (req) => app.fetch(req),
  });
  console.log(`listening on http://127.0.0.1:${port}${pgUrl ? " (postgres)" : " (in-memory sqlite)"}`);
}
