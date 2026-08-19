import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCheckoutKernel, runCheckoutHttpScenarios } from "@paykernel/example-checkout-kernel";
import { createHonoCheckoutApp } from "./app";

runCheckoutHttpScenarios("hono", (k) => {
  const app = createHonoCheckoutApp(k, { enableTestHooks: true });
  return { fetch: (req) => Promise.resolve(app.fetch(req)) };
});

describe("hono test-hook honesty", () => {
  it("recon route comments say do not deploy", () => {
    const src = readFileSync(join(import.meta.dir, "app.ts"), "utf8");
    let from = 0;
    let found = false;
    while (from < src.length) {
      const idx = src.indexOf("/internal/reconcile", from);
      if (idx < 0) break;
      const window = src.slice(Math.max(0, idx - 220), idx + 220);
      if (window.toLowerCase().includes("do not deploy")) {
        found = true;
        break;
      }
      from = idx + "/internal/reconcile".length;
    }
    expect(found).toBe(true);
  });

  it("rejects /internal/reconcile without enableTestHooks", async () => {
    const kernel = await createCheckoutKernel();
    try {
      const app = createHonoCheckoutApp(kernel);
      const res = await app.fetch(
        new Request("http://checkout.test/internal/reconcile", { method: "POST" }),
      );
      expect(res.status).toBe(404);
    } finally {
      kernel.close();
    }
  });
});
