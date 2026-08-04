/**
 * Importing the package must not apply migrations.
 */
import { describe, expect, it } from "bun:test";

describe("package import has no migrate side effects", () => {
  it("dynamic import does not invoke any executor", async () => {
    let executeCalls = 0;
    const spyExecutor = {
      async execute() {
        executeCalls += 1;
        return { rowCount: 0 };
      },
      async query() {
        executeCalls += 1;
        return [];
      },
    };

    const mod = await import("./index");
    expect(executeCalls).toBe(0);
    expect(typeof mod.migratePostgresAdapter).toBe("function");
    expect(typeof mod.createPostgresIdempotencyStore).toBe("function");

    // Factory construction also must not migrate
    mod.createPostgresIdempotencyStore({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    // Only explicit migrate runs execute
    await mod.migratePostgresAdapter(spyExecutor);
    expect(executeCalls).toBeGreaterThan(0);
  });
});
