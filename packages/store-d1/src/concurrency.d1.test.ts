/**
 * Concurrent claim contention + FakeClock lease reclaim (mock D1).
 *
 * Matrix: parallel reserve, multi-instance same mock DB, stale complete/fail,
 * webhook concurrent claim, FakeClock generation++ reclaim.
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock, StoreLeaseLostError } from "@paykernel/testkit";
import {
  createD1IdempotencyStore,
  createD1WebhookInboxStore,
  createD1Executor,
  migrateD1Adapter,
} from "./index";
import { createMockD1 } from "./test-utils/mock-d1";
import { uniqueTablePrefix } from "./test-utils/d1-env";

describe("d1 claim concurrency (mock D1)", () => {
  it("only one worker acquires a fresh key under parallel reserve", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("cx");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });

      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const workers = 8;
      const stores = Array.from({ length: workers }, () =>
        createD1IdempotencyStore({
          executor,
          clock,
          namespace: { tablePrefix: prefix },
        }),
      );

      const key = "contention-key";
      const results = await Promise.all(
        stores.map((store, i) =>
          store.reserve({
            key,
            fingerprint: "fp",
            owner: `w${i}`,
            leaseMs: 30_000,
          }),
        ),
      );

      const acquired = results.filter((r) => r.kind === "acquired");
      const inProgress = results.filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(inProgress.length).toBe(workers - 1);
      if (acquired[0]?.kind === "acquired") {
        expect(acquired[0].record.generation).toBe(1);
        expect(acquired[0].leaseToken.length).toBeGreaterThan(8);
      }
    } finally {
      handle.close();
    }
  });

  it("multi-instance: two store instances same mock DB → exactly one winner", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("mi");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });

      // Distinct store instances simulate two Worker isolates sharing D1.
      const instanceA = createD1IdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });
      const instanceB = createD1IdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const results = await Promise.all([
        instanceA.reserve({
          key: "multi-inst",
          fingerprint: "fp",
          owner: "instance-a",
          leaseMs: 30_000,
        }),
        instanceB.reserve({
          key: "multi-inst",
          fingerprint: "fp",
          owner: "instance-b",
          leaseMs: 30_000,
        }),
      ]);

      const acquired = results.filter((r) => r.kind === "acquired");
      expect(acquired.length).toBe(1);
      if (acquired[0]?.kind === "acquired") {
        expect(["instance-a", "instance-b"]).toContain(
          acquired[0].record.leaseOwner,
        );
      }
      const loser = results.find((r) => r.kind !== "acquired");
      expect(loser?.kind).toBe("in_progress");
    } finally {
      handle.close();
    }
  });

  it("FakeClock lease expiry allows reclaim with generation++", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("lx");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });

      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createD1IdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const first = await store.reserve({
        key: "lease-reclaim",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 5_000,
      });
      expect(first.kind).toBe("acquired");
      if (first.kind !== "acquired") return;

      clock.advance(6_000);

      const second = await store.reserve({
        key: "lease-reclaim",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(second.kind).toBe("acquired");
      if (second.kind === "acquired") {
        expect(second.record.generation).toBe(2);
        expect(second.leaseToken).not.toBe(first.leaseToken);
      }

      // Stale token cannot complete
      await expect(
        store.complete({
          key: "lease-reclaim",
          leaseToken: first.leaseToken,
          result: { ok: true },
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);
    } finally {
      handle.close();
    }
  });

  it("stale lease complete/markIndeterminate throws StoreLeaseLostError after reclaim", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("st");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createD1IdempotencyStore({
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
        store.complete({
          key: "stale1",
          leaseToken: r1.leaseToken,
          result: {},
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);

      await expect(
        store.markIndeterminate({
          key: "stale1",
          leaseToken: r1.leaseToken,
          reason: "stale worker",
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);

      // Winner can still complete with current lease.
      await store.complete({
        key: "stale1",
        leaseToken: r2.leaseToken,
        result: { ok: true },
      });
      const got = await store.get("stale1");
      expect(got?.status).toBe("completed");
    } finally {
      handle.close();
    }
  });

  it("stale webhook fail throws StoreLeaseLostError after reclaim", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("sf");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createD1WebhookInboxStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const c1 = await store.claim({
        key: "wh-stale",
        payloadHash: "h",
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(c1.kind).toBe("acquired");
      if (c1.kind !== "acquired") return;

      clock.advance(2_000);

      const c2 = await store.claim({
        key: "wh-stale",
        payloadHash: "h",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(c2.kind).toBe("acquired");
      if (c2.kind !== "acquired") return;

      await expect(
        store.fail({
          key: "wh-stale",
          leaseToken: c1.leaseToken,
          error: "stale",
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);

      await expect(
        store.complete({
          key: "wh-stale",
          leaseToken: c1.leaseToken,
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);

      await store.complete({
        key: "wh-stale",
        leaseToken: c2.leaseToken,
      });
      const got = await store.get("wh-stale");
      expect(got?.status).toBe("completed");
    } finally {
      handle.close();
    }
  });

  it("webhook parallel claim yields single acquirer", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("wx");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const stores = Array.from({ length: 6 }, () =>
        createD1WebhookInboxStore({
          executor,
          clock,
          namespace: { tablePrefix: prefix },
        }),
      );
      const results = await Promise.all(
        stores.map((s, i) =>
          s.claim({
            key: "evt-1",
            payloadHash: "h1",
            owner: `w${i}`,
            leaseMs: 10_000,
          }),
        ),
      );
      expect(results.filter((r) => r.kind === "acquired").length).toBe(1);
      expect(results.filter((r) => r.kind === "in_progress").length).toBe(5);
    } finally {
      handle.close();
    }
  });

  it("read-after-write: get reflects claim immediately on same connection", async () => {
    // Claims are writes (primary path). Without Sessions under real D1 read
    // replication, a subsequent get may be stale — mock has no replicas so RAW holds.
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("rw");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createD1IdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const r = await store.reserve({
        key: "raw-key",
        fingerprint: "fp-raw",
        owner: "owner-a",
        leaseMs: 10_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;

      const got = await store.get("raw-key");
      expect(got).toBeDefined();
      expect(got?.status).toBe("reserved");
      expect(got?.leaseOwner).toBe("owner-a");
      expect(got?.leaseToken).toBe(r.leaseToken);
      expect(got?.fingerprint).toBe("fp-raw");
    } finally {
      handle.close();
    }
  });
});
