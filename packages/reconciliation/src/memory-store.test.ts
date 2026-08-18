import { describe, expect, it } from "bun:test";
import { createMemoryReconciliationStore } from "./memory-store";

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

describe("createMemoryReconciliationStore", () => {
  it("expired claimed listDue then claim does not burn attempts", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const dueAt = new Date(clock.nowMs()).toISOString();
    await store.schedule({
      key: "rec_attempts",
      subjectId: "pay_1",
      reason: "indeterminate",
      dueAt,
    });
    const first = await store.claim({
      key: "rec_attempts",
      owner: "w_dead",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    expect(first.record.attempts).toBe(1);

    clock.advance(1_001);
    const due = await store.listDue({
      now: new Date(clock.nowMs()).toISOString(),
      limit: 10,
    });
    expect(due.some((r) => r.key === "rec_attempts")).toBe(true);

    const second = await store.claim({
      key: "rec_attempts",
      owner: "w_new",
      leaseMs: 30_000,
    });
    expect(second.kind).toBe("acquired");
    if (second.kind !== "acquired") return;
    expect(second.record.attempts).toBe(first.record.attempts);
  });

  it("RECON-LEASE-1: fail after lease expiry records with matching token", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "rec_fail_expiry",
      subjectId: "pay_1",
      reason: "hang",
      dueAt: new Date(clock.nowMs()).toISOString(),
    });
    const first = await store.claim({
      key: "rec_fail_expiry",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    expect(first.record.attempts).toBe(1);
    clock.advance(2_000);
    await store.fail({
      key: "rec_fail_expiry",
      leaseToken: first.leaseToken,
      error: "handler overran lease",
      retryAt: new Date(clock.nowMs() + 5_000).toISOString(),
    });
    const rec = await store.get("rec_fail_expiry");
    expect(rec?.status).toBe("scheduled");
    expect(rec?.attempts).toBe(1);
    expect(rec?.lastError).toBe("handler overran lease");
  });

  it("complete after lease expiry still throws StoreLeaseLostError", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "rec_complete_expiry",
      subjectId: "pay_1",
      reason: "x",
      dueAt: new Date(clock.nowMs()).toISOString(),
    });
    const first = await store.claim({
      key: "rec_complete_expiry",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    clock.advance(2_000);
    await expect(
      store.complete({
        key: "rec_complete_expiry",
        leaseToken: first.leaseToken,
      }),
    ).rejects.toMatchObject({ name: "StoreLeaseLostError" });
  });

  it("NEW-STORE-5: complete after expiry does not wipe then lease_lost", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "rec_complete_wipe",
      subjectId: "pay_1",
      reason: "x",
      dueAt: new Date(clock.nowMs()).toISOString(),
    });
    const first = await store.claim({
      key: "rec_complete_wipe",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    clock.advance(2_000);
    await expect(
      store.complete({
        key: "rec_complete_wipe",
        leaseToken: first.leaseToken,
      }),
    ).rejects.toMatchObject({ name: "StoreLeaseLostError" });
    await store.fail({
      key: "rec_complete_wipe",
      leaseToken: first.leaseToken,
      error: "recorded_after_failed_complete",
    });
    expect((await store.get("rec_complete_wipe"))?.status).toBe("failed");
  });

  it("NEW-STORE-5: renew after expiry does not wipe then lease_lost", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "rec_renew_wipe",
      subjectId: "pay_1",
      reason: "x",
      dueAt: new Date(clock.nowMs()).toISOString(),
    });
    const first = await store.claim({
      key: "rec_renew_wipe",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    clock.advance(2_000);
    const r = await store.renew({
      key: "rec_renew_wipe",
      leaseToken: first.leaseToken,
      leaseMs: 5_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lease_lost");
    await store.fail({
      key: "rec_renew_wipe",
      leaseToken: first.leaseToken,
      error: "renew_expiry_recorded",
    });
    expect((await store.get("rec_renew_wipe"))?.status).toBe("failed");
  });

  it("NEW-STORE-5: markManualReview after expiry fails closed without wipe", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "rec_review_exp",
      subjectId: "pay_1",
      reason: "x",
      dueAt: new Date(clock.nowMs()).toISOString(),
    });
    const first = await store.claim({
      key: "rec_review_exp",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    clock.advance(2_000);
    await expect(
      store.markManualReview({
        key: "rec_review_exp",
        leaseToken: first.leaseToken,
        note: "hang_review",
      }),
    ).rejects.toMatchObject({ name: "StoreLeaseLostError" });
    await store.fail({
      key: "rec_review_exp",
      leaseToken: first.leaseToken,
      error: "recorded_after_failed_review",
    });
    expect((await store.get("rec_review_exp"))?.status).toBe("failed");
  });

  it("direct reclaim of expired claimed does not burn attempts", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "rec_direct",
      subjectId: "pay_1",
      reason: "x",
      dueAt: new Date(clock.nowMs()).toISOString(),
    });
    const first = await store.claim({
      key: "rec_direct",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    clock.advance(1_001);
    const second = await store.claim({
      key: "rec_direct",
      owner: "w2",
      leaseMs: 30_000,
    });
    expect(second.kind).toBe("acquired");
    if (second.kind !== "acquired") return;
    expect(second.record.attempts).toBe(first.record.attempts);
  });

  it("schedule reopens terminal completed; claimed stays already_exists", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const dueAt = new Date(clock.nowMs()).toISOString();
    const first = await store.schedule({
      key: "rec_reopen",
      subjectId: "pay_1",
      reason: "first",
      dueAt,
    });
    expect(first.kind).toBe("scheduled");
    const claimed = await store.claim({
      key: "rec_reopen",
      owner: "w1",
      leaseMs: 30_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;

    const whileClaimed = await store.schedule({
      key: "rec_reopen",
      subjectId: "pay_1",
      reason: "steal",
      dueAt,
    });
    expect(whileClaimed.kind).toBe("already_exists");

    await store.complete({
      key: "rec_reopen",
      leaseToken: claimed.leaseToken,
    });
    const reopened = await store.schedule({
      key: "rec_reopen",
      subjectId: "pay_1",
      reason: "reopen",
      dueAt: new Date(clock.nowMs() + 1_000).toISOString(),
    });
    expect(reopened.kind).toBe("scheduled");
    if (reopened.kind !== "scheduled") return;
    expect(reopened.record.attempts).toBe(0);
    expect(reopened.record.reason).toBe("reopen");
    expect(reopened.record.generation).toBe(claimed.record.generation);

    const again = await store.schedule({
      key: "rec_reopen",
      subjectId: "pay_1",
      reason: "again",
      dueAt,
    });
    expect(again.kind).toBe("already_exists");
  });

  it("NEW-STORE-2: maxEntries skips active claimed and evicts terminal; refuses when all leased", async () => {
    const clock = createFakeClock();
    const dueAt = new Date(clock.nowMs()).toISOString();
    const store = createMemoryReconciliationStore({ clock, maxEntries: 2 });
    await store.schedule({
      key: "r_keep",
      subjectId: "p1",
      reason: "x",
      dueAt,
    });
    await store.schedule({
      key: "r_done",
      subjectId: "p2",
      reason: "x",
      dueAt,
    });
    const keep = await store.claim({
      key: "r_keep",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(keep.kind).toBe("acquired");
    const done = await store.claim({
      key: "r_done",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(done.kind).toBe("acquired");
    if (done.kind !== "acquired") return;
    await store.complete({ key: "r_done", leaseToken: done.leaseToken });

    await store.schedule({
      key: "r_new",
      subjectId: "p3",
      reason: "x",
      dueAt,
    });
    expect((await store.get("r_keep"))?.status).toBe("claimed");
    expect(await store.get("r_done")).toBeUndefined();
    expect((await store.get("r_new"))?.status).toBe("scheduled");

    const full = createMemoryReconciliationStore({ clock, maxEntries: 1 });
    await full.schedule({
      key: "r_only",
      subjectId: "p",
      reason: "x",
      dueAt,
    });
    const only = await full.claim({
      key: "r_only",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(only.kind).toBe("acquired");
    await expect(
      full.schedule({
        key: "r_overflow",
        subjectId: "p2",
        reason: "x",
        dueAt,
      }),
    ).rejects.toThrow(/active lease|capacity/i);
    expect((await full.get("r_only"))?.status).toBe("claimed");
    expect(await full.get("r_overflow")).toBeUndefined();
  });
});
