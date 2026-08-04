/**
 * Multi-connection concurrent claim proofs (live PG only).
 *
 * Evidence for A1 multi-host / multi-process safety: engine-level
 * INSERT ON CONFLICT / conditional UPDATE, not process mutex.
 *
 * Uses postgres-js binding with ≥2 separate clients (connections).
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import { createPostgresJsPostgresExecutor } from "./drivers/postgres-js";
import { createPostgresIdempotencyStore } from "./index";
import { migratePostgresAdapter } from "./migrate";
import {
  dropFoundationTablesSql,
  hasLivePostgres,
  PG_URL,
  uniqueTablePrefix,
} from "./test-utils/pg-env";

const live = hasLivePostgres();

describe.skipIf(!live)("multi-connection concurrent claims", () => {
  it("only one worker acquires under concurrent reserve (2 clients)", async () => {
    const postgres = await import("postgres");
    const sqlA = postgres.default(PG_URL!, { max: 1 });
    const sqlB = postgres.default(PG_URL!, { max: 1 });
    const prefix = uniqueTablePrefix("m");

    try {
      const execA = createPostgresJsPostgresExecutor(sqlA);
      await migratePostgresAdapter(execA, { namespace: { tablePrefix: prefix } });

      const clock = createFakeClock();
      const storeA = createPostgresIdempotencyStore({
        executor: execA,
        clock,
        namespace: { tablePrefix: prefix },
      });
      const storeB = createPostgresIdempotencyStore({
        executor: createPostgresJsPostgresExecutor(sqlB),
        clock,
        namespace: { tablePrefix: prefix },
      });

      const key = `race_${Date.now()}`;
      const workers = 20;
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) => {
          const store = i % 2 === 0 ? storeA : storeB;
          return store.reserve({
            key,
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
      try {
        await sqlA.unsafe(dropFoundationTablesSql(prefix));
      } catch {
        /* ignore */
      }
      await sqlA.end({ timeout: 3 });
      await sqlB.end({ timeout: 3 });
    }
  }, 60_000);

  it("stale lease token complete rejected after reclaim", async () => {
    const postgres = await import("postgres");
    const sql = postgres.default(PG_URL!, { max: 2 });
    const prefix = uniqueTablePrefix("s");
    try {
      const executor = createPostgresJsPostgresExecutor(sql);
      await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock();
      const store = createPostgresIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const r1 = await store.reserve({
        key: "stale1",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(r1.kind).toBe("acquired");
      if (r1.kind !== "acquired") return;

      clock.advance(2_000);

      const r2 = await store.reserve({
        key: "stale1",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(r2.kind).toBe("acquired");
      if (r2.kind !== "acquired") return;

      await expect(
        store.complete({ key: "stale1", leaseToken: r1.leaseToken, result: {} }),
      ).rejects.toMatchObject({ code: "lease_lost" });

      await store.complete({ key: "stale1", leaseToken: r2.leaseToken, result: { ok: true } });
      const got = await store.get("stale1");
      expect(got?.status).toBe("completed");
    } finally {
      try {
        await sql.unsafe(dropFoundationTablesSql(prefix));
      } catch {
        /* ignore */
      }
      await sql.end({ timeout: 3 });
    }
  }, 60_000);
});

describe.skipIf(live)("multi-connection skipped without URL", () => {
  it("skip pattern", () => {
    expect(PG_URL).toBeFalsy();
  });
});
