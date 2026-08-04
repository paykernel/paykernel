/**
 * Importing the package must not apply migrations.
 * createDoPaymentStores / createDoStores must not migrate by default.
 */
import { describe, expect, it } from "bun:test";

describe("package import has no migrate side effects", () => {
  it("dynamic import does not invoke any executor", async () => {
    let executeCalls = 0;
    const spyExecutor = {
      query() {
        executeCalls += 1;
        return [];
      },
      run() {
        executeCalls += 1;
        return { changes: 0 };
      },
      transaction<T>(fn: () => T) {
        executeCalls += 1;
        return fn();
      },
    };

    const mod = await import("./index");
    expect(executeCalls).toBe(0);
    expect(typeof mod.migrateDoAdapter).toBe("function");
    expect(typeof mod.ensureDoSchema).toBe("function");
    expect(typeof mod.createDoIdempotencyStore).toBe("function");
    expect(typeof mod.createDoPaymentStores).toBe("function");

    // Factory construction also must not migrate
    mod.createDoIdempotencyStore({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    mod.createDoStores({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    // Namespace factory must not migrate
    const spyNs = {
      idFromName(name: string) {
        return { toString: () => name };
      },
      get() {
        executeCalls += 1;
        return {};
      },
    };
    mod.createDoPaymentStores({
      namespace: spyNs,
      sharding: { kind: "key" },
    });
    // Construction may not touch namespace yet
    expect(executeCalls).toBe(0);

    // Only explicit migrate runs execute/query
    await mod.migrateDoAdapter(spyExecutor);
    expect(executeCalls).toBeGreaterThan(0);
  });
});
