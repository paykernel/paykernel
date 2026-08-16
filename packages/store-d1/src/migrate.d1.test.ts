/**
 * Migrate unit tests against mock executor + mock D1 (bun:sqlite).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  migrateD1Adapter,
  verifyD1AdapterSchema,
  createSystemClock,
  clockNowIso,
  createD1Executor,
} from "./index";
import type { D1Executor } from "./executor";
import { createMockD1 } from "./test-utils/mock-d1";

function createRecordingExecutor(): D1Executor & {
  sqls: string[];
} {
  const sqls: string[] = [];
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

describe("migrateD1Adapter (mock executor)", () => {
  it("issues sqlite dialect SQL without BEGIN/COMMIT wrappers", async () => {
    const executor = createRecordingExecutor();
    // Recording executor returns empty version rows — migrate may throw after
    // probing; we only care that it spoke SQL and did not wrap DDL in txn.
    await migrateD1Adapter(executor, {
      nowIso: clockNowIso(createSystemClock()),
      namespace: { tablePrefix: "m_" },
    }).catch(() => undefined);

    expect(executor.sqls.length).toBeGreaterThan(0);
    const joined = executor.sqls.join("\n").toLowerCase();
    expect(joined).not.toContain("timestamptz");
    expect(joined).not.toMatch(/\bbegin\b/);
    expect(joined).not.toMatch(/\bcommit\b/);
  });

  it("verifyD1AdapterSchema reports not-ok when tables are missing", async () => {
    const executor = createRecordingExecutor();
    const result = await verifyD1AdapterSchema(executor, {
      namespace: { tablePrefix: "v_" },
      listTables: async () => [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("migrateD1Adapter (mock D1 / bun:sqlite)", () => {
  it("applies foundation schema and verifies; second migrate idempotent", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = "mig_";
      const migrateResult = await migrateD1Adapter(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(migrateResult.applied).toEqual([1, 2]);
      expect(migrateResult.currentVersion).toBe(2);

      const verify = await verifyD1AdapterSchema(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(verify.ok, JSON.stringify(verify)).toBe(true);

      // Binding-form migrate also works
      await migrateD1Adapter(handle.db, {
        namespace: { tablePrefix: prefix },
      });

      // TEXT columns for keys / lease tokens / hashes (numeric portability)
      const cols = handle.sqlite
        .query(`PRAGMA table_info(${prefix}payment_idempotency)`)
        .all() as Array<{ name: string; type: string }>;
      const byName = Object.fromEntries(cols.map((c) => [c.name, c.type]));
      expect(byName["key"]?.toUpperCase()).toContain("TEXT");
      expect(byName["lease_token"]?.toUpperCase()).toContain("TEXT");
      expect(byName["fingerprint"]?.toUpperCase()).toContain("TEXT");
      expect(byName["created_at"]?.toUpperCase()).toContain("TEXT");
      expect(byName["generation"]?.toUpperCase()).toMatch(/INT/);
    } finally {
      handle.close();
    }
  });
});

describe("migration SQL packaging", () => {
  it("migrations/*.sql has no BEGIN/COMMIT wrappers and contains foundation DDL", () => {
    const sqlPath = join(import.meta.dir, "../migrations/0001_foundation.sql");
    const sql = readFileSync(sqlPath, "utf8");
    const withoutComments = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toUpperCase();
    expect(withoutComments).not.toMatch(/\bBEGIN\b/);
    expect(withoutComments).not.toMatch(/\bCOMMIT\b/);
    // Full foundation DDL snapshot (not a placeholder SELECT 1) for Wrangler packaging.
    expect(withoutComments).toContain("CREATE TABLE");
    expect(withoutComments).toContain("PAYMENT_IDEMPOTENCY");
    expect(withoutComments).toContain("PAYMENT_WEBHOOK_INBOX");
    expect(withoutComments).toContain("PAYMENT_RECONCILIATION_JOBS");
    expect(withoutComments).toContain("PAYMENT_STORAGE_MIGRATIONS");
    // Numeric portability: correctness-critical strings as TEXT.
    expect(withoutComments).toMatch(/KEY\s+TEXT/);
    expect(withoutComments).toMatch(/LEASE_TOKEN\s+TEXT/);
    expect(withoutComments).toMatch(/PAYLOAD_HASH\s+TEXT/);
  });

  it("PERF-3: 0002_list_indexes.sql adds composite list/cleanup indexes", () => {
    const sqlPath = join(import.meta.dir, "../migrations/0002_list_indexes.sql");
    const sql = readFileSync(sqlPath, "utf8");
    const withoutComments = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toUpperCase();
    expect(withoutComments).not.toMatch(/\bBEGIN\b/);
    expect(withoutComments).not.toMatch(/\bCOMMIT\b/);
    expect(withoutComments).not.toMatch(/CREATE TABLE/);
    expect(withoutComments).toContain("CREATE INDEX IF NOT EXISTS");
    expect(withoutComments).toContain("ST_AVAIL");
    expect(withoutComments).toContain("ST_DUE");
    expect(withoutComments).toContain("ST_LEXP");
    expect(withoutComments).toContain("STATUS, AVAILABLE_AT");
    expect(withoutComments).toContain("STATUS, DUE_AT");
    expect(withoutComments).toContain("STATUS, LEASE_EXPIRES_AT");
  });
});
