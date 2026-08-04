/**
 * Concurrent claim tests (A3): under a mutex-serialized reference store,
 * only one winner acquires for the same key when many callers race.
 *
 * Same-isolate scope: memory-relational reference uses a promise-chain mutex
 * to emulate engine-level single conditional write serialization.
 * bun:sqlite reference uses a single synchronous transaction (no await inside).
 *
 * Multi-connection SQL engine proofs for production dialects are Phase 12+
 * adapter responsibilities (use runClaimContentionHarness).
 *
 * Atomicity proof: neither reference uses get-then-set across awaits —
 * memory serializes via mutex; bun:sqlite runs evaluate+write inside one
 * db.transaction() callback.
 */
import { describe, expect, it } from "bun:test";
import { memoryRelationalAsHarnessAdapter, runClaimContentionHarness } from "./claims/harness";
import {
  createMemoryRelationalStore,
  isReferenceLeaseLostError,
  ReferenceLeaseLostError,
} from "./reference/memory-relational-store";
import {
  BUN_SQLITE_ATOMICITY_MODEL,
  createBunSqliteRelationalStore,
} from "./reference/bun-sqlite-store.test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("claim contention (memory-relational reference)", () => {
  it("idempotency: concurrent reserve → exactly one acquired", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });

    const workers = 40;
    const results = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        store.reserveIdempotency({
          key: "same-key",
          fingerprint: "fp",
          owner: `worker-${i}`,
          leaseMs: 60_000,
        }),
      ),
    );

    const acquired = results.filter((r) => r.kind === "acquired");
    const inProgress = results.filter((r) => r.kind === "in_progress");
    expect(acquired.length).toBe(1);
    expect(inProgress.length).toBe(workers - 1);
    expect(acquired[0]!.record.generation).toBe(1);
    expect(acquired[0]!.record.attempts).toBe(1);
  });

  it("webhook: concurrent claim → exactly one acquired", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });

    const workers = 30;
    const results = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        store.claimWebhook({
          key: "evt-1",
          payloadHash: "hash-1",
          owner: `worker-${i}`,
          leaseMs: 60_000,
        }),
      ),
    );

    const acquired = results.filter((r) => r.kind === "acquired");
    const inProgress = results.filter((r) => r.kind === "in_progress");
    expect(acquired.length).toBe(1);
    expect(inProgress.length).toBe(workers - 1);
  });

  it("reconciliation: concurrent claim when due → exactly one acquired", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    await store.scheduleReconciliation({
      key: "job-1",
      subjectId: "pay_1",
      reason: "check",
      dueAt: "2026-01-15T11:00:00.000Z",
    });

    const workers = 25;
    const results = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        store.claimReconciliation({
          key: "job-1",
          owner: `worker-${i}`,
          leaseMs: 60_000,
        }),
      ),
    );

    const acquired = results.filter((r) => r.kind === "acquired");
    const inProgress = results.filter((r) => r.kind === "in_progress");
    expect(acquired.length).toBe(1);
    expect(inProgress.length).toBe(workers - 1);
    expect(acquired[0]!.record.generation).toBe(1);
  });

  it("after lease expiry, a new worker can reclaim with higher generation", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const first = await store.reserveIdempotency({
      key: "k",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 1000,
    });
    expect(first.kind).toBe("acquired");

    // Still active
    const mid = await store.reserveIdempotency({
      key: "k",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 1000,
    });
    expect(mid.kind).toBe("in_progress");

    store.setNowMs(Date.parse("2026-01-15T12:00:02.000Z"));
    const reclaim = await store.reserveIdempotency({
      key: "k",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 1000,
    });
    expect(reclaim.kind).toBe("acquired");
    if (reclaim.kind === "acquired") {
      expect(reclaim.record.generation).toBe(2);
      expect(reclaim.leaseToken).not.toBe(first.kind === "acquired" ? first.leaseToken : "");
    }
  });

  it("stale token complete/fail rejected after reclaim", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const first = await store.reserveIdempotency({
      key: "k",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 1000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") throw new Error("expected acquired");
    const stale = first.leaseToken;

    store.setNowMs(Date.parse("2026-01-15T12:00:02.000Z"));
    const second = await store.reserveIdempotency({
      key: "k",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 5000,
    });
    expect(second.kind).toBe("acquired");
    if (second.kind !== "acquired") throw new Error("expected acquired");

    await expect(
      store.completeIdempotency({
        key: "k",
        leaseToken: stale,
        result: { ok: false },
      }),
    ).rejects.toBeInstanceOf(ReferenceLeaseLostError);

    // Active token succeeds
    await store.completeIdempotency({
      key: "k",
      leaseToken: second.leaseToken,
      result: { ok: true },
    });
    expect(store.getIdempotency("k")?.status).toBe("completed");

    // Webhook fail with stale token
    store.setNowMs(Date.parse("2026-01-15T13:00:00.000Z"));
    const wh1 = await store.claimWebhook({
      key: "wh",
      payloadHash: "h",
      owner: "a",
      leaseMs: 1000,
    });
    expect(wh1.kind).toBe("acquired");
    if (wh1.kind !== "acquired") throw new Error("expected acquired");
    store.setNowMs(Date.parse("2026-01-15T13:00:02.000Z"));
    const wh2 = await store.claimWebhook({
      key: "wh",
      payloadHash: "h",
      owner: "b",
      leaseMs: 5000,
    });
    expect(wh2.kind).toBe("acquired");
    if (wh2.kind !== "acquired") throw new Error("expected acquired");

    let failErr: unknown;
    try {
      await store.failWebhook({
        key: "wh",
        leaseToken: wh1.leaseToken,
        error: "stale worker",
      });
    } catch (e) {
      failErr = e;
    }
    expect(isReferenceLeaseLostError(failErr)).toBe(true);
    expect(failErr).toBeInstanceOf(ReferenceLeaseLostError);

    await store.completeWebhook({
      key: "wh",
      leaseToken: wh2.leaseToken,
    });
    expect(store.getWebhook("wh")?.status).toBe("completed");
  });

  it("webhook payload_hash conflict under concurrent different hashes", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const workers = 40;
    const results = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        store.claimWebhook({
          key: "same-evt",
          payloadHash: i % 2 === 0 ? "hash-A" : "hash-B",
          owner: `w-${i}`,
          leaseMs: 60_000,
        }),
      ),
    );
    const acquired = results.filter((r) => r.kind === "acquired");
    const conflicts = results.filter((r) => r.kind === "payload_hash_conflict");
    const inProgress = results.filter((r) => r.kind === "in_progress");
    expect(acquired.length).toBe(1);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.length + inProgress.length).toBe(workers - 1);
  });

  it("generation is monotonic across reclaim chain", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const gens: number[] = [];
    let prevToken = "";
    for (let step = 0; step < 6; step++) {
      store.setNowMs(Date.parse("2026-01-15T12:00:00.000Z") + step * 120_000);
      const r = await store.reserveIdempotency({
        key: "chain",
        fingerprint: "fp",
        owner: `w-${step}`,
        leaseMs: 30_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") throw new Error("expected acquired");
      gens.push(r.record.generation);
      if (step > 0) {
        expect(r.leaseToken).not.toBe(prevToken);
      }
      prevToken = r.leaseToken;
    }
    expect(gens).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("runClaimContentionHarness passes on memory-relational", async () => {
    const store = createMemoryRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const report = await runClaimContentionHarness(memoryRelationalAsHarnessAdapter(store), {
      workers: 24,
      startMs: Date.parse("2026-01-15T12:00:00.000Z"),
      atomicityNote:
        "memory-relational: promise-chain mutex serializes claim critical sections " +
        "(same-isolate). NOT multi-host. Algorithm is decide* under lock — not get-then-set race.",
    });
    expect(report.concurrentIdempotency.acquired).toBe(1);
    expect(report.staleTokenRejected).toBe(true);
    expect(report.generationChain).toEqual([1, 2, 3, 4, 5]);
    expect(report.concurrentHashConflict.hashConflicts).toBeGreaterThan(0);
  });
});

describe("claim contention (bun:sqlite reference)", () => {
  it("concurrent reserve → one winner; uses single sync transaction", async () => {
    const store = createBunSqliteRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    try {
      expect(store.atomicityModel).toBe(BUN_SQLITE_ATOMICITY_MODEL);
      const workers = 40;
      // Sync claim methods scheduled as concurrent microtasks — each full
      // transaction completes without await (no get-then-set gap).
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) =>
          Promise.resolve().then(() =>
            store.reserveIdempotency({
              key: "sqlite-key",
              fingerprint: "fp",
              owner: `w-${i}`,
              leaseMs: 60_000,
            }),
          ),
        ),
      );
      const acquired = results.filter((r) => r.kind === "acquired");
      const inProgress = results.filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(inProgress.length).toBe(workers - 1);
      expect(acquired[0]!.generation).toBe(1);

      // reclaim + stale token
      store.setNowMs(Date.parse("2026-01-15T12:02:00.000Z"));
      const stale = acquired[0]!.leaseToken;
      const reclaim = store.reserveIdempotency({
        key: "sqlite-key",
        fingerprint: "fp",
        owner: "reclaimer",
        leaseMs: 60_000,
      });
      expect(reclaim.kind).toBe("acquired");
      if (reclaim.kind !== "acquired") throw new Error("expected acquired");
      expect(reclaim.generation).toBe(2);

      expect(() =>
        store.completeIdempotency({
          key: "sqlite-key",
          leaseToken: stale,
          result: {},
        }),
      ).toThrow(ReferenceLeaseLostError);

      store.completeIdempotency({
        key: "sqlite-key",
        leaseToken: reclaim.leaseToken,
        result: { ok: true },
      });
    } finally {
      store.close();
    }
  });

  it("webhook hash conflict + fail fencing under bun:sqlite", () => {
    const store = createBunSqliteRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    try {
      const a = store.claimWebhook({
        key: "e",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 5000,
      });
      expect(a.kind).toBe("acquired");
      const b = store.claimWebhook({
        key: "e",
        payloadHash: "h2",
        owner: "w2",
        leaseMs: 5000,
      });
      expect(b.kind).toBe("payload_hash_conflict");

      if (a.kind !== "acquired") throw new Error("expected acquired");
      store.failWebhook({
        key: "e",
        leaseToken: a.leaseToken,
        error: "handler boom",
        deadLetter: true,
      });
      const again = store.claimWebhook({
        key: "e",
        payloadHash: "h1",
        owner: "w3",
        leaseMs: 5000,
      });
      expect(again.kind).toBe("duplicate_failed");
    } finally {
      store.close();
    }
  });

  it("multi-connection same-file: exactly one winner under concurrent claim", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sql-store-claim-"));
    const path = join(dir, "claims.sqlite");
    const startMs = Date.parse("2026-01-15T12:00:00.000Z");

    // First connection applies schema
    const bootstrap = createBunSqliteRelationalStore({
      path,
      nowMs: startMs,
      applySchemaOnCreate: true,
    });
    bootstrap.close();

    const connA = createBunSqliteRelationalStore({
      path,
      nowMs: startMs,
      applySchemaOnCreate: false,
    });
    // Second connection sees same tables
    const connB = createBunSqliteRelationalStore({
      path,
      nowMs: startMs,
      applySchemaOnCreate: false,
    });

    try {
      const workers = 20;
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) =>
          Promise.resolve().then(() => {
            const conn = i % 2 === 0 ? connA : connB;
            return conn.reserveIdempotency({
              key: "multi-conn-key",
              fingerprint: "fp",
              owner: `w-${i}`,
              leaseMs: 60_000,
            });
          }),
        ),
      );
      const acquired = results.filter((r) => r.kind === "acquired");
      const inProgress = results.filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(inProgress.length).toBe(workers - 1);
      expect(acquired[0]!.generation).toBe(1);
    } finally {
      connA.close();
      connB.close();
    }
  });

  it("runClaimContentionHarness passes on bun:sqlite", async () => {
    const store = createBunSqliteRelationalStore({
      nowMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    try {
      const adapter = {
        setNowMs: (ms: number) => store.setNowMs(ms),
        nowMs: () => store.nowMs(),
        async reserveIdempotency(input: {
          key: string;
          fingerprint: string;
          owner: string;
          leaseMs: number;
        }) {
          return store.reserveIdempotency(input);
        },
        async completeIdempotency(input: { key: string; leaseToken: string; result: unknown }) {
          store.completeIdempotency(input);
        },
        async claimWebhook(input: {
          key: string;
          payloadHash: string;
          owner: string;
          leaseMs: number;
        }) {
          return store.claimWebhook(input);
        },
        async completeWebhook(input: { key: string; leaseToken: string }) {
          store.completeWebhook(input);
        },
        isLeaseLostError: isReferenceLeaseLostError,
      };
      const report = await runClaimContentionHarness(adapter, {
        workers: 20,
        startMs: Date.parse("2026-01-15T12:00:00.000Z"),
        atomicityNote:
          "bun:sqlite: claim evaluate+write inside single sync db.transaction(); " +
          "no await in callback. Conditional complete UPDATE WHERE lease_token. " +
          "NOT multi-host production adapter.",
      });
      expect(report.concurrentIdempotency.acquired).toBe(1);
      expect(report.staleTokenRejected).toBe(true);
      expect(report.generationChain[0]).toBe(1);
      expect(report.generationChain[4]).toBe(5);
    } finally {
      store.close();
    }
  });
});
