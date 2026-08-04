import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  createMemoryIdempotencyStore,
  createMemoryReconciliationStore,
  createMemoryWebhookInboxStore,
  runIdempotencyStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
} from "../index";

describe("storage conformance self-proof (memory)", () => {
  it("idempotency suite passes with counters", async () => {
    const report = await runIdempotencyStoreConformanceSuite({
      name: "memory-idempotency",
      createStore: ({ clock }) => createMemoryIdempotencyStore({ clock }),
      createClock: () => createFakeClock(),
    });
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThan(0);
    expect(report.passed + report.failed + report.skipped).toBe(report.results.length);
  });

  it("webhook inbox suite passes with counters", async () => {
    const report = await runWebhookInboxStoreConformanceSuite({
      name: "memory-webhook",
      createStore: ({ clock }) => createMemoryWebhookInboxStore({ clock }),
      createClock: () => createFakeClock(),
    });
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThan(0);
  });

  it("reconciliation suite passes with counters", async () => {
    const report = await runReconciliationStoreConformanceSuite({
      name: "memory-recon",
      createStore: ({ clock }) => createMemoryReconciliationStore({ clock }),
      createClock: () => createFakeClock(),
    });
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThan(0);
  });

  it("concurrency:false skips concurrent cases", async () => {
    const report = await runIdempotencyStoreConformanceSuite({
      name: "no-concurrency",
      concurrency: false,
      createStore: ({ clock }) => createMemoryIdempotencyStore({ clock }),
      createClock: () => createFakeClock(),
    });
    expect(report.ok).toBe(true);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    const concurrent = report.results.find((r) =>
      r.name.includes("concurrent"),
    );
    expect(concurrent?.status).toBe("skipped");
  });

  it("withTransaction rollback is exercised (not skipped) for memory", async () => {
    const report = await runWebhookInboxStoreConformanceSuite({
      name: "memory-tx",
      createStore: ({ clock }) => createMemoryWebhookInboxStore({ clock }),
    });
    const tx = report.results.find((r) => r.name.includes("withTransaction"));
    expect(tx?.status).toBe("passed");
  });
});
