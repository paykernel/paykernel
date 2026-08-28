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
    const stores = createPostgresStoresFromPg({ executor });
    kernel = await createCheckoutKernel({
      storeFactory: async () => ({
        ...stores,
        close: () => {
          void pool?.end();
        },
      }),
    });
  } else {
    kernel = await createCheckoutKernel();
  }
  const app = createHonoCheckoutApp(kernel);
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({
    port,
    fetch: (req) => app.fetch(req),
  });
  console.log(`listening on http://127.0.0.1:${port}${pgUrl ? " (postgres)" : " (in-memory sqlite)"}`);
}
