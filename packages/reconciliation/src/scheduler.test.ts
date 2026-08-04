import { describe, it, expect } from "bun:test";
import {
  createReconciliationScheduler,
  deriveReconciliationJobKey,
} from "./scheduler";
import { createMemoryReconciliationStore } from "./memory-store";
import { createExponentialBackoff } from "./backoff";
import { isStoreLeaseLostError } from "./store";

type FakeClock = { nowMs: () => number; advance: (ms: number) => void };

function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let t = start;
  return {
    nowMs: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createReconciliationScheduler (A3)", () => {
  it("schedule + claim + complete via memory store (no queue)", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      owner: "w1",
      defaultLeaseMs: 30_000,
    });

    const runAt = new Date(clock.nowMs()).toISOString();
    const scheduled = await scheduler.schedule({
      target: {
        gateway: "stripe",
        gatewayPaymentId: "pi_sched",
        expected: { status: "pending" },
      },
      runAt,
      reason: "indeterminate_create",
    });
    expect(scheduled.kind).toBe("scheduled");

    const claimed = await scheduler.claimDue({ limit: 5 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.record.subjectId).toBe("pi_sched");
    expect(claimed[0]!.record.reason).toBe("indeterminate_create");

    await scheduler.complete({
      key: claimed[0]!.key,
      leaseToken: claimed[0]!.leaseToken,
    });

    const rec = await store.get(claimed[0]!.key);
    expect(rec?.status).toBe("completed");
  });

  it("deriveReconciliationJobKey prefers payment id", () => {
    expect(
      deriveReconciliationJobKey({
        gateway: "stripe",
        gatewayPaymentId: "pi_1",
        idempotencyKey: "idem",
      }),
    ).toBe("recon:stripe:pi_1");
  });

  it("failAndReschedule uses backoff and sets dueAt", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const backoff = createExponentialBackoff({
      baseMs: 1000,
      maxMs: 60_000,
      multiplier: 2,
      jitterRatio: 0,
    });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      backoff,
    });

    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_r" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "retry_test",
    });
    const claimed = await scheduler.claimDue();
    expect(claimed).toHaveLength(1);

    await scheduler.failAndReschedule({
      key: claimed[0]!.key,
      leaseToken: claimed[0]!.leaseToken,
      error: new Error("provider timeout"),
      attempt: 1,
    });

    const rec = await store.get(claimed[0]!.key);
    expect(rec?.status).toBe("scheduled");
    expect(rec?.lastError).toContain("provider timeout");
    // attempt 1 → 2000ms
    expect(Date.parse(rec!.dueAt)).toBe(clock.nowMs() + 2000);
  });

  it("max attempts → markManualReview dead letter path", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      maxAttempts: 2,
    });

    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_dl" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "dl",
    });

    const result = await scheduler.processDue({
      handler: async () => {
        throw new Error("always fail");
      },
    });
    // first claim attempts=1 < 2 → reschedule
    expect(result.rescheduled).toBe(1);

    // advance past retry
    clock.advance(60_000);
    const result2 = await scheduler.processDue({
      handler: async () => {
        throw new Error("always fail again");
      },
    });
    // attempts=2 >= maxAttempts 2 → manual review
    expect(result2.manualReview).toBe(1);

    const key = deriveReconciliationJobKey({
      gateway: "stripe",
      gatewayPaymentId: "pi_dl",
    });
    const dead = await scheduler.listDeadLetter({ keys: [key] });
    expect(dead).toHaveLength(1);
    expect(dead[0]!.status).toBe("manual_review");
  });

  it("stale lease complete fails with StoreLeaseLostError", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      defaultLeaseMs: 1000,
    });

    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_stale" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "stale",
    });
    const claimed = await scheduler.claimDue();
    const oldToken = claimed[0]!.leaseToken;

    // expire lease and reclaim
    clock.advance(2000);
    const reclaimed = await store.claim({
      key: claimed[0]!.key,
      owner: "w2",
      leaseMs: 30_000,
    });
    expect(reclaimed.kind).toBe("acquired");

    try {
      await scheduler.complete({
        key: claimed[0]!.key,
        leaseToken: oldToken,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(isStoreLeaseLostError(e)).toBe(true);
    }
  });

  it("schedule already_exists is idempotent", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({ store, clock });
    const input = {
      target: { gateway: "stripe", gatewayPaymentId: "pi_idem" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "r1",
    };
    const a = await scheduler.schedule(input);
    const b = await scheduler.schedule(input);
    expect(a.kind).toBe("scheduled");
    expect(b.kind).toBe("already_exists");
  });

  it("maxInFlightByGateway filters before claim so excess jobs stay unclaimed", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({ store, clock });
    const runAt = new Date(clock.nowMs()).toISOString();

    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_a" },
      runAt,
      reason: "a",
    });
    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_b" },
      runAt,
      reason: "b",
    });
    await scheduler.schedule({
      target: { gateway: "moyasar", gatewayPaymentId: "pi_c" },
      runAt,
      reason: "c",
    });

    const handled: string[] = [];
    const result = await scheduler.processDue({
      maxInFlightByGateway: { stripe: 1 },
      handler: async (job) => {
        handled.push(job.key);
      },
    });

    // One stripe + one moyasar (moyasar uncapped) = 2 completed; one stripe remains scheduled
    expect(result.completed).toBe(2);
    expect(handled).toHaveLength(2);

    const remainingStripe = await store.get(
      deriveReconciliationJobKey({
        gateway: "stripe",
        gatewayPaymentId: "pi_b",
      }),
    );
    // The unselected stripe job must not be left claimed without a worker
    expect(remainingStripe?.status).toBe("scheduled");
    expect(remainingStripe?.leaseToken).toBeUndefined();
  });
});
