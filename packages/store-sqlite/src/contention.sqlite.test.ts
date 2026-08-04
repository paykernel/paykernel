/**
 * Multi-connection same-file claim contention (single-host).
 */
import { describe, expect, it, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSqliteIdempotencyStore,
  createSqliteWebhookInboxStore,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "./index";
import {
  createExecutorFromBunSqlite,
  openBunSqliteDatabase,
} from "./drivers/bun";

describe("sqlite multi-connection contention", () => {
  const dir = mkdtempSync(join(tmpdir(), "payments-sqlite-ct-"));
  const path = join(dir, "contention.db");

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("only one connection acquires reserve for the same key", async () => {
    const bootstrap = openBunSqliteDatabase(path);
    const bootExec = createExecutorFromBunSqlite(bootstrap);
    applyRecommendedPragmas(bootExec, { busyTimeoutMs: 5_000, wal: true });
    await migrateSqliteAdapter(bootExec, { namespace: { tablePrefix: "ct_" } });
    bootstrap.close();

    const dbA = openBunSqliteDatabase(path);
    const dbB = openBunSqliteDatabase(path);
    const execA = createExecutorFromBunSqlite(dbA);
    const execB = createExecutorFromBunSqlite(dbB);
    applyRecommendedPragmas(execA, { busyTimeoutMs: 5_000 });
    applyRecommendedPragmas(execB, { busyTimeoutMs: 5_000 });

    const storeA = createSqliteIdempotencyStore({
      executor: execA,
      namespace: { tablePrefix: "ct_" },
    });
    const storeB = createSqliteIdempotencyStore({
      executor: execB,
      namespace: { tablePrefix: "ct_" },
    });

    try {
      const [rA, rB] = await Promise.all([
        storeA.reserve({
          key: "shared",
          fingerprint: "fp",
          owner: "a",
          leaseMs: 30_000,
        }),
        storeB.reserve({
          key: "shared",
          fingerprint: "fp",
          owner: "b",
          leaseMs: 30_000,
        }),
      ]);

      const kinds = [rA.kind, rB.kind].sort();
      // Exactly one acquired; the other in_progress (or rarely both serialized such that second is in_progress)
      const acquired = [rA, rB].filter((r) => r.kind === "acquired");
      const blocked = [rA, rB].filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(blocked.length).toBe(1);
      expect(kinds).toContain("acquired");
      expect(kinds).toContain("in_progress");
    } finally {
      dbA.close();
      dbB.close();
    }
  });

  it("many concurrent reserves on two connections → exactly one acquired", async () => {
    const path2 = join(dir, "contention-many.db");
    const bootstrap = openBunSqliteDatabase(path2);
    const bootExec = createExecutorFromBunSqlite(bootstrap);
    applyRecommendedPragmas(bootExec, { busyTimeoutMs: 5_000, wal: true });
    await migrateSqliteAdapter(bootExec, { namespace: { tablePrefix: "ctm_" } });
    bootstrap.close();

    const dbA = openBunSqliteDatabase(path2);
    const dbB = openBunSqliteDatabase(path2);
    const execA = createExecutorFromBunSqlite(dbA);
    const execB = createExecutorFromBunSqlite(dbB);
    applyRecommendedPragmas(execA, { busyTimeoutMs: 5_000 });
    applyRecommendedPragmas(execB, { busyTimeoutMs: 5_000 });
    const storeA = createSqliteIdempotencyStore({
      executor: execA,
      namespace: { tablePrefix: "ctm_" },
    });
    const storeB = createSqliteIdempotencyStore({
      executor: execB,
      namespace: { tablePrefix: "ctm_" },
    });

    try {
      const workers = 16;
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) => {
          const store = i % 2 === 0 ? storeA : storeB;
          return store.reserve({
            key: "race-many",
            fingerprint: "fp",
            owner: `w${i}`,
            leaseMs: 30_000,
          });
        }),
      );
      const acquired = results.filter((r) => r.kind === "acquired");
      const inProgress = results.filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(inProgress.length).toBe(workers - 1);
    } finally {
      dbA.close();
      dbB.close();
    }
  });

  it("webhook multi-connection claim → one winner", async () => {
    const path3 = join(dir, "contention-wh.db");
    const bootstrap = openBunSqliteDatabase(path3);
    const bootExec = createExecutorFromBunSqlite(bootstrap);
    applyRecommendedPragmas(bootExec, { busyTimeoutMs: 5_000, wal: true });
    await migrateSqliteAdapter(bootExec, { namespace: { tablePrefix: "ctw_" } });
    bootstrap.close();

    const dbA = openBunSqliteDatabase(path3);
    const dbB = openBunSqliteDatabase(path3);
    const execA = createExecutorFromBunSqlite(dbA);
    const execB = createExecutorFromBunSqlite(dbB);
    applyRecommendedPragmas(execA, { busyTimeoutMs: 5_000 });
    applyRecommendedPragmas(execB, { busyTimeoutMs: 5_000 });
    const storeA = createSqliteWebhookInboxStore({
      executor: execA,
      namespace: { tablePrefix: "ctw_" },
    });
    const storeB = createSqliteWebhookInboxStore({
      executor: execB,
      namespace: { tablePrefix: "ctw_" },
    });

    try {
      const results = await Promise.all([
        storeA.claim({
          key: "evt-race",
          payloadHash: "h",
          owner: "a",
          leaseMs: 30_000,
        }),
        storeB.claim({
          key: "evt-race",
          payloadHash: "h",
          owner: "b",
          leaseMs: 30_000,
        }),
      ]);
      const acquired = results.filter((r) => r.kind === "acquired");
      expect(acquired.length).toBe(1);
    } finally {
      dbA.close();
      dbB.close();
    }
  });
});
