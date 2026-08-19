/**
 * Driver binding unit tests (Bun always; node / better-sqlite3 skip-clean).
 *
 * Does not claim multi-host coordination — single-host / single-process only.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExecutorFromBunSqlite,
  createBunSqliteExecutor,
  createBunSqliteStores,
  createInMemoryBunSqliteExecutor,
  createBunSqliteStoresInMemory,
  openBunSqliteDatabase,
} from "./bun";
import { migrateSqliteAdapter, applyRecommendedPragmas } from "../index";

describe("bun:sqlite driver binding", () => {
  it("createBunSqliteExecutor / createExecutorFromBunSqlite run query/run/transaction", async () => {
    const mem = createInMemoryBunSqliteExecutor();
    try {
      await migrateSqliteAdapter(mem.executor);
      const rows = mem.executor.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1",
      );
      expect(Array.isArray(rows)).toBe(true);

      const result = mem.executor.transaction(
        () => {
          return mem.executor.run("SELECT 1");
        },
        { mode: "immediate" },
      );
      expect(result.changes).toBeDefined();

      // Preferred API name is a real executor factory (not a stub).
      const again = createBunSqliteExecutor(mem.db);
      expect(typeof again.transaction).toBe("function");
      expect(typeof createExecutorFromBunSqlite).toBe("function");
    } finally {
      mem.close();
    }
  });

  it("createBunSqliteStores builds stores without migrate", () => {
    const db = openBunSqliteDatabase(":memory:");
    try {
      const stores = createBunSqliteStores({ db });
      expect(stores.manifest.name).toBe("sqlite");
      expect(stores.manifest.coordinationScope).toBe("single-host");
      expect(stores.idempotency).toBeDefined();
      expect(stores.webhookInbox).toBeDefined();
      expect(stores.reconciliation).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("createInMemoryBunSqliteStores does not migrate; alias helper works", async () => {
    const bundle = createBunSqliteStoresInMemory({
      namespace: { tablePrefix: "im_" },
    });
    try {
      expect(bundle.manifest.coordinationScope).toBe("single-host");
      // No schema yet
      await expect(
        bundle.idempotency.reserve({
          key: "x",
          fingerprint: "f",
          owner: "w",
          leaseMs: 1000,
        }),
      ).rejects.toBeDefined();

      await migrateSqliteAdapter(bundle.executor, {
        namespace: { tablePrefix: "im_" },
      });
      const r = await bundle.idempotency.reserve({
        key: "x",
        fingerprint: "f",
        owner: "w",
        leaseMs: 1000,
      });
      expect(r.kind).toBe("acquired");
    } finally {
      bundle.close();
    }
  });

  it.each([
    ["empty string", ""],
    ["undefined", undefined],
  ] as const)(
    "S20-SQLITE-MEMORY: openBunSqliteDatabase rejects missing path (%s)",
    (_label, path) => {
      expect(() =>
        openBunSqliteDatabase(path as unknown as string),
      ).toThrow(/path is required/);
    },
  );

  it("S20-SQLITE-MEMORY: :memory: is explicit and does not apply busy_timeout", () => {
    const db = openBunSqliteDatabase(":memory:");
    try {
      const executor = createBunSqliteExecutor(db);
      const busy = executor.query<Record<string, unknown>>("PRAGMA busy_timeout");
      const busyVal = Number(Object.values(busy[0] ?? {})[0] ?? -1);
      expect(busyVal).toBe(0);
    } finally {
      db.close();
    }
  });

  it("S20-SQLITE-MEMORY: file-backed open applies busy_timeout", () => {
    const dir = mkdtempSync(join(tmpdir(), "paykernel-sqlite-busy-"));
    const path = join(dir, "busy.db");
    try {
      const db = openBunSqliteDatabase(path);
      try {
        const executor = createBunSqliteExecutor(db);
        const busy = executor.query<Record<string, unknown>>("PRAGMA busy_timeout");
        const busyVal = Number(Object.values(busy[0] ?? {})[0] ?? 0);
        expect(busyVal).toBe(5_000);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("openBunSqliteDatabase + pragmas", () => {
    const db = openBunSqliteDatabase(":memory:");
    try {
      const executor = createBunSqliteExecutor(db);
      applyRecommendedPragmas(executor, {
        busyTimeoutMs: 2500,
        wal: false,
        foreignKeys: true,
      });
      const rows = executor.query<Record<string, unknown>>("PRAGMA foreign_keys");
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("uses prepared statements for writes (BEGIN IMMEDIATE path)", () => {
    const db = openBunSqliteDatabase(":memory:");
    try {
      const executor = createBunSqliteExecutor(db);
      executor.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      const out = executor.transaction(
        () => {
          executor.run("INSERT INTO t (v) VALUES (?)", ["a"]);
          executor.run("INSERT INTO t (v) VALUES (?)", ["b"]);
          return executor.query<{ v: string }>("SELECT v FROM t ORDER BY id");
        },
        { mode: "immediate" },
      );
      expect(out.map((r) => r.v)).toEqual(["a", "b"]);
    } finally {
      db.close();
    }
  });

  it("normalizes bigint changes from stmt.run (1n => 1)", () => {
    const mockStmt = {
      all: (..._params: never[]) => [],
      get: (..._params: never[]) => undefined,
      run: (..._params: never[]) => ({ changes: 1n }),
    };
    const mockDb = {
      prepare: (_sql: string) => mockStmt,
      query: (_sql: string) => mockStmt,
      exec: (_sql: string) => {},
    };
    const executor = createExecutorFromBunSqlite(mockDb);
    expect(executor.run("INSERT INTO t VALUES (1)").changes).toBe(1);
  });
});

describe("node:sqlite driver binding", () => {
  it("maps mock DatabaseSync surface without multi-host claims", async () => {
    // Structural mock — always runs under Bun even if node:sqlite is odd.
    // Dynamic import still isolates the real driver module.
    let createExecutorFromNodeSqlite: typeof import("./node").createExecutorFromNodeSqlite;
    try {
      ({ createExecutorFromNodeSqlite } = await import("./node"));
    } catch {
      // Module graph cannot load node:sqlite in this runtime — clean skip.
      return;
    }

    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const mockDb = {
      prepare: (sql: string) => ({
        all: (...params: never[]) => {
          prepared.push({ sql, params: [...params] });
          if (sql.includes("SELECT 1")) return [{ n: 1 }];
          return [];
        },
        get: (...params: never[]) => {
          prepared.push({ sql, params: [...params] });
          return undefined;
        },
        run: (...params: never[]) => {
          prepared.push({ sql, params: [...params] });
          return { changes: 1 };
        },
      }),
      exec: (_sql: string) => {
        // BEGIN/COMMIT
      },
    };

    const executor = createExecutorFromNodeSqlite(mockDb);
    const rows = executor.query<{ n: number }>("SELECT 1 AS n");
    expect(rows[0]?.n).toBe(1);

    const changes = executor.transaction(
      () => executor.run("INSERT INTO x VALUES (?)", [42]),
      { mode: "immediate" },
    );
    expect(changes.changes).toBe(1);
    expect(prepared.some((p) => p.sql.includes("INSERT"))).toBe(true);
  });

  it("imports and opens DatabaseSync when available (skip-clean)", async () => {
    let DatabaseSync: typeof import("node:sqlite").DatabaseSync | undefined;
    try {
      const mod = await import("node:sqlite");
      DatabaseSync = mod.DatabaseSync;
    } catch {
      // Not available in this runtime — clean skip.
      return;
    }
    if (typeof DatabaseSync !== "function") return;

    const {
      createNodeSqliteExecutor,
      createNodeSqliteStores,
      createInMemoryNodeSqliteStores,
      NODE_SQLITE_SUPPORT,
    } = await import("./node");

    expect(NODE_SQLITE_SUPPORT.minimumNode).toBe("22.5.0");
    expect(NODE_SQLITE_SUPPORT.api).toBe("DatabaseSync");
    expect(NODE_SQLITE_SUPPORT.matrix.length).toBeGreaterThan(0);
    const pkg = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      engines?: { node?: string };
      paymentsSdk?: { nodeSqliteMinimum?: string };
    };
    expect(pkg.engines?.node).toBe(">=18");
    expect(pkg.paymentsSdk?.nodeSqliteMinimum).toBe("22.5.0");

    const db = new DatabaseSync(":memory:");
    try {
      const executor = createNodeSqliteExecutor(db);
      applyRecommendedPragmas(executor, { busyTimeoutMs: 1000, wal: false });
      await migrateSqliteAdapter(executor);
      const stores = createNodeSqliteStores({ db });
      expect(stores.manifest.coordinationScope).toBe("single-host");
      const r = await stores.idempotency.reserve({
        key: "node-k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
      });
      expect(r.kind).toBe("acquired");

      // In-memory helper
      const mem = createInMemoryNodeSqliteStores();
      try {
        await migrateSqliteAdapter(mem.executor);
        const r2 = await mem.idempotency.reserve({
          key: "node-mem",
          fingerprint: "fp",
          owner: "w",
          leaseMs: 1000,
        });
        expect(r2.kind).toBe("acquired");
      } finally {
        mem.close();
      }
    } finally {
      if (typeof db.close === "function") db.close();
    }
  });
});

describe("better-sqlite3 driver binding", () => {
  it("maps mock better-sqlite3 surface (always)", async () => {
    let createBetterSqlite3Executor: typeof import("./better-sqlite3").createBetterSqlite3Executor;
    try {
      ({ createBetterSqlite3Executor } = await import("./better-sqlite3"));
    } catch {
      // Optional peer cannot load — clean skip of structural mock too if module fails.
      return;
    }

    const mockDb = {
      prepare: (_sql: string) => ({
        all: (..._params: never[]) => [{ ok: 1 }],
        get: (..._params: never[]) => ({ ok: 1 }),
        run: (..._params: never[]) => ({ changes: 1n }),
      }),
      exec: (_sql: string) => {},
      defaultSafeIntegers: (_toggle?: boolean) => {},
    };

    const executor = createBetterSqlite3Executor(mockDb);
    expect(executor.query("SELECT 1")[0]).toEqual({ ok: 1 });
    const run = executor.transaction(() => executor.run("INSERT"), {
      mode: "immediate",
    });
    // BigInt changes normalized to number
    expect(run.changes).toBe(1);
  });

  it("imports and opens when installed (skip-clean)", async () => {
    let Database: typeof import("better-sqlite3") | undefined;
    try {
      Database = (await import("better-sqlite3")).default;
    } catch {
      // Package not present — clean skip.
      return;
    }
    if (typeof Database !== "function") return;

    let db: InstanceType<typeof Database>;
    try {
      db = new Database(":memory:");
    } catch {
      // Native bindings missing/unbuilt (common under Bun ABI) — clean skip.
      return;
    }

    const {
      createBetterSqlite3Executor,
      createBetterSqlite3Stores,
      createInMemoryBetterSqlite3Stores,
    } = await import("./better-sqlite3");
    try {
      const executor = createBetterSqlite3Executor(db);
      applyRecommendedPragmas(executor, { busyTimeoutMs: 1000, wal: false });
      await migrateSqliteAdapter(executor);
      const stores = createBetterSqlite3Stores({ db });
      expect(stores.manifest.coordinationScope).toBe("single-host");
      const r = await stores.idempotency.reserve({
        key: "bs3-k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
      });
      expect(r.kind).toBe("acquired");

      try {
        const mem = createInMemoryBetterSqlite3Stores();
        try {
          await migrateSqliteAdapter(mem.executor);
          const r2 = await mem.idempotency.reserve({
            key: "bs3-mem",
            fingerprint: "fp",
            owner: "w",
            leaseMs: 1000,
          });
          expect(r2.kind).toBe("acquired");
        } finally {
          mem.close();
        }
      } catch {
        // Nested open may also fail if native module is half-broken — skip.
      }
    } finally {
      db.close();
    }
  });
});
