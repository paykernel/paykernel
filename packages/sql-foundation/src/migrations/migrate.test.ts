import { describe, expect, it } from "bun:test";
import { migrate, MIGRATE_HAS_PORTABLE_LOCK } from "./migrate";
import { verifySchema } from "./verify";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "./metadata";
import {
  createFakeDbState,
  createFakeExecutor,
  expectedTablesForNamespace,
} from "../fixtures/migration-fixtures";
import { createSchemaNamespace } from "../schema/namespace";
import { LOGICAL_TABLES } from "../schema/tables";

describe("migrate()", () => {
  it("applies version 1 and is idempotent on second run", async () => {
    const state = createFakeDbState();
    const executor = createFakeExecutor(state);

    const first = await migrate(executor, {
      dialect: "sqlite",
      nowIso: "2026-01-15T12:00:00.000Z",
    });
    expect(first.applied).toEqual([1, 2]);
    expect(first.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(first.alreadyApplied).toEqual([]);

    for (const name of expectedTablesForNamespace()) {
      expect(state.tables.has(name)).toBe(true);
    }

    const second = await migrate(executor, {
      dialect: "sqlite",
      nowIso: "2026-01-15T12:05:00.000Z",
    });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual([1, 2]);
    expect(second.currentVersion).toBe(2);
  });

  it("applies with table prefix and schema namespace", async () => {
    const nsConfig = { tablePrefix: "pay_", sqlSchema: "payments" };
    const state = createFakeDbState();
    const executor = createFakeExecutor(state, nsConfig);

    const result = await migrate(executor, {
      dialect: "postgres",
      namespace: nsConfig,
      nowIso: "2026-01-15T12:00:00.000Z",
    });
    expect(result.applied).toEqual([1, 2]);

    const expected = expectedTablesForNamespace(nsConfig);
    for (const name of expected) {
      expect(state.tables.has(name)).toBe(true);
    }

    // SQL used qualified names
    const joined = state.statements.join("\n");
    expect(joined).toContain("pay_payment_idempotency");
    expect(joined).toContain("payments");
    // P11-SCHEMA-1: CREATE SCHEMA before ensureMigrationsTable / CREATE TABLE.
    expect(joined).toMatch(/CREATE SCHEMA IF NOT EXISTS\s+"payments"/i);
    const schemaIdx = state.statements.findIndex((s) => /CREATE SCHEMA IF NOT EXISTS/i.test(s));
    const tableIdx = state.statements.findIndex((s) => /CREATE TABLE IF NOT EXISTS/i.test(s));
    expect(schemaIdx).toBeGreaterThanOrEqual(0);
    expect(tableIdx).toBeGreaterThan(schemaIdx);
  });

  it("postgres and sqlite migration SQL differ (dialect honesty)", async () => {
    const pg = createFakeDbState();
    const sq = createFakeDbState();
    await migrate(createFakeExecutor(pg), { dialect: "postgres" });
    await migrate(createFakeExecutor(sq), { dialect: "sqlite" });
    // Both create same logical tables
    expect(pg.tables.has(LOGICAL_TABLES.idempotency)).toBe(true);
    expect(sq.tables.has(LOGICAL_TABLES.idempotency)).toBe(true);
    // Bookkeeping INSERT uses dialect placeholders ($n vs ?)
    const pgInsert = pg.statements.find((s) => /INSERT(?:\s+OR\s+IGNORE)?\s+INTO/i.test(s)) ?? "";
    const sqInsert = sq.statements.find((s) => /INSERT(?:\s+OR\s+IGNORE)?\s+INTO/i.test(s)) ?? "";
    expect(pgInsert).toContain("$1");
    expect(sqInsert).toContain("?");
    expect(pgInsert).not.toBe(sqInsert);
    // P11-MIG-1: conflict-safe version bookkeeping (not a portable advisory lock).
    expect(pgInsert).toMatch(/ON CONFLICT\s*\(\s*version\s*\)\s*DO NOTHING/i);
    expect(sqInsert).toMatch(/INSERT OR IGNORE/i);
    // Foundation DDL is shared intent (TEXT + CHECK) but claim templates differ elsewhere
    expect(pg.migrations.get(1)?.name).toBe("create_payment_storage_foundation");
    expect(sq.migrations.get(1)?.name).toBe("create_payment_storage_foundation");
  });

  it("P11-MIG-1: second insert of the same version does not throw when simulated", async () => {
    const seenVersions = new Set<number>();
    const statements: string[] = [];
    const simulateVersionInsert = (sql: string, params?: readonly unknown[]) => {
      if (!/INSERT/i.test(sql) || !params || params.length < 1) return;
      const version = Number(params[0]);
      const conflictSafe =
        /ON CONFLICT\s*\(\s*version\s*\)\s*DO NOTHING/i.test(sql) || /INSERT OR IGNORE/i.test(sql);
      if (seenVersions.has(version) && !conflictSafe) {
        throw new Error("unique_violation: version already applied");
      }
      seenVersions.add(version);
    };
    const makeExecutor = () => ({
      execute(sql: string, params?: readonly unknown[]) {
        statements.push(sql);
        simulateVersionInsert(sql, params);
        return { ok: true };
      },
      query() {
        // Always appear unapplied so migrate hits the version INSERT path.
        return [];
      },
    });

    await migrate(makeExecutor(), {
      dialect: "postgres",
      nowIso: "2026-01-15T12:00:00.000Z",
    });
    const isVersionInsert = (s: string) => /INSERT(?:\s+OR\s+IGNORE)?\s+INTO/i.test(s);
    const pgInsert = statements.find(isVersionInsert);
    expect(pgInsert).toBeDefined();
    expect(() =>
      simulateVersionInsert(pgInsert!, [1, "create_payment_storage_foundation", "t", "c"]),
    ).not.toThrow();

    seenVersions.clear();
    statements.length = 0;
    await migrate(makeExecutor(), {
      dialect: "sqlite",
      nowIso: "2026-01-15T12:00:00.000Z",
    });
    const sqInsert = statements.find(isVersionInsert);
    expect(sqInsert).toBeDefined();
    expect(() =>
      simulateVersionInsert(sqInsert!, [1, "create_payment_storage_foundation", "t", "c"]),
    ).not.toThrow();

    seenVersions.clear();
    statements.length = 0;
    await migrate(makeExecutor(), {
      dialect: "generic",
      nowIso: "2026-01-15T12:00:00.000Z",
    });
    const genericInsert = statements.find(isVersionInsert);
    expect(genericInsert).toBeDefined();
    expect(() =>
      simulateVersionInsert(genericInsert!, [1, "create_payment_storage_foundation", "t", "c"]),
    ).not.toThrow();
  });

  it("SQLFOUND-1: migrate has no portable lock and does not emit advisory lock SQL", async () => {
    // Honesty: multi-host serialize is an ops requirement, not a package guarantee.
    expect(MIGRATE_HAS_PORTABLE_LOCK).toBe(false);
    const state = createFakeDbState();
    await migrate(createFakeExecutor(state), { dialect: "postgres" });
    const joined = state.statements.join("\n").toLowerCase();
    expect(joined).not.toMatch(/pg_advisory_lock|advisory_lock|get_lock|lock table/);
    // No portable transaction wrap of multi-statement body either.
    expect(joined).not.toMatch(/\bbegin\b|\bcommit\b|\bstart transaction\b/);
  });
});

describe("verifySchema()", () => {
  it("fails when tables missing", async () => {
    const state = createFakeDbState();
    const executor = createFakeExecutor(state);
    const result = await verifySchema(executor, {
      dialect: "sqlite",
      listTables: () => [...state.tables],
    });
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("passes after migrate", async () => {
    const state = createFakeDbState();
    const executor = createFakeExecutor(state);
    await migrate(executor, { dialect: "sqlite" });
    // ensure all logical tables registered (fake create parsing)
    for (const name of expectedTablesForNamespace()) {
      state.tables.add(name);
    }
    const result = await verifySchema(executor, {
      dialect: "sqlite",
      listTables: () => [...state.tables],
    });
    expect(result.ok).toBe(true);
    expect(result.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.missing).toEqual([]);
  });

  it("reports version mismatch", async () => {
    const state = createFakeDbState();
    const executor = createFakeExecutor(state);
    await migrate(executor, { dialect: "sqlite" });
    for (const name of expectedTablesForNamespace()) {
      state.tables.add(name);
    }
    const result = await verifySchema(executor, {
      dialect: "sqlite",
      listTables: () => [...state.tables],
      expectedVersion: 99,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });
});

describe("migration metadata", () => {
  it("exports MIGRATIONS with CURRENT_SCHEMA_VERSION", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(2);
    expect(MIGRATIONS[0]!.version).toBe(1);
    expect(MIGRATIONS[1]!.version).toBe(2);
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    const ns = createSchemaNamespace({});
    expect(ns.tablePrefix).toBe("");
  });

  it("PERF-3: migrate applies a new version for list indexes after applied v1", async () => {
    const state = createFakeDbState();
    const executor = createFakeExecutor(state);
    state.migrations.set(1, {
      name: "create_payment_storage_foundation",
      appliedAt: "2026-01-01T00:00:00.000Z",
      checksum: "v1_foundation",
    });
    const result = await migrate(executor, {
      dialect: "sqlite",
      nowIso: "2026-01-15T12:00:00.000Z",
    });
    expect(result.applied).toEqual([2]);
    expect(result.alreadyApplied).toEqual([1]);
    expect(result.currentVersion).toBe(2);
    const joined = state.statements.join("\n");
    expect(joined).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_.*_st_avail/i);
    expect(joined).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_.*_st_due/i);
    expect(joined).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_.*_st_lexp/i);
    // v2 must not rewrite foundation tables (ledger CREATE TABLE is ok).
    expect(joined).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+"?payment_idempotency/i);
    expect(joined).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+"?payment_webhook_inbox/i);
    expect(joined).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+"?payment_reconciliation_jobs/i);
  });
});

describe("import does not auto-migrate", () => {
  it("constructing fake executor does not run CREATE/INSERT", () => {
    const state = createFakeDbState();
    createFakeExecutor(state);
    expect(state.statements).toEqual([]);
    expect(state.tables.size).toBe(0);
    expect(state.migrations.size).toBe(0);
  });
});
