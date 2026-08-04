/**
 * File-backed restart durability + FakeClock reclaim across "eviction".
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeClock } from "@paykernel/testkit";
import {
  createDoIdempotencyStore,
  createDoExecutor,
  migrateDoAdapter,
} from "./index";
import { createMockDoSql } from "./test-utils/mock-do-sql";

describe("do restart / eviction durability", () => {
  it("completed idempotency record survives reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-do-rs-"));
    const path = join(dir, "restart.db");
    try {
      {
        const handle = createMockDoSql({ path });
        const executor = createDoExecutor(handle.storage);
        await migrateDoAdapter(executor, { namespace: { tablePrefix: "rs_" } });
        const store = createDoIdempotencyStore({
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
        handle.close();
      }

      {
        const handle = createMockDoSql({ path });
        const executor = createDoExecutor(handle.storage);
        const store = createDoIdempotencyStore({
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
        handle.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("FakeClock reclaim after simulated restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "payments-do-rc-"));
    const path = join(dir, "reclaim.db");
    try {
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      {
        const handle = createMockDoSql({ path });
        const executor = createDoExecutor(handle.storage);
        await migrateDoAdapter(executor, { namespace: { tablePrefix: "rc_" } });
        const store = createDoIdempotencyStore({
          executor,
          clock,
          namespace: { tablePrefix: "rc_" },
        });
        const r = await store.reserve({
          key: "leased",
          fingerprint: "fp",
          owner: "w1",
          leaseMs: 1_000,
        });
        expect(r.kind).toBe("acquired");
        handle.close();
      }

      clock.advance(5_000);

      {
        const handle = createMockDoSql({ path });
        const executor = createDoExecutor(handle.storage);
        const store = createDoIdempotencyStore({
          executor,
          clock,
          namespace: { tablePrefix: "rc_" },
        });
        const r2 = await store.reserve({
          key: "leased",
          fingerprint: "fp",
          owner: "w2",
          leaseMs: 10_000,
        });
        expect(r2.kind).toBe("acquired");
        if (r2.kind === "acquired") {
          expect(r2.record.generation).toBeGreaterThanOrEqual(2);
        }
        handle.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
