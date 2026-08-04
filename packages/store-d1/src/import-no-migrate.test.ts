/**
 * Importing the package must not apply migrations.
 * createD1PaymentStores / createD1Stores must not migrate by default.
 */
import { describe, expect, it } from "bun:test";

describe("package import has no migrate side effects", () => {
  it("dynamic import does not invoke any executor", async () => {
    let executeCalls = 0;
    const spyExecutor = {
      async execute() {
        executeCalls += 1;
        return { changes: 0 };
      },
      async query() {
        executeCalls += 1;
        return [];
      },
    };

    const mod = await import("./index");
    expect(executeCalls).toBe(0);
    expect(typeof mod.migrateD1Adapter).toBe("function");
    expect(typeof mod.createD1IdempotencyStore).toBe("function");
    expect(typeof mod.createD1PaymentStores).toBe("function");

    // Factory construction also must not migrate
    mod.createD1IdempotencyStore({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    mod.createD1Stores({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    // Binding factory with spy db must not migrate
    const spyDb = {
      prepare() {
        executeCalls += 1;
        return {
          bind() {
            return this;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [], success: true };
          },
          async run() {
            return { success: true, meta: { changes: 0 } };
          },
        };
      },
      async batch() {
        executeCalls += 1;
        return [];
      },
    };
    mod.createD1PaymentStores({ db: spyDb });
    expect(executeCalls).toBe(0);

    // Only explicit migrate runs execute/query
    await mod.migrateD1Adapter(spyExecutor);
    expect(executeCalls).toBeGreaterThan(0);
  });
});
