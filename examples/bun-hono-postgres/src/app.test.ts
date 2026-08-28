import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCheckoutKernel } from "@paykernel/example-checkout-kernel";
import { createHonoCheckoutApp } from "./app";
import { createPgPostgresExecutor, createPostgresStoresFromPg, migratePostgresAdapter } from "../../../packages/store-postgres/src/pg";
import { Pool } from "pg";

const PG_URL = process.env.PAYMENTS_SDK_PG_URL ?? process.env.DATABASE_URL;
const hasPg = Boolean(PG_URL);

describe.skipIf(!hasPg)("hono-postgres checkout (requires PAYMENTS_SDK_PG_URL)", () => {
  it("creates postgres kernel and handles payment + webhook", async () => {
    const pool = new Pool({ connectionString: PG_URL });
    const executor = createPgPostgresExecutor(pool);
    const prefix = `pkrc_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}_`;
    const stores = createPostgresStoresFromPg({
      executor,
      namespace: { tablePrefix: prefix },
    });
    await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
    const kernel = await createCheckoutKernel({
      storeFactory: async () => ({
        ...stores,
        close: () => {
          void pool.end();
        },
      }),
    });
    const app = createHonoCheckoutApp(kernel, { enableTestHooks: true });
    try {
      const createRes = await app.fetch(new Request("http://checkout.test/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: "order_pg_test" }),
      }));
      expect(createRes.status).toBe(200);
      const createBody = await createRes.json() as { orderId: string; gatewayPaymentId: string };
      expect(createBody.orderId).toBe("order_pg_test");
      // Reconcile should be no-op but not fail
      const reconRes = await app.fetch(new Request("http://checkout.test/internal/reconcile", { method: "POST" }));
      expect(reconRes.status).toBe(200);
    } finally {
      kernel.close();
      await pool.end();
    }
  });
});

describe("hono-postgres test-hook honesty", () => {
  it("test-hook route comments say do not deploy", () => {
    const src = readFileSync(join(import.meta.dir, "app.ts"), "utf8");
    for (const route of ["/internal/reconcile", "/internal/create-count"]) {
      let from = 0;
      let found = false;
      while (from < src.length) {
        const idx = src.indexOf(route, from);
        if (idx < 0) break;
        const window = src.slice(Math.max(0, idx - 220), idx + 220);
        if (window.toLowerCase().includes("do not deploy")) {
          found = true;
          break;
        }
        from = idx + route.length;
      }
      expect(found).toBe(true);
    }
  });

  it.each([
    ["/internal/reconcile", "POST"],
    ["/internal/create-count", "GET"],
  ] as const)("rejects %s without enableTestHooks", async (path, method) => {
    const kernel = await createCheckoutKernel();
    try {
      const app = createHonoCheckoutApp(kernel);
      const res = await app.fetch(
        new Request(`http://checkout.test${path}`, { method }),
      );
      expect(res.status).toBe(404);
    } finally {
      kernel.close();
    }
  });
});
