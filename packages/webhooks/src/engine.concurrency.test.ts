/**
 * Concurrent claim/handler acceptance (A1) and related races.
 */
import { describe, it, expect } from "bun:test";
import { createWebhookInboxEngine } from "./engine";
import { createMemoryWebhookInboxStore } from "./memory-store";
import { createTestClock } from "./test-clock";

describe("engine concurrency (A1)", () => {
  it("A1: concurrent processVerified same key — only one handler runs", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 60_000,
    });

    let concurrent = 0;
    let maxConcurrent = 0;
    let runs = 0;
    const release: Array<() => void> = [];

    const handler = async () => {
      runs++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => {
        release.push(resolve);
      });
      concurrent--;
    };

    const p1 = engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_concurrent",
      payloadHash: "same-hash",
      handler,
    });
    // Yield so first claim can complete before second starts racing at handler.
    await Promise.resolve();
    const p2 = engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_concurrent",
      payloadHash: "same-hash",
      handler,
    });

    // Allow microtasks for both claims
    await new Promise((r) => setTimeout(r, 10));

    // Release the running handler(s)
    while (release.length > 0) {
      const r = release.shift();
      r?.();
    }

    const [o1, o2] = await Promise.all([p1, p2]);
    const outcomes = [o1.outcome, o2.outcome].sort();

    expect(runs).toBe(1);
    expect(maxConcurrent).toBe(1);
    expect(outcomes).toContain("processed");
    expect(
      outcomes.includes("already_processing") ||
        outcomes.includes("duplicate_completed"),
    ).toBe(true);

    // Exactly one processed
    expect([o1, o2].filter((o) => o.outcome === "processed")).toHaveLength(1);
  });

  it("A1 variant: Promise.all double delivery same key", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
    });

    let runs = 0;
    const results = await Promise.all([
      engine.processVerified({
        gateway: "paymob",
        providerEventId: "evt_p",
        payloadHash: "h",
        handler: async () => {
          runs++;
          await new Promise((r) => setTimeout(r, 5));
        },
      }),
      engine.processVerified({
        gateway: "paymob",
        providerEventId: "evt_p",
        payloadHash: "h",
        handler: async () => {
          runs++;
          await new Promise((r) => setTimeout(r, 5));
        },
      }),
    ]);

    expect(runs).toBe(1);
    const kinds = results.map((r) => r.outcome);
    expect(kinds.filter((k) => k === "processed")).toHaveLength(1);
    expect(
      kinds.some(
        (k) => k === "already_processing" || k === "duplicate_completed",
      ),
    ).toBe(true);
  });
});
