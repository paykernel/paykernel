import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCheckoutKernel,
  runCheckoutHttpScenarios,
  type CheckoutFetchApp,
} from "@paykernel/example-checkout-kernel";
import { createElysiaCheckoutApp } from "./app";

runCheckoutHttpScenarios("elysia", (kernel): CheckoutFetchApp => {
  const app = createElysiaCheckoutApp(kernel, { enableTestHooks: true });
  return {
    fetch(req) {
      return app.handle(req);
    },
  };
});

describe("elysia test-hook honesty", () => {
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
      const app = createElysiaCheckoutApp(kernel);
      const res = await app.handle(
        new Request(`http://checkout.test${path}`, { method }),
      );
      expect(res.status).toBe(404);
    } finally {
      kernel.close();
    }
  });
});
