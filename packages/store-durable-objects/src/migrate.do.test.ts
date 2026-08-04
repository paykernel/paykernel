/**
 * Migrate unit tests against mock executor + mock DO SQL.
 */
import { describe, expect, it } from "bun:test";
import {
  migrateDoAdapter,
  ensureDoSchema,
  verifyDoAdapterSchema,
  createSystemClock,
  clockNowIso,
  createDoExecutor,
} from "./index";
import type { DoExecutor } from "./sql-executor";
import { createMockDoSql } from "./test-utils/mock-do-sql";

function createRecordingExecutor(): DoExecutor & {
  sqls: string[];
} {
  const sqls: string[] = [];
  return {
    sqls,
    query(_sql: string) {
      sqls.push(_sql);
      return [];
    },
    run(sql: string) {
      sqls.push(sql);
      return { changes: 0 };
    },
    transaction<T>(fn: () => T) {
      return fn();
    },
  };
}

describe("migrateDoAdapter (mock executor)", () => {
  it("issues sqlite dialect SQL without BEGIN/COMMIT wrappers", async () => {
    const executor = createRecordingExecutor();
    await migrateDoAdapter(executor, {
      nowIso: clockNowIso(createSystemClock()),
      namespace: { tablePrefix: "m_" },
    }).catch(() => undefined);

    expect(executor.sqls.length).toBeGreaterThan(0);
    const joined = executor.sqls.join("\n").toLowerCase();
    expect(joined).not.toContain("timestamptz");
    // Foundation DDL itself should not wrap BEGIN/COMMIT; executor also forbids them.
    expect(joined).not.toMatch(/\bbegin\b/);
    expect(joined).not.toMatch(/\bcommit\b/);
  });

  it("verifyDoAdapterSchema reports not-ok when tables are missing", async () => {
    const executor = createRecordingExecutor();
    const result = await verifyDoAdapterSchema(executor, {
      namespace: { tablePrefix: "v_" },
      listTables: async () => [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("migrateDoAdapter (mock DO SQL)", () => {
  it("applies foundation schema and verifies; second migrate idempotent", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = "mig_";
      const migrateResult = await migrateDoAdapter(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(migrateResult).toBeDefined();

      const verify = await verifyDoAdapterSchema(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(verify.ok, JSON.stringify(verify)).toBe(true);

      // ensureDoSchema alias + storage-form also works
      await ensureDoSchema(handle.storage, {
        namespace: { tablePrefix: prefix },
      });
      const again = await migrateDoAdapter(handle.storage, {
        namespace: { tablePrefix: prefix },
      });
      expect(again.applied.length).toBe(0);
    } finally {
      handle.close();
    }
  });
});
