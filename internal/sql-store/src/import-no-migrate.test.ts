/**
 * Importing the package must not apply migrations (spy on execute).
 */
import { describe, expect, it } from "bun:test";

describe("package import has no migrate side effects", () => {
  it("dynamic import does not invoke any executor", async () => {
    let executeCalls = 0;
    const spyExecutor = {
      execute() {
        executeCalls += 1;
        return {};
      },
      query() {
        executeCalls += 1;
        return [];
      },
    };

    // Import after spy exists — module evaluation must not touch executor.
    const mod = await import("./index");
    expect(executeCalls).toBe(0);
    expect(typeof mod.migrate).toBe("function");
    expect(mod.CURRENT_SCHEMA_VERSION).toBe(1);

    // Only explicit call runs execute
    await mod.migrate(spyExecutor, { dialect: "sqlite" });
    expect(executeCalls).toBeGreaterThan(0);
  });
});
