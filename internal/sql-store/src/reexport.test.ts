import { describe, expect, it } from "bun:test";
import * as internal from "./index";
import * as foundation from "@paykernel/sql-foundation";

describe("@paykernel/internal-sql-store re-export", () => {
  it("re-exports foundation runtime symbols", () => {
    expect(internal.CURRENT_SCHEMA_VERSION).toBe(foundation.CURRENT_SCHEMA_VERSION);
    expect(typeof internal.createSchemaNamespace).toBe("function");
    expect(typeof internal.migrate).toBe("function");
  });

  it("stays private and depends only on sql-foundation among workspace packages", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(pkg.name).toBe("@paykernel/internal-sql-store");
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies?.["@paykernel/sql-foundation"]).toBe("workspace:*");
    expect(pkg.dependencies?.["@paykernel/core"]).toBeUndefined();
    expect(pkg.dependencies?.["@paykernel/webhooks"]).toBeUndefined();
  });
});
