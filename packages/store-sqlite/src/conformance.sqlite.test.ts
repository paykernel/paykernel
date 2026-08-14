/**
 * Store conformance — Bun (always) + node:sqlite / better-sqlite3 (skip-clean).
 */
import { describe, expect, it, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
  type StoreConformanceReport,
} from "@paykernel/testkit";
import {
  createSqliteIdempotencyStore,
  createSqliteWebhookInboxStore,
  createSqliteReconciliationStore,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "./index";
import {
  createInMemoryBunSqliteExecutor,
  createInMemoryBunSqliteStores,
  createExecutorFromBunSqlite,
  openBunSqliteDatabase,
} from "./drivers/bun";
import type { SqliteExecutor } from "./executor";

function assertSuiteOk(report: StoreConformanceReport): void {
  expect(
    report.ok,
    JSON.stringify(
      report.results.filter((r) => !r.ok),
      null,
      2,
    ),
  ).toBe(true);
}

async function runAllSuites(
  name: string,
  executor: SqliteExecutor,
  prefix: string,
): Promise<void> {
  await migrateSqliteAdapter(executor, { namespace: { tablePrefix: prefix } });

  const idempotency = await runIdempotencyStoreConformanceSuite({
    name: `${name}-idempotency`,
    createStore: async ({ clock }) =>
      createSqliteIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(idempotency);

  const webhook = await runWebhookInboxStoreConformanceSuite({
    name: `${name}-webhook`,
    createStore: async ({ clock }) =>
      createSqliteWebhookInboxStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(webhook);

  const recon = await runReconciliationStoreConformanceSuite({
    name: `${name}-recon`,
    createStore: async ({ clock }) =>
      createSqliteReconciliationStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(recon);
}

describe("sqlite conformance (bun memory)", () => {
  it("passes all three store suites", async () => {
    const mem = createInMemoryBunSqliteExecutor();
    try {
      await runAllSuites("bun-memory", mem.executor, "cm_");
    } finally {
      mem.close();
    }
  });

  it("passes via createInMemoryBunSqliteStores helper", async () => {
    const bundle = createInMemoryBunSqliteStores({
      namespace: { tablePrefix: "cms_" },
    });
    try {
      await runAllSuites("bun-memory-bundle", bundle.executor, "cms_");
    } finally {
      bundle.close();
    }
  });
});

describe("sqlite conformance (bun file-backed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "payments-sqlite-"));
  const path = join(dir, "conformance.db");

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("passes all three store suites on file DB with WAL", async () => {
    const db = openBunSqliteDatabase(path);
    const executor = createExecutorFromBunSqlite(db);
    applyRecommendedPragmas(executor, { busyTimeoutMs: 5_000, wal: true });
    try {
      await runAllSuites("bun-file", executor, "cf_");
    } finally {
      db.close();
    }
  });
});

async function probeNodeSqlite(): Promise<boolean> {
  try {
    const mod = await import("node:sqlite");
    return typeof mod.DatabaseSync === "function";
  } catch {
    return false;
  }
}

async function probeBetterSqlite3(): Promise<boolean> {
  try {
    const Database = (await import("better-sqlite3")).default;
    if (typeof Database !== "function") return false;
    const probe = new Database(":memory:");
    probe.close();
    return true;
  } catch {
    return false;
  }
}

const hasNodeSqlite = await probeNodeSqlite();
const hasBetterSqlite3 = await probeBetterSqlite3();

// P1315-TEST-1: unavailable drivers must describe.skip / it.skip — never a
// silent return that bun reports as a passing test with no expect.
(hasNodeSqlite ? describe : describe.skip)(
  "sqlite conformance (node:sqlite skip-clean)",
  () => {
    it("passes all three suites when node:sqlite is available", async () => {
      const { createInMemoryNodeSqliteExecutor } = await import("./drivers/node");
      const mem = createInMemoryNodeSqliteExecutor();
      try {
        await runAllSuites("node-memory", mem.executor, "cn_");
      } finally {
        mem.close();
      }
    });
  },
);

(hasBetterSqlite3 ? describe : describe.skip)(
  "sqlite conformance (better-sqlite3 skip-clean)",
  () => {
    it("passes all three suites when better-sqlite3 loads", async () => {
      const { createInMemoryBetterSqlite3Executor } = await import(
        "./drivers/better-sqlite3"
      );
      const mem = createInMemoryBetterSqlite3Executor();
      try {
        await runAllSuites("bs3-memory", mem.executor, "cb_");
      } finally {
        mem.close();
      }
    });
  },
);
