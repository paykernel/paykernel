/**
 * Importing the package must not apply migrations.
 */
import { describe, expect, it } from "bun:test";

describe("package import has no migrate side effects", () => {
  it("dynamic import does not invoke any executor", async () => {
    let executeCalls = 0;
    const spyExecutor = {
      run() {
        executeCalls += 1;
        return { changes: 0 };
      },
      query() {
        executeCalls += 1;
        return [];
      },
      transaction<T>(fn: () => T) {
        executeCalls += 1;
        return fn();
      },
    };

    const mod = await import("./index");
    expect(executeCalls).toBe(0);
    expect(typeof mod.migrateSqliteAdapter).toBe("function");
    expect(typeof mod.createSqliteIdempotencyStore).toBe("function");
    expect(typeof mod.createSqliteStores).toBe("function");

    // Factory construction also must not migrate
    mod.createSqliteIdempotencyStore({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    mod.createSqliteStores({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    // Only explicit migrate runs execute
    await mod.migrateSqliteAdapter(spyExecutor);
    expect(executeCalls).toBeGreaterThan(0);
  });
});
