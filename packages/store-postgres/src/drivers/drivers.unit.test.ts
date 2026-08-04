/**
 * Driver binding smoke tests — construct executors without connecting.
 * Asserts executor port behavior and alias parity (not that factories are functions).
 */
import { describe, expect, it } from "bun:test";
import { isPostgresExecutor } from "../executor";
import {
  createExecutorFromPg,
  createPgPostgresExecutor,
  createPostgresStoresFromPg,
  type PgPoolLike,
} from "./pg";
import {
  createExecutorFromPostgresJs,
  createPostgresJsPostgresExecutor,
  createPostgresStoresFromPostgresJs,
  type PostgresJsSql,
} from "./postgres-js";
import {
  createExecutorFromBunSql,
  createBunSqlPostgresExecutor,
  createPostgresStoresFromBunSql,
  type BunSqlClient,
} from "./bun-sql";
import {
  DRIZZLE_ADAPTER_NOTES,
  createPostgresStoresWithDrizzleExecutor,
} from "./drizzle";

describe("pg binding (no connect)", () => {
  const client: PgPoolLike = {
    query: async () => ({ rows: [{ n: 1 }], rowCount: 1 }),
  };

  it("aliases produce equivalent PostgresExecutor ports", async () => {
    const a = createExecutorFromPg(client);
    const b = createPgPostgresExecutor(client);
    expect(isPostgresExecutor(a)).toBe(true);
    expect(isPostgresExecutor(b)).toBe(true);
    expect(await a.query("select 1")).toEqual([{ n: 1 }]);
    expect(await b.execute("select 1")).toEqual({ rowCount: 1 });
    expect(a.withTransaction).toBeUndefined();
  });

  it("pool-like client exposes withTransaction", () => {
    const pool: PgPoolLike = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => {},
      }),
    };
    expect(typeof createPgPostgresExecutor(pool).withTransaction).toBe("function");
  });

  it("store bundle shares one adapted executor without connecting", () => {
    const stores = createPostgresStoresFromPg({ client });
    expect(isPostgresExecutor(stores.executor)).toBe(true);
    expect(stores.manifest.name).toBe("postgres");
  });
});

describe("postgres-js binding (no connect)", () => {
  const sql: PostgresJsSql = {
    unsafe: async () => [{ n: 1 }] as never,
  };

  it("aliases produce equivalent PostgresExecutor ports", async () => {
    const a = createExecutorFromPostgresJs(sql);
    const b = createPostgresJsPostgresExecutor(sql);
    expect(isPostgresExecutor(a)).toBe(true);
    expect(await a.query("select 1", [1])).toEqual([{ n: 1 }]);
    expect(await b.execute("select 1")).toEqual({ rowCount: 1 });
  });

  it("begin-capable client exposes withTransaction", () => {
    const withBegin: PostgresJsSql = {
      unsafe: async () => [],
      begin: async (fn) => fn({ unsafe: async () => [] }),
    };
    expect(typeof createPostgresJsPostgresExecutor(withBegin).withTransaction).toBe(
      "function",
    );
  });

  it("store bundle constructs without connecting", () => {
    const stores = createPostgresStoresFromPostgresJs({ sql });
    expect(stores.idempotency).toBeDefined();
    expect(stores.webhookInbox).toBeDefined();
    expect(stores.reconciliation).toBeDefined();
  });
});

describe("bun-sql binding (no connect)", () => {
  const client: BunSqlClient = {
    unsafe: async () => [{ n: 1 }],
  };

  it("aliases produce equivalent PostgresExecutor ports", async () => {
    const a = createExecutorFromBunSql(client);
    const b = createBunSqlPostgresExecutor(client);
    expect(isPostgresExecutor(a)).toBe(true);
    expect(await a.query("select 1")).toEqual([{ n: 1 }]);
    expect(await b.execute("select 1")).toEqual({ rowCount: 1 });
  });

  it("rejects clients without unsafe for $n prepared statements", async () => {
    const bare: BunSqlClient = {};
    await expect(createBunSqlPostgresExecutor(bare).query("select 1")).rejects.toThrow(
      /unsafe/,
    );
  });

  it("store bundle constructs without connecting", () => {
    const stores = createPostgresStoresFromBunSql({ sql: client });
    expect(stores.manifest.coordinationScope).toBe("multi-host");
  });
});

describe("drizzle binding (optional, no drizzle-orm import)", () => {
  it("wires stores from a prebuilt executor without importing drizzle-orm", async () => {
    expect(DRIZZLE_ADAPTER_NOTES.length).toBeGreaterThan(0);
    const executor = {
      async query() {
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    };
    const stores = createPostgresStoresWithDrizzleExecutor({ executor });
    expect(stores.executor).toBe(executor);
    const src = await Bun.file(new URL("./drizzle.ts", import.meta.url)).text();
    expect(src.includes('from "drizzle-orm"')).toBe(false);
    expect(src.includes("from 'drizzle-orm'")).toBe(false);
  });
});
