/**
 * Migrate unit tests against mock executor + optional libsql :memory:.
 */
import { describe, expect, it } from "bun:test";
import {
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
  createSystemClock,
  clockNowIso,
} from "./index";
import type { TursoExecutor } from "./executor";

function createRecordingExecutor(): TursoExecutor & {
  sqls: string[];
} {
  const sqls: string[] = [];
  // Minimal in-memory-ish: just record SQL and return empty.
  // migrate will fail schema verify without real tables — for "calls execute" check only.
  return {
    sqls,
    async query(_sql: string) {
      sqls.push(_sql);
      return [];
    },
    async execute(sql: string) {
      sqls.push(sql);
      return { changes: 0 };
    },
  };
}

describe("migrateTursoAdapter (mock)", () => {
  it("uses dialect sqlite and invokes executor", async () => {
    const executor = createRecordingExecutor();
    // migrate may throw if bookkeeping queries return unexpected shapes —
    // we only assert it attempts SQL with sqlite-ish statements.
    try {
      await migrateTursoAdapter(executor, {
        nowIso: clockNowIso(createSystemClock()),
        namespace: { tablePrefix: "m_" },
      });
    } catch {
      // expected if mock returns empty for version reads
    }
    expect(executor.sqls.length).toBeGreaterThan(0);
    const joined = executor.sqls.join("\n").toLowerCase();
    // sqlite migrations create tables without postgres-only types
    expect(joined).not.toContain("timestamptz");
  });

  it("verifyTursoAdapterSchema returns result object", async () => {
    const executor = createRecordingExecutor();
    const result = await verifyTursoAdapterSchema(executor, {
      namespace: { tablePrefix: "v_" },
      listTables: async () => [],
    });
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe("boolean");
  });
});

describe("migrateTursoAdapter (libsql :memory: skip-clean)", () => {
  it("applies foundation schema on in-memory libsql", async () => {
    let openOk = false;
    try {
      const { createClient } = await import("@libsql/client");
      const client = createClient({ url: ":memory:" });
      openOk = true;
      const { createLibsqlExecutor } = await import("./drivers/libsql");
      const executor = createLibsqlExecutor(client);
      const prefix = "mig_";
      const migrateResult = await migrateTursoAdapter(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(migrateResult).toBeDefined();

      const verify = await verifyTursoAdapterSchema(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(verify.ok, JSON.stringify(verify)).toBe(true);

      // Second migrate is idempotent
      await migrateTursoAdapter(executor, {
        namespace: { tablePrefix: prefix },
      });
      client.close();
    } catch (err) {
      if (openOk) throw err;
      // @libsql/client unavailable — clean skip
      return;
    }
  });
});
