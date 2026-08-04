/**
 * File-backed restart durability: state survives close/reopen.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSqliteIdempotencyStore,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "./index";
import {
  createExecutorFromBunSqlite,
  openBunSqliteDatabase,
} from "./drivers/bun";

describe("sqlite file restart durability", () => {
  it("completed idempotency record survives process-like reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-sqlite-rs-"));
    const path = join(dir, "restart.db");
    try {
      {
        const db = openBunSqliteDatabase(path);
        const executor = createExecutorFromBunSqlite(db);
        applyRecommendedPragmas(executor, { busyTimeoutMs: 2000, wal: true });
        await migrateSqliteAdapter(executor, { namespace: { tablePrefix: "rs_" } });
        const store = createSqliteIdempotencyStore({
          executor,
          namespace: { tablePrefix: "rs_" },
        });
        const r = await store.reserve({
          key: "durable",
          fingerprint: "fp",
          owner: "w",
          leaseMs: 10_000,
        });
        expect(r.kind).toBe("acquired");
        if (r.kind !== "acquired") return;
        await store.complete({
          key: "durable",
          leaseToken: r.leaseToken,
          result: { v: 1 },
        });
        db.close();
      }

      {
        const db = openBunSqliteDatabase(path);
        const executor = createExecutorFromBunSqlite(db);
        const store = createSqliteIdempotencyStore({
          executor,
          namespace: { tablePrefix: "rs_" },
        });
        const got = await store.get("durable");
        expect(got?.status).toBe("completed");
        const again = await store.reserve({
          key: "durable",
          fingerprint: "fp",
          owner: "w2",
          leaseMs: 10_000,
        });
        expect(again.kind).toBe("already_completed");
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
