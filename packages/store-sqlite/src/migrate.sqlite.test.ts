/**
 * migrateSqliteAdapter / verifySqliteAdapterSchema unit+integration.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateSqliteAdapter,
  verifySqliteAdapterSchema,
  applyRecommendedPragmas,
  createSqliteIdempotencyStore,
} from "./index";
import {
  createInMemoryBunSqliteExecutor,
  createExecutorFromBunSqlite,
  openBunSqliteDatabase,
} from "./drivers/bun";

describe("migrateSqliteAdapter", () => {
  it("applies foundation schema on memory and is idempotent", async () => {
    const mem = createInMemoryBunSqliteExecutor();
    try {
      const r1 = await migrateSqliteAdapter(mem.executor);
      expect(r1.applied.length).toBeGreaterThan(0);
      expect(r1.currentVersion).toBeGreaterThan(0);

      const r2 = await migrateSqliteAdapter(mem.executor);
      expect(r2.applied.length).toBe(0);
      expect(r2.alreadyApplied.length).toBeGreaterThan(0);

      const v = await verifySqliteAdapterSchema(mem.executor);
      expect(v.ok).toBe(true);
    } finally {
      mem.close();
    }
  });

  it("respects tablePrefix namespace", async () => {
    const mem = createInMemoryBunSqliteExecutor();
    try {
      await migrateSqliteAdapter(mem.executor, {
        namespace: { tablePrefix: "ns_" },
      });
      const store = createSqliteIdempotencyStore({
        executor: mem.executor,
        namespace: { tablePrefix: "ns_" },
      });
      const r = await store.reserve({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
      });
      expect(r.kind).toBe("acquired");
    } finally {
      mem.close();
    }
  });

  it("migrates file-backed database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-sqlite-mig-"));
    const path = join(dir, "mig.db");
    try {
      const db = openBunSqliteDatabase(path);
      const executor = createExecutorFromBunSqlite(db);
      applyRecommendedPragmas(executor, { busyTimeoutMs: 1000, wal: true });
      const r = await migrateSqliteAdapter(executor);
      expect(r.applied.length).toBeGreaterThan(0);
      const v = await verifySqliteAdapterSchema(executor);
      expect(v.ok).toBe(true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
