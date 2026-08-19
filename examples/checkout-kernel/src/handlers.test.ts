import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCheckoutFetchApp } from "./handlers";
import { createCheckoutKernel } from "./kernel";

function assertRouteCommentSaysDoNotDeploy(source: string, route: string): void {
  let from = 0;
  let found = false;
  while (from < source.length) {
    const idx = source.indexOf(route, from);
    if (idx < 0) break;
    const window = source.slice(Math.max(0, idx - 220), idx + 220);
    if (window.toLowerCase().includes("do not deploy")) {
      found = true;
      break;
    }
    from = idx + route.length;
  }
  expect(found).toBe(true);
}

describe("checkout handlers test-hook honesty", () => {
  it("test-hook route comments say do not deploy", () => {
    const src = readFileSync(join(import.meta.dir, "handlers.ts"), "utf8");
    assertRouteCommentSaysDoNotDeploy(src, "/internal/reconcile");
    assertRouteCommentSaysDoNotDeploy(src, "/internal/provider-paid");
    assertRouteCommentSaysDoNotDeploy(src, "/internal/create-count");
  });

  it.each([
    ["/internal/reconcile", "POST"],
    ["/internal/create-count", "GET"],
  ] as const)("rejects %s without enableTestHooks", async (path, method) => {
    const kernel = await createCheckoutKernel();
    try {
      const app = createCheckoutFetchApp(kernel);
      const res = await app.fetch(
        new Request(`http://checkout.test${path}`, { method }),
      );
      expect(res.status).toBe(404);
    } finally {
      kernel.close();
    }
  });

  it("serves /internal/reconcile only with enableTestHooks", async () => {
    const kernel = await createCheckoutKernel({
      scriptCreate: [{ outcome: "indeterminate" }],
    });
    try {
      const app = createCheckoutFetchApp(kernel, { enableTestHooks: true });
      const created = await app.fetch(
        new Request("http://checkout.test/payments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(created.status).toBe(200);
      const recon = await app.fetch(
        new Request("http://checkout.test/internal/reconcile", { method: "POST" }),
      );
      expect(recon.status).toBe(200);
    } finally {
      kernel.close();
    }
  });

  it("serves /internal/create-count only with enableTestHooks", async () => {
    const kernel = await createCheckoutKernel();
    try {
      const app = createCheckoutFetchApp(kernel, { enableTestHooks: true });
      const res = await app.fetch(new Request("http://checkout.test/internal/create-count"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ count: 0 });
    } finally {
      kernel.close();
    }
  });
});
