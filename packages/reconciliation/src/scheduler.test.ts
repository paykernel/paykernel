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
    expect(result.completed).toBe(0);

    // advance past retry
    clock.advance(60_000);
    const result2 = await scheduler.processDue({
      handler: async () => {
        throw new Error("always fail again");
      },
    });
    // attempts=2 >= maxAttempts 2 → manual review
    expect(result2.manualReview).toBe(1);
    expect(result2.completed).toBe(0);

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
        return { disposition: "complete" as const };
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

  /**
   * Crash recovery via the production poll path (listDue → claim).
   * schedule → claimDue → abandon mid-claim → expire lease → claimDue must
   * rediscover the job. Key-addressed reclaim alone is insufficient proof:
   * createReconciliationScheduler only discovers via store.listDue.
   */
  it("claimDue rediscovers abandoned job after lease expiry via listDue", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      owner: "w1",
      defaultLeaseMs: 1_000,
    });

    const runAt = new Date(clock.nowMs()).toISOString();
    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_abandon" },
      runAt,
      reason: "indeterminate_create",
    });

    const first = await scheduler.claimDue({ limit: 5 });
    expect(first).toHaveLength(1);
    const key = first[0]!.key;
    const abandonedToken = first[0]!.leaseToken;

    // Worker crash: no complete / fail / renew. Job stays claimed until lease expires.
    const mid = await store.get(key);
    expect(mid?.status).toBe("claimed");

    // Before expiry, listDue must not surface the still-leased claim.
    const stillHeld = await store.listDue({
      now: new Date(clock.nowMs()).toISOString(),
      limit: 10,
    });
    expect(stillHeld.some((r) => r.key === key)).toBe(false);
    const noReclaim = await scheduler.claimDue({ limit: 5, owner: "w2" });
    expect(noReclaim).toHaveLength(0);

    // Lease expires → listDue soft-releases claimed→scheduled → claimDue rediscovers.
    clock.advance(1_001);
    const rediscovered = await scheduler.claimDue({ limit: 5, owner: "w2" });
    expect(rediscovered).toHaveLength(1);
    expect(rediscovered[0]!.key).toBe(key);
    expect(rediscovered[0]!.leaseToken).not.toBe(abandonedToken);
    expect(rediscovered[0]!.record.generation).toBeGreaterThan(
      first[0]!.record.generation,
    );

    await scheduler.complete({
      key: rediscovered[0]!.key,
      leaseToken: rediscovered[0]!.leaseToken,
    });
    expect((await store.get(key))?.status).toBe("completed");
  });

  it("processDue rediscovers abandoned job after lease expiry via listDue", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      owner: "w1",
      defaultLeaseMs: 1_000,
    });

    const runAt = new Date(clock.nowMs()).toISOString();
    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_process_abandon" },
      runAt,
      reason: "indeterminate_create",
    });

    // Claim then abandon (simulate crash mid-handler without processDue complete).
    const first = await scheduler.claimDue({ limit: 5 });
    expect(first).toHaveLength(1);
    const key = first[0]!.key;

    // processDue while lease active: listDue empty → nothing processed.
    const blocked = await scheduler.processDue({
      owner: "w2",
      leaseMs: 30_000,
      handler: async () => {
        throw new Error("should not run while lease held");
      },
    });
    expect(blocked.processed).toBe(0);

    clock.advance(1_001);

    const handled: string[] = [];
    const recovered = await scheduler.processDue({
      owner: "w2",
      leaseMs: 30_000,
      handler: async (job) => {
        handled.push(job.key);
        return { disposition: "complete" as const };
      },
    });
    expect(recovered.processed).toBe(1);
    expect(recovered.completed).toBe(1);
    expect(handled).toEqual([key]);
    expect((await store.get(key))?.status).toBe("completed");
  });

  it("RECON-2: processDue does not complete on void / retry disposition", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      maxAttempts: 10,
      backoff: createExponentialBackoff({
        baseMs: 1000,
        maxMs: 60_000,
        multiplier: 2,
        jitterRatio: 0,
      }),
    });

    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_retry_later" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "retry_later_path",
    });

    // Handler that would have been "success" under throw-only contract but
    // models policy retry_later by returning void / explicit retry.
    const voidResult = await scheduler.processDue({
      handler: async () => {
        // intentional no disposition — fail-closed retry
      },
    });
    expect(voidResult.processed).toBe(1);
    expect(voidResult.completed).toBe(0);
    expect(voidResult.rescheduled).toBe(1);

    const key = deriveReconciliationJobKey({
      gateway: "stripe",
      gatewayPaymentId: "pi_retry_later",
    });
    expect((await store.get(key))?.status).toBe("scheduled");

    clock.advance(60_000);
    const explicitRetry = await scheduler.processDue({
      handler: async () => ({
        disposition: "retry" as const,
        error: "policy:retry_later",
        retryAfterMs: 5_000,
      }),
    });
    expect(explicitRetry.completed).toBe(0);
    expect(explicitRetry.rescheduled).toBe(1);
    const rec = await store.get(key);
    expect(rec?.status).toBe("scheduled");
    expect(Date.parse(rec!.dueAt)).toBe(clock.nowMs() + 5_000);
  });

  it("RECON-2: processDue completes only on explicit complete disposition", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({ store, clock });

    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_ok" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "ok",
    });

    const result = await scheduler.processDue({
      handler: async () => ({ disposition: "complete" as const }),
    });
    expect(result.completed).toBe(1);
    expect(result.rescheduled).toBe(0);
    expect(result.leaseLost).toBe(0);
  });

  it("RECON-3: lease_lost after handler is not counted as business reschedule", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({
      store,
      clock,
      defaultLeaseMs: 1_000,
      maxAttempts: 2,
    });

    await scheduler.schedule({
      target: { gateway: "stripe", gatewayPaymentId: "pi_lease" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "lease",
    });

    // Intercept: claim via processDue but force lease expiry before complete.
    const result = await scheduler.processDue({
      leaseMs: 1_000,
      handler: async () => {
        clock.advance(2_000);
        // Steal lease as another owner while original token is now expired.
        const key = deriveReconciliationJobKey({
          gateway: "stripe",
          gatewayPaymentId: "pi_lease",
        });
        const reclaimed = await store.claim({
          key,
          owner: "thief",
          leaseMs: 30_000,
        });
        expect(reclaimed.kind).toBe("acquired");
        return { disposition: "complete" as const };
      },
    });

    expect(result.processed).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.rescheduled).toBe(0);
    expect(result.manualReview).toBe(0);
    expect(result.leaseLost).toBe(1);
  });

  it("RECON-7: schedule reopens terminal completed job under same key", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({ store, clock });
    const input = {
      target: { gateway: "stripe", gatewayPaymentId: "pi_term" },
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "first",
    };
    await scheduler.schedule(input);
    const claimed = await scheduler.claimDue();
    await scheduler.complete({
      key: claimed[0]!.key,
      leaseToken: claimed[0]!.leaseToken,
    });
    expect((await store.get(claimed[0]!.key))?.status).toBe("completed");

    const again = await scheduler.schedule({
      ...input,
      reason: "reopen",
      runAt: new Date(clock.nowMs() + 1_000).toISOString(),
    });
    expect(again.kind).toBe("scheduled");
    if (again.kind === "scheduled") {
      expect(again.record.status).toBe("scheduled");
      expect(again.record.reason).toBe("reopen");
    }
  });

  it("RECON-8: maxInFlightByGateway oversample does not starve other gateways", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const scheduler = createReconciliationScheduler({ store, clock });
    const runAt = new Date(clock.nowMs()).toISOString();

    // Many stripe jobs first (would fill a tight listDue window), then moyasar.
    for (let i = 0; i < 8; i++) {
      await scheduler.schedule({
        target: { gateway: "stripe", gatewayPaymentId: `pi_s_${i}` },
        runAt,
        reason: "s",
      });
    }
    await scheduler.schedule({
      target: { gateway: "moyasar", gatewayPaymentId: "pi_m_1" },
      runAt,
      reason: "m",
    });

    const handled: string[] = [];
    const result = await scheduler.processDue({
      limit: 3,
      maxInFlightByGateway: { stripe: 1 },
      handler: async (job) => {
        handled.push(job.key);
        return { disposition: "complete" as const };
      },
    });

    // Cap stripe at 1; remaining slots should pick moyasar rather than only stripe.
    expect(result.completed).toBeGreaterThanOrEqual(2);
    expect(handled.some((k) => k.includes(":moyasar:"))).toBe(true);
    expect(handled.filter((k) => k.includes(":stripe:")).length).toBe(1);
  });
});
