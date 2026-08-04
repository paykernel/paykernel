/**
 * Restart / lease-reclaim: reopen mock D1 on same file proves durable leases.
 *
 * Simulates Worker A claims → drop instance → Worker B reclaims after FakeClock
 * advance or completes with a valid lease token across reopen.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeClock, StoreLeaseLostError } from "@paykernel/testkit";
import {
  createD1IdempotencyStore,
  createD1Executor,
  migrateD1Adapter,
} from "./index";
import { createMockD1 } from "./test-utils/mock-d1";
import { uniqueTablePrefix } from "./test-utils/d1-env";

describe("d1 restart / durable lease reclaim", () => {
  it("lease survives process-like reopen and reclaim after FakeClock advance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-d1-"));
    const path = join(dir, "restart.db");
    try {
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const prefix = uniqueTablePrefix("rs");

      // Instance 1: migrate + reserve
      {
        const h1 = createMockD1({ path });
        try {
          const ex1 = createD1Executor(h1.db);
          await migrateD1Adapter(ex1, { namespace: { tablePrefix: prefix } });
          const store1 = createD1IdempotencyStore({
            executor: ex1,
            clock,
            namespace: { tablePrefix: prefix },
          });
          const r = await store1.reserve({
            key: "durable-key",
            fingerprint: "fp",
            owner: "worker-a",
            leaseMs: 10_000,
          });
          expect(r.kind).toBe("acquired");
        } finally {
          h1.close();
        }
      }

      // Instance 2: reopen same file — lease still held until expiry
      {
        const h2 = createMockD1({ path });
        try {
          const ex2 = createD1Executor(h2.db);
          const store2 = createD1IdempotencyStore({
            executor: ex2,
            clock,
            namespace: { tablePrefix: prefix },
          });
          const mid = await store2.reserve({
            key: "durable-key",
            fingerprint: "fp",
            owner: "worker-b",
            leaseMs: 10_000,
          });
          expect(mid.kind).toBe("in_progress");

          clock.advance(11_000);

          const reclaim = await store2.reserve({
            key: "durable-key",
            fingerprint: "fp",
            owner: "worker-b",
            leaseMs: 10_000,
          });
          expect(reclaim.kind).toBe("acquired");
          if (reclaim.kind === "acquired") {
            expect(reclaim.record.generation).toBeGreaterThanOrEqual(2);
            expect(reclaim.record.leaseOwner).toBe("worker-b");
          }
        } finally {
          h2.close();
        }
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("store B completes with lease token from store A after restart (no reclaim needed)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-d1-"));
    const path = join(dir, "restart-complete.db");
    try {
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const prefix = uniqueTablePrefix("rc");
      let leaseToken = "";

      {
        const h1 = createMockD1({ path });
        try {
          const ex1 = createD1Executor(h1.db);
          await migrateD1Adapter(ex1, { namespace: { tablePrefix: prefix } });
          const storeA = createD1IdempotencyStore({
            executor: ex1,
            clock,
            namespace: { tablePrefix: prefix },
          });
          const r = await storeA.reserve({
            key: "handoff-key",
            fingerprint: "fp",
            owner: "worker-a",
            leaseMs: 60_000,
          });
          expect(r.kind).toBe("acquired");
          if (r.kind === "acquired") leaseToken = r.leaseToken;
        } finally {
          h1.close();
        }
      }

      {
        const h2 = createMockD1({ path });
        try {
          const ex2 = createD1Executor(h2.db);
          const storeB = createD1IdempotencyStore({
            executor: ex2,
            clock,
            namespace: { tablePrefix: prefix },
          });

          // Wrong token → lease lost even after restart
          await expect(
            storeB.complete({
              key: "handoff-key",
              leaseToken: "not-the-token",
              result: {},
            }),
          ).rejects.toBeInstanceOf(StoreLeaseLostError);

          await storeB.complete({
            key: "handoff-key",
            leaseToken,
            result: { ok: true },
          });
          const got = await storeB.get("handoff-key");
          expect(got?.status).toBe("completed");
        } finally {
          h2.close();
        }
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
