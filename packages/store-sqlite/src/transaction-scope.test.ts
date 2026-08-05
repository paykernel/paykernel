/**
 * SQLITE-1: nestable async scope must not let concurrent outers observe
 * acquired then lose the write on outer ROLLBACK.
 */
import { describe, expect, it } from "bun:test";
import { createTransactionScope } from "./transaction-scope";

describe("createTransactionScope (SQLITE-1)", () => {
  it("serializes concurrent async outer runInTransaction scopes", async () => {
    const log: string[] = [];
    const scope = createTransactionScope((sql) => {
      log.push(sql);
    });

    let releaseA!: () => void;
    const holdA = new Promise<void>((r) => {
      releaseA = r;
    });

    const a = scope.runInTransaction(async () => {
      log.push("A-enter");
      await holdA;
      log.push("A-exit");
      return "a";
    });

    // Let A acquire outer first.
    await Promise.resolve();
    await Promise.resolve();

    let bStarted = false;
    const b = scope.runInTransaction(async () => {
      bStarted = true;
      log.push("B-enter");
      return "b";
    });

    // B must not enter while A holds the outer scope.
    await Promise.resolve();
    await Promise.resolve();
    expect(bStarted).toBe(false);
    expect(log.filter((x) => x === "B-enter")).toHaveLength(0);

    releaseA();
    await expect(a).resolves.toBe("a");
    await expect(b).resolves.toBe("b");
    expect(bStarted).toBe(true);

    // Nested join still works: only one BEGIN/COMMIT per outer.
    const begins = log.filter((s) => s.startsWith("BEGIN"));
    const commits = log.filter((s) => s === "COMMIT");
    expect(begins.length).toBe(2);
    expect(commits.length).toBe(2);
  });

  it("nested sync transaction joins open async outer without second BEGIN", async () => {
    const log: string[] = [];
    const scope = createTransactionScope((sql) => {
      log.push(sql);
    });

    await scope.runInTransaction(async () => {
      const nested = scope.transaction(() => "nested");
      expect(nested).toBe("nested");
      return "outer";
    });

    expect(log.filter((s) => s.startsWith("BEGIN"))).toHaveLength(1);
    expect(log.filter((s) => s === "COMMIT")).toHaveLength(1);
  });

  it("nested async runInTransaction joins open outer without deadlock", async () => {
    const log: string[] = [];
    const scope = createTransactionScope((sql) => {
      log.push(sql);
    });

    const result = await scope.runInTransaction(async () => {
      const nested = await scope.runInTransaction(async () => "nested");
      expect(nested).toBe("nested");
      return "outer";
    });

    expect(result).toBe("outer");
    expect(log.filter((s) => s.startsWith("BEGIN"))).toHaveLength(1);
    expect(log.filter((s) => s === "COMMIT")).toHaveLength(1);
  });

  it("throws when starting concurrent sync while an async outer is queued/running", async () => {
    const scope = createTransactionScope(() => {});

    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });

    // Do not yield microtasks: async outer has claimed ownership (owners > 0)
    // but has not yet enter()'d (depth still 0). Concurrent sync BEGIN is refuse.
    const outer = scope.runInTransaction(async () => {
      await hold;
      return true;
    });

    expect(() => scope.transaction(() => 1)).toThrow(/SQLITE-1|async runInTransaction/);

    release();
    await outer;
  });

  it("throws concurrent sync claim while async outer is mid-flight (depth > 0)", async () => {
    const log: string[] = [];
    const scope = createTransactionScope((sql) => {
      log.push(sql);
    });

    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });

    const outer = scope.runInTransaction(async () => {
      await hold;
      return true;
    });

    // Let outer enter so depth > 0, then concurrent sync must still refuse.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(() => scope.transaction(() => "joined")).toThrow(
      /SQLITE-1|async runInTransaction/,
    );

    release();
    await outer;
    expect(log.filter((s) => s.startsWith("BEGIN"))).toHaveLength(1);
  });
});
