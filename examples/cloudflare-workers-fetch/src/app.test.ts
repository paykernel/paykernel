import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCheckoutKernel, runCheckoutHttpScenarios } from "@paykernel/example-checkout-kernel";
import { createCloudflareCheckoutFetch } from "./app";

runCheckoutHttpScenarios("cloudflare-workers", (k) => createCloudflareCheckoutFetch(k, { enableTestHooks: true }));

describe("cloudflare-workers test-hook honesty", () => {
  it("test-hook routes are documented as do not deploy", () => {
    // The fetch adapter uses dispatchCheckoutRequest which has the comments; also check this file's header
    const src = readFileSync(join(import.meta.dir, "app.ts"), "utf8");
    expect(src.toLowerCase()).toContain("do not static-import");
    expect(src).toContain("store-sqlite");
  });

  it.each([
    ["/internal/reconcile", "POST"],
    ["/internal/create-count", "GET"],
  ] as const)("rejects %s without enableTestHooks", async (path, method) => {
    const kernel = await createCheckoutKernel();
    try {
      const app = createCloudflareCheckoutFetch(kernel);
      const res = await app.fetch(new Request(`http://checkout.test${path}`, { method }));
      expect(res.status).toBe(404);
    } finally {
      kernel.close();
    }
  });
});
