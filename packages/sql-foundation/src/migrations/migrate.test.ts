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
    expect(first.applied).toEqual([1]);
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
    expect(second.alreadyApplied).toEqual([1]);
    expect(second.currentVersion).toBe(1);
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
    expect(result.applied).toEqual([1]);

    const expected = expectedTablesForNamespace(nsConfig);
    for (const name of expected) {
      expect(state.tables.has(name)).toBe(true);
    }

    // SQL used qualified names
    const joined = state.statements.join("\n");
    expect(joined).toContain("pay_payment_idempotency");
    expect(joined).toContain("payments");
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
    const pgInsert = pg.statements.find((s) => /INSERT INTO/i.test(s)) ?? "";
    const sqInsert = sq.statements.find((s) => /INSERT INTO/i.test(s)) ?? "";
    expect(pgInsert).toContain("$1");
    expect(sqInsert).toContain("?");
    expect(pgInsert).not.toBe(sqInsert);
    // Foundation DDL is shared intent (TEXT + CHECK) but claim templates differ elsewhere
    expect(pg.migrations.get(1)?.name).toBe("create_payment_storage_foundation");
    expect(sq.migrations.get(1)?.name).toBe("create_payment_storage_foundation");
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
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1);
    expect(MIGRATIONS[0]!.version).toBe(1);
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    const ns = createSchemaNamespace({});
    expect(ns.tablePrefix).toBe("");
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
