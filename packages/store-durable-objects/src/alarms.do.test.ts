/**
 * Optional alarms (17.4): one alarm per DO + queue, at-least-once, mock setAlarm.
 *
 * - enabled default-off
 * - many records → single scheduled alarm (not N concurrent alarms)
 * - bounded retries + backoff/jitter
 * - duplicate alarm delivery must not double-process after successful drain
 * - handlers re-check lease/claim state (at-least-once semantics)
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import {
  PaymentsStoreObject,
  ensureAlarmQueueSchema,
  createAlarmScheduler,
} from "./index";
import { createMockDoSql } from "./test-utils/mock-do-sql";

describe("do optional alarms", () => {
  it("enqueue sets one alarm; drain is at-least-once and idempotent-friendly", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const handle = createMockDoSql({ alarms: true });
    try {
      ensureAlarmQueueSchema(handle.storage);
      const scheduler = createAlarmScheduler({
        storage: handle.storage,
        clock,
        maxRetries: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 1_000,
      });

      await scheduler.enqueue({
        id: "job-1",
        kind: "retry",
        payload: { key: "k" },
        dueAtMs: clock.nowMs(),
      });
      expect(handle.setAlarmCount).toBeGreaterThanOrEqual(1);
      expect(handle.lastAlarmMs).toBe(clock.nowMs());

      let runs = 0;
      const r1 = await scheduler.drain(async () => {
        runs += 1;
      });
      expect(r1.processed).toBe(1);
      expect(runs).toBe(1);

      // Second drain (duplicate alarm delivery): nothing due — no double process
      const r2 = await scheduler.drain(async () => {
        runs += 1;
      });
      expect(r2.processed).toBe(0);
      expect(runs).toBe(1);
    } finally {
      handle.close();
    }
  });

  it("many records share one DO alarm slot (not one setAlarm-per-record storm)", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const handle = createMockDoSql({ alarms: true });
    try {
      ensureAlarmQueueSchema(handle.storage);
      const scheduler = createAlarmScheduler({
        storage: handle.storage,
        clock,
        maxRetries: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 1_000,
      });

      const n = 12;
      const due = clock.nowMs();
      for (let i = 0; i < n; i++) {
        await scheduler.enqueue({
          id: `job-${i}`,
          kind: "retry",
          payload: { i },
          // All due now — still a single DO alarm slot (lastAlarmMs one value)
          dueAtMs: due,
        });
      }

      // DO only holds one alarm time for the partition queue head.
      expect(handle.lastAlarmMs).toBe(due);
      // setAlarm may be called per enqueue (replace), but never N independent alarms.
      expect(handle.setAlarmCount).toBeGreaterThanOrEqual(1);
      expect(handle.setAlarmCount).toBeLessThanOrEqual(n + 2);

      const processedIds: string[] = [];
      const r = await scheduler.drain(async (item) => {
        processedIds.push(item.id);
      });
      expect(r.processed).toBe(n);
      expect(new Set(processedIds).size).toBe(n);

      // Duplicate alarm after success: queue empty
      const r2 = await scheduler.drain(async () => {
        processedIds.push("ghost");
      });
      expect(r2.processed).toBe(0);
      expect(processedIds).not.toContain("ghost");
    } finally {
      handle.close();
    }
  });

  it("failed handler retries with backoff; respects maxRetries / dead-letters", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const handle = createMockDoSql({ alarms: true });
    try {
      ensureAlarmQueueSchema(handle.storage);
      const baseBackoffMs = 500;
      const maxRetries = 2;
      const scheduler = createAlarmScheduler({
        storage: handle.storage,
        clock,
        maxRetries,
        baseBackoffMs,
        maxBackoffMs: 5_000,
      });

      await scheduler.enqueue({
        id: "fail-job",
        kind: "retry",
        payload: {},
        dueAtMs: clock.nowMs(),
      });

      // First failure → backoff, attempts=1
      await scheduler.drain(async () => {
        throw new Error("handler boom");
      });
      const after1 = scheduler.listDue(
        new Date(clock.nowMs() + 60_000).toISOString(),
      );
      const row1 = after1.find((i) => i.id === "fail-job");
      expect(row1).toBeDefined();
      expect(row1!.attempts).toBe(1);
      const due1 = Date.parse(row1!.dueAt);
      // Backoff applied: due_at pushed into the future (≥ baseBackoff with jitter floor)
      expect(due1).toBeGreaterThan(clock.nowMs());
      expect(due1).toBeLessThanOrEqual(clock.nowMs() + 5_000);

      // Advance past backoff and fail again → hits maxRetries, dead-letter far future
      clock.advance(due1 - clock.nowMs() + 1);
      await scheduler.drain(async () => {
        throw new Error("handler boom again");
      });
      const after2 = scheduler.listDue(
        new Date(clock.nowMs() + 400 * 24 * 3600_000).toISOString(),
      );
      const row2 = after2.find((i) => i.id === "fail-job");
      expect(row2).toBeDefined();
      expect(row2!.attempts).toBe(maxRetries);
      // Dead-lettered far into the future (not immediately due)
      expect(Date.parse(row2!.dueAt)).toBeGreaterThan(clock.nowMs() + 1_000_000);
    } finally {
      handle.close();
    }
  });

  it("at-least-once: handler can re-check state; success deletes so duplicate is no-op", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const handle = createMockDoSql({ alarms: true });
    try {
      ensureAlarmQueueSchema(handle.storage);
      const scheduler = createAlarmScheduler({
        storage: handle.storage,
        clock,
        maxRetries: 5,
        baseBackoffMs: 50,
        maxBackoffMs: 500,
      });

      await scheduler.enqueue({
        id: "lease-guarded",
        kind: "webhook_retry",
        payload: { key: "evt" },
        dueAtMs: clock.nowMs(),
      });

      // Simulate lease-protected processing: side-effect only when first seen.
      const seen = new Set<string>();
      const handler = async (item: { id: string }) => {
        if (seen.has(item.id)) {
          // Idempotent re-entry (duplicate delivery before delete) — no double work.
          return;
        }
        seen.add(item.id);
      };

      const r1 = await scheduler.drain(handler);
      expect(r1.processed).toBe(1);
      expect(seen.size).toBe(1);

      // Re-enqueue same id (UPSERT) and drain again — still single logical process
      await scheduler.enqueue({
        id: "lease-guarded",
        kind: "webhook_retry",
        payload: { key: "evt" },
        dueAtMs: clock.nowMs(),
      });
      const r2 = await scheduler.drain(handler);
      expect(r2.processed).toBe(1);
      // Handler saw id again but Set prevents double side-effect
      expect(seen.size).toBe(1);
    } finally {
      handle.close();
    }
  });

  it("PaymentsStoreObject alarm default-off; enabled path works", async () => {
    const handle = createMockDoSql({ alarms: true });
    try {
      const off = new PaymentsStoreObject({ storage: handle.storage });
      const r0 = await off.alarm();
      expect(r0.processed).toBe(0);
      expect(off.getAlarmScheduler()).toBeUndefined();

      const on = new PaymentsStoreObject({
        storage: handle.storage,
        alarms: { enabled: true, maxRetries: 2 },
      });
      expect(on.getAlarmScheduler()).toBeDefined();
      await on.getAlarmScheduler()!.enqueue({
        id: "a1",
        kind: "x",
        payload: {},
        dueAtMs: Date.now(),
      });
      const r = await on.alarm(async () => undefined);
      expect(r.processed).toBe(1);
    } finally {
      handle.close();
    }
  });

  it("alarm without handler does not delete due queue rows", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const handle = createMockDoSql({ alarms: true });
    try {
      const obj = new PaymentsStoreObject({
        storage: handle.storage,
        clock,
        alarms: { enabled: true, maxRetries: 3 },
      });
      await obj.getAlarmScheduler()!.enqueue({
        id: "must-keep",
        kind: "retry",
        payload: { k: 1 },
        dueAtMs: clock.nowMs(),
      });

      // Platform-style alarm() with no app handler: re-schedule only.
      const r = await obj.alarm();
      expect(r.processed).toBe(0);
      expect(r.failed).toBe(0);

      const stillDue = obj.getAlarmScheduler()!.listDue(
        new Date(clock.nowMs() + 1).toISOString(),
      );
      expect(stillDue.some((i) => i.id === "must-keep")).toBe(true);

      // Explicit handler can process and delete.
      const drained = await obj.alarm(async () => undefined);
      expect(drained.processed).toBe(1);
      expect(
        obj
          .getAlarmScheduler()!
          .listDue(new Date(clock.nowMs() + 1).toISOString()),
      ).toHaveLength(0);
    } finally {
      handle.close();
    }
  });
});
