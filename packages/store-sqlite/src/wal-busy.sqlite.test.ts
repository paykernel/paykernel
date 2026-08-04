/**
 * WAL + busy_timeout helpers and multi-connection busy evidence.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRecommendedPragmas, migrateSqliteAdapter } from "./index";
import {
  createExecutorFromBunSqlite,
  openBunSqliteDatabase,
  createInMemoryBunSqliteExecutor,
} from "./drivers/bun";

describe("applyRecommendedPragmas", () => {
  it("sets busy_timeout and foreign_keys on memory", () => {
    const mem = createInMemoryBunSqliteExecutor({ busyTimeoutMs: 1234 });
    try {
      const fk = mem.executor.query<Record<string, unknown>>("PRAGMA foreign_keys");
      // foreign_keys result column name varies; value should be 1
      const row = fk[0] ?? {};
      const val = Object.values(row)[0];
      expect(Number(val)).toBe(1);

      const busy = mem.executor.query<Record<string, unknown>>("PRAGMA busy_timeout");
      const busyVal = Object.values(busy[0] ?? {})[0];
      expect(Number(busyVal)).toBe(1234);
    } finally {
      mem.close();
    }
  });

  it("enables WAL on file-backed DB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-sqlite-wal-"));
    const path = join(dir, "wal.db");
    try {
      const db = openBunSqliteDatabase(path);
      const executor = createExecutorFromBunSqlite(db);
      applyRecommendedPragmas(executor, { busyTimeoutMs: 2000, wal: true });
      await migrateSqliteAdapter(executor);
      const mode = executor.query<Record<string, unknown>>("PRAGMA journal_mode");
      const val = String(Object.values(mode[0] ?? {})[0] ?? "").toLowerCase();
      expect(val).toBe("wal");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("busy_timeout allows a second connection to wait and succeed (worker)", async () => {
    // Evidence: with busy_timeout > lock hold time, waiter acquires after release.
    // Uses a subprocess so the lock is held on a true second connection/thread.
    const dir = mkdtempSync(join(tmpdir(), "payments-sqlite-busy-"));
    const path = join(dir, "busy.db");
    try {
      {
        const boot = openBunSqliteDatabase(path);
        const exec = createExecutorFromBunSqlite(boot);
        applyRecommendedPragmas(exec, { busyTimeoutMs: 5_000, wal: true });
        exec.run("CREATE TABLE busy_probe (id INTEGER PRIMARY KEY, v TEXT)");
        boot.close();
      }

      const lockHoldMs = 120;
      const holderScript = `
        import { Database } from "bun:sqlite";
        const db = new Database(${JSON.stringify(path)});
        db.exec("PRAGMA busy_timeout = 5000");
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("BEGIN IMMEDIATE");
        db.exec("INSERT INTO busy_probe (v) VALUES ('holder')");
        // Signal ready via stdout then hold lock.
        console.log("LOCKED");
        await Bun.sleep(${lockHoldMs});
        db.exec("COMMIT");
        db.close();
      `;

      const proc = Bun.spawn(["bun", "-e", holderScript], {
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait until holder has the lock.
      const reader = proc.stdout.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 5_000;
      while (!buf.includes("LOCKED") && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
      }
      expect(buf.includes("LOCKED")).toBe(true);

      const waiter = openBunSqliteDatabase(path);
      const wExec = createExecutorFromBunSqlite(waiter);
      applyRecommendedPragmas(wExec, { busyTimeoutMs: 5_000, wal: true });

      const started = Date.now();
      // This should block until holder commits, then succeed.
      const result = wExec.transaction(
        () => wExec.run("INSERT INTO busy_probe (v) VALUES (?)", ["waiter"]),
        { mode: "immediate" },
      );
      const elapsed = Date.now() - started;
      expect(result.changes).toBe(1);
      // Should have waited a non-trivial amount (holder hold time), not fail immediately.
      expect(elapsed).toBeGreaterThanOrEqual(lockHoldMs - 40);

      const rows = wExec.query<{ v: string }>(
        "SELECT v FROM busy_probe ORDER BY id",
      );
      expect(rows.map((r) => r.v).sort()).toEqual(["holder", "waiter"]);
      waiter.close();

      const exit = await proc.exited;
      expect(exit).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it("busy_timeout=0 fails quickly under concurrent writer lock (worker)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-sqlite-busy0-"));
    const path = join(dir, "busy0.db");
    try {
      {
        const boot = openBunSqliteDatabase(path);
        const exec = createExecutorFromBunSqlite(boot);
        // No busy wait
        applyRecommendedPragmas(exec, { busyTimeoutMs: 0, wal: true });
        exec.run("CREATE TABLE busy0 (id INTEGER PRIMARY KEY, v TEXT)");
        boot.close();
      }

      const holderScript = `
        import { Database } from "bun:sqlite";
        const db = new Database(${JSON.stringify(path)});
        db.exec("PRAGMA busy_timeout = 0");
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("BEGIN IMMEDIATE");
        db.exec("INSERT INTO busy0 (v) VALUES ('holder')");
        console.log("LOCKED");
        await Bun.sleep(400);
        db.exec("COMMIT");
        db.close();
      `;

      const proc = Bun.spawn(["bun", "-e", holderScript], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const reader = proc.stdout.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 5_000;
      while (!buf.includes("LOCKED") && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
      }
      expect(buf.includes("LOCKED")).toBe(true);

      const waiter = openBunSqliteDatabase(path);
      const wExec = createExecutorFromBunSqlite(waiter);
      applyRecommendedPragmas(wExec, { busyTimeoutMs: 0, wal: true });

      let threw = false;
      try {
        wExec.transaction(
          () => wExec.run("INSERT INTO busy0 (v) VALUES (?)", ["waiter"]),
          { mode: "immediate" },
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      waiter.close();
      await proc.exited;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
