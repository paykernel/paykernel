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
        return { changes: 0 };
      },
      async query() {
        executeCalls += 1;
        return [];
      },
    };

    const mod = await import("./index");
    expect(executeCalls).toBe(0);
    expect(typeof mod.migrateTursoAdapter).toBe("function");
    expect(typeof mod.createTursoIdempotencyStore).toBe("function");

    // Factory construction also must not migrate
    mod.createTursoIdempotencyStore({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    mod.createTursoStores({ executor: spyExecutor });
    expect(executeCalls).toBe(0);

    // Only explicit migrate runs execute
    await mod.migrateTursoAdapter(spyExecutor);
    expect(executeCalls).toBeGreaterThan(0);
  });
});
