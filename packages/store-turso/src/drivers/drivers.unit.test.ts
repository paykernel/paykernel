/**
 * Driver binding unit tests (no live network).
 *
 * Proves executor mapping for libsql + serverless independently.
 * Does NOT claim untested /sync or embedded-replica guarantees.
 */
import { describe, expect, it } from "bun:test";
import {
  createExecutorFromLibsql,
  createLibsqlExecutor,
  createLibsqlStores,
} from "./libsql";
import {
  createExecutorFromServerless,
  createTursoServerlessExecutor,
  createTursoServerlessStores,
  createTursoStoresFromServerless,
} from "./serverless";

describe("libsql executor adapter", () => {
  it("maps execute/query through client.execute", async () => {
    const calls: Array<{ sql: string; args: unknown }> = [];
    const client = {
      async execute(stmt: string | { sql: string; args?: unknown }) {
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        const args = typeof stmt === "string" ? [] : (stmt.args ?? []);
        calls.push({ sql, args });
        if (sql.startsWith("SELECT")) {
          return {
            rows: [{ key: "k", status: "reserved", attempts: 1, generation: 1 }],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 1 };
      },
    };
    const exec = createExecutorFromLibsql(client);
    const rows = await exec.query("SELECT * FROM t WHERE key = ?", ["k"]);
    expect(rows[0]?.key).toBe("k");
    const write = await exec.execute("UPDATE t SET x = ?", [1]);
    expect(write.changes).toBe(1);
    expect(calls.length).toBe(2);
  });

  it("remote http protocol uses interactive client.transaction write mode", async () => {
    const modes: string[] = [];
    const txnSqls: string[] = [];
    let committed = false;
    const client = {
      protocol: "http",
      async execute() {
        return { rows: [], rowsAffected: 0 };
      },
      async transaction(mode?: string) {
        modes.push(mode ?? "default");
        return {
          async execute(stmt: string | { sql: string; args?: unknown }) {
            const sql = typeof stmt === "string" ? stmt : stmt.sql;
            txnSqls.push(sql);
            return { rows: [], rowsAffected: 0 };
          },
          async commit() {
            committed = true;
          },
          async rollback() {
            throw new Error("should not rollback on success");
          },
        };
      },
    };
    const exec = createLibsqlExecutor(client);
    expect(typeof exec.transaction).toBe("function");
    const out = await exec.transaction!(async (tx) => {
      await tx.execute("INSERT INTO t VALUES (1)", []);
      return 42;
    });
    expect(out).toBe(42);
    expect(modes).toEqual(["write"]);
    expect(txnSqls.some((s) => s.includes("INSERT"))).toBe(true);
    expect(committed).toBe(true);
  });

  it("remote interactive txn rolls back on failure", async () => {
    const events: string[] = [];
    const client = {
      protocol: "http",
      async execute() {
        return { rows: [], rowsAffected: 0 };
      },
      async transaction() {
        return {
          async execute(stmt: string | { sql: string; args?: unknown }) {
            const sql = typeof stmt === "string" ? stmt : stmt.sql;
            events.push(`exec:${sql}`);
            if (sql.includes("FAIL_ME")) throw new Error("boom");
            return { rows: [], rowsAffected: 0 };
          },
          async commit() {
            events.push("commit");
          },
          async rollback() {
            events.push("rollback");
          },
        };
      },
    };
    const exec = createLibsqlExecutor(client);
    await expect(
      exec.transaction!(async (tx) => {
        await tx.execute("INSERT INTO t VALUES (1)", []);
        await tx.execute("FAIL_ME", []);
      }),
    ).rejects.toThrow("boom");
    expect(events).toContain("rollback");
    expect(events).not.toContain("commit");
  });

  it("local file protocol uses BEGIN IMMEDIATE even if transaction exists", async () => {
    const sqls: string[] = [];
    let interactiveCalls = 0;
    const client = {
      protocol: "file",
      async execute(stmt: string | { sql: string; args?: unknown }) {
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        sqls.push(sql);
        return { rows: [], rowsAffected: 0 };
      },
      async transaction() {
        interactiveCalls += 1;
        throw new Error("local path must not use interactive transaction");
      },
    };
    const exec = createLibsqlExecutor(client);
    await exec.transaction!(async (tx) => {
      await tx.execute("INSERT INTO t VALUES (1)", []);
    });
    expect(interactiveCalls).toBe(0);
    expect(sqls[0]).toBe("BEGIN IMMEDIATE");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
  });

  it("transaction falls back to BEGIN IMMEDIATE when no interactive API", async () => {
    const sqls: string[] = [];
    const client = {
      async execute(stmt: string | { sql: string; args?: unknown }) {
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        sqls.push(sql);
        return { rows: [], rowsAffected: 0 };
      },
    };
    const exec = createLibsqlExecutor(client);
    await exec.transaction!(async (tx) => {
      await tx.execute("INSERT INTO t VALUES (1)", []);
    });
    expect(sqls[0]).toBe("BEGIN IMMEDIATE");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
  });

  it("omitted protocol with transaction() uses interactive write (not BEGIN IMMEDIATE)", async () => {
    const modes: string[] = [];
    const clientSqls: string[] = [];
    let committed = false;
    const client = {
      async execute(stmt: string | { sql: string; args?: unknown }) {
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        clientSqls.push(sql);
        return { rows: [], rowsAffected: 0 };
      },
      async transaction(mode?: string) {
        modes.push(mode ?? "default");
        return {
          async execute() {
            return { rows: [], rowsAffected: 0 };
          },
          async commit() {
            committed = true;
          },
          async rollback() {
            throw new Error("should not rollback on success");
          },
        };
      },
    };
    const exec = createLibsqlExecutor(client);
    await exec.transaction!(async (tx) => {
      await tx.execute("INSERT INTO t VALUES (1)", []);
    });
    expect(modes).toEqual(["write"]);
    expect(committed).toBe(true);
    expect(clientSqls.some((s) => s === "BEGIN IMMEDIATE")).toBe(false);
  });

  it("overlapping executor.transaction calls do not share a stream", async () => {
    const txnObjects: object[] = [];
    let releaseFirst!: () => void;
    const firstHold = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const client = {
      protocol: "http",
      async execute() {
        return { rows: [], rowsAffected: 0 };
      },
      async transaction() {
        const txn = {
          async execute() {
            return { rows: [], rowsAffected: 0 };
          },
          async commit() {},
          async rollback() {},
        };
        txnObjects.push(txn);
        return txn;
      },
    };
    const exec = createLibsqlExecutor(client);
    const first = exec.transaction!(async () => {
      await firstHold;
      return "a";
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await expect(exec.transaction!(async () => "b")).rejects.toThrow(
      /already has a write transaction/i,
    );
    releaseFirst();
    await expect(first).resolves.toBe("a");
    expect(txnObjects.length).toBe(1);
  });

  it("refuses file protocol + syncUrl embedded replica by default", () => {
    const client = {
      protocol: "file",
      async execute() {
        return { rows: [], rowsAffected: 0 };
      },
    };
    expect(() =>
      createLibsqlStores({
        client,
        syncUrl: "libsql://example.turso.io",
      }),
    ).toThrow(/embedded replica|not multi-host/i);
  });

  it("refuses client with syncUrl replica field", () => {
    const client = {
      protocol: "file",
      syncUrl: "libsql://example.turso.io",
      async execute() {
        return { rows: [], rowsAffected: 0 };
      },
    };
    expect(() => createExecutorFromLibsql(client)).toThrow(/embedded replica/i);
  });

  it("batch uses client.batch with write mode when available", async () => {
    const batches: Array<{ stmts: unknown; mode?: string }> = [];
    const client = {
      async execute() {
        return { rows: [], rowsAffected: 0 };
      },
      async batch(stmts: unknown[], mode?: string) {
        batches.push({ stmts, mode });
      },
    };
    const exec = createLibsqlExecutor(client);
    expect(typeof exec.batch).toBe("function");
    await exec.batch!([
      { sql: "INSERT INTO t VALUES (?)", params: [1] },
      { sql: "INSERT INTO t VALUES (?)", params: [2] },
    ]);
    expect(batches.length).toBe(1);
    expect(batches[0]!.mode).toBe("write");
    expect((batches[0]!.stmts as unknown[]).length).toBe(2);
  });

  it("createLibsqlStores builds bundle without migrate", () => {
    const client = {
      async execute() {
        return { rows: [], rowsAffected: 0 };
      },
    };
    const stores = createLibsqlStores({ client });
    expect(stores.idempotency).toBeDefined();
    expect(stores.webhookInbox).toBeDefined();
    expect(stores.reconciliation).toBeDefined();
    expect(stores.manifest.name).toBe("turso");
  });

  it("strips numeric indices from array-like rows", async () => {
    const row = Object.assign([1, "k"], { 0: 1, 1: "k", key: "k", status: "reserved" });
    const client = {
      async execute() {
        return { rows: [row as unknown as Record<string, unknown>], rowsAffected: 0 };
      },
    };
    const exec = createLibsqlExecutor(client);
    const rows = await exec.query("SELECT * FROM t", []);
    expect(rows[0]?.key).toBe("k");
    expect(rows[0]?.["0"]).toBeUndefined();
  });
});

describe("serverless executor adapter", () => {
  it("maps all/run to query/execute", async () => {
    const calls: string[] = [];
    const connection = {
      async all(sql: string, ..._args: unknown[]) {
        calls.push(`all:${sql}`);
        return [{ key: "a" }];
      },
      async run(sql: string, ..._args: unknown[]) {
        calls.push(`run:${sql}`);
        return { changes: 2 };
      },
    };
    const exec = createExecutorFromServerless(connection);
    const rows = await exec.query("SELECT 1", []);
    expect(rows[0]?.key).toBe("a");
    const w = await exec.execute("UPDATE t SET x=1", []);
    expect(w.changes).toBe(2);
    expect(calls[0]).toContain("all:");
    expect(calls[1]).toContain("run:");
  });

  it("binds positional params via all/run rest args", async () => {
    const seen: unknown[][] = [];
    const connection = {
      async all(sql: string, ...args: unknown[]) {
        seen.push(["all", sql, ...args]);
        return [];
      },
      async run(sql: string, ...args: unknown[]) {
        seen.push(["run", sql, ...args]);
        return { rowsAffected: 1 };
      },
    };
    const exec = createTursoServerlessExecutor(connection);
    await exec.query("SELECT ? AS x", [9]);
    await exec.execute("UPDATE t SET x = ?", [3]);
    expect(seen[0]).toEqual(["all", "SELECT ? AS x", 9]);
    expect(seen[1]).toEqual(["run", "UPDATE t SET x = ?", 3]);
  });

  it("batch uses connection.batch with immediate mode", async () => {
    const batches: Array<{ stmts: unknown; mode?: string }> = [];
    const connection = {
      async all() {
        return [];
      },
      async run() {
        return { changes: 0 };
      },
      async batch(stmts: unknown[], mode?: string) {
        batches.push({ stmts, mode });
      },
    };
    const exec = createTursoServerlessExecutor(connection);
    await exec.batch!([{ sql: "INSERT INTO t VALUES (?)", params: ["a"] }]);
    expect(batches.length).toBe(1);
    expect(batches[0]!.mode).toBe("immediate");
  });

  it("transactionAsync maps to executor.transaction (immediate when present)", async () => {
    let sawTx = false;
    const connection = {
      async all() {
        return [];
      },
      async run() {
        return { changes: 0 };
      },
      transactionAsync(fn: (tx: { all: typeof connection.all; run: typeof connection.run }) => unknown) {
        const wrapped = Object.assign(
          async () => {
            sawTx = true;
            return fn({
              all: async () => [{ ok: 1 }],
              run: async () => ({ changes: 1 }),
            });
          },
          {
            immediate: async () => {
              sawTx = true;
              return fn({
                all: async () => [{ ok: 1 }],
                run: async () => ({ changes: 1 }),
              });
            },
          },
        );
        return wrapped;
      },
    };
    const exec = createTursoServerlessExecutor(connection);
    expect(typeof exec.transaction).toBe("function");
    const out = await exec.transaction!(async (tx) => {
      const rows = await tx.query("SELECT 1", []);
      return rows[0];
    });
    expect(sawTx).toBe(true);
    expect(out).toEqual({ ok: 1 });
  });

  it("accepts client alias for connection in store factories", () => {
    const connection = {
      async all() {
        return [];
      },
      async run() {
        return { changes: 0 };
      },
    };
    const a = createTursoServerlessStores({ connection });
    const b = createTursoStoresFromServerless({ client: connection });
    expect(a.manifest.name).toBe("turso");
    expect(b.idempotency).toBeDefined();
  });

  it("throws when neither connection nor client provided", () => {
    expect(() => createTursoServerlessStores({} as never)).toThrow(/connection|client/i);
  });
});
