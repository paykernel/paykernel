/**
 * Concurrent claim contention + FakeClock lease reclaim (mock DO SQL).
 *
 * Matrix 17.5:
 * - parallel same-key reserve → exactly one acquired
 * - multi-instance / two store instances same mock storage
 * - stale lease complete/fail/markIndeterminate → StoreLeaseLostError
 * - FakeClock expiry reclaim with generation++
 * - webhook + reconciliation concurrent claim winners
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock, StoreLeaseLostError } from "@paykernel/testkit";
import {
  createDoIdempotencyStore,
  createDoWebhookInboxStore,
  createDoReconciliationStore,
  createDoExecutor,
  migrateDoAdapter,
} from "./index";
import { createMockDoSql } from "./test-utils/mock-do-sql";
import { uniqueTablePrefix } from "./test-utils/do-env";

describe("do claim concurrency (mock DO SQL)", () => {
  it("only one worker acquires a fresh key under parallel reserve", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("cx");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });

      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const workers = 8;
      const stores = Array.from({ length: workers }, () =>
        createDoIdempotencyStore({
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

  it("multi-instance: two store instances same mock storage → exactly one winner", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("mi");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });

      // Distinct store instances simulate two Worker isolates sharing one DO partition.
      const instanceA = createDoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });
      const instanceB = createDoIdempotencyStore({
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

  it("stale lease complete throws StoreLeaseLostError", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("sl");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createDoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const r = await store.reserve({
        key: "k",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 5_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;

      await expect(
        store.complete({
          key: "k",
          leaseToken: "lt_wrong_token_xxxxx",
          result: { ok: true },
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);
    } finally {
      handle.close();
    }
  });

  it("stale lease complete/markIndeterminate after reclaim throws StoreLeaseLostError", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("st");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createDoIdempotencyStore({
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

  it("FakeClock lease expiry allows reclaim with generation++", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("fc");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createDoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const r1 = await store.reserve({
        key: "lease-key",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(r1.kind).toBe("acquired");
      if (r1.kind !== "acquired") return;
      expect(r1.record.generation).toBe(1);

      clock.advance(2_000);

      const r2 = await store.reserve({
        key: "lease-key",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(r2.kind).toBe("acquired");
      if (r2.kind !== "acquired") return;
      expect(r2.record.generation).toBe(2);
      expect(r2.leaseToken).not.toBe(r1.leaseToken);

      // Stale first lease cannot complete after reclaim.
      await expect(
        store.complete({
          key: "lease-key",
          leaseToken: r1.leaseToken,
          result: { ok: true },
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);
    } finally {
      handle.close();
    }
  });

  it("stale webhook fail/complete throws StoreLeaseLostError after reclaim", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("sf");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createDoWebhookInboxStore({
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

  it("webhook concurrent claim: exactly one winner", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("wh");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const stores = Array.from({ length: 6 }, () =>
        createDoWebhookInboxStore({
          executor,
          clock,
          namespace: { tablePrefix: prefix },
        }),
      );
      const results = await Promise.all(
        stores.map((s, i) =>
          s.claim({
            key: "evt-1",
            payloadHash: "h",
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

  it("reconciliation concurrent claim: exactly one winner", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("rc");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createDoReconciliationStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      await store.schedule({
        key: "recon-1",
        subjectId: "subj-1",
        reason: "test-claim",
        dueAt: new Date(clock.nowMs()).toISOString(),
      });

      const workers = Array.from({ length: 6 }, () =>
        createDoReconciliationStore({
          executor,
          clock,
          namespace: { tablePrefix: prefix },
        }),
      );
      const results = await Promise.all(
        workers.map((s, i) =>
          s.claim({
            key: "recon-1",
            owner: `w${i}`,
            leaseMs: 10_000,
          }),
        ),
      );
      expect(results.filter((r) => r.kind === "acquired").length).toBe(1);
    } finally {
      handle.close();
    }
  });
});
