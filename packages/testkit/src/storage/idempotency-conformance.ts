/**
 * Conformance suite for lease-aware IdempotencyStore.
 *
 * ## Atomicity under test
 * - `reserve` must behave as a single atomic engine-level claim for the
 *   workers that share this store instance.
 * - `concurrency: true` (default) runs **same-isolate** concurrent double-reserve
 *   only. That is sufficient to catch obvious get-then-set races in memory, but
 *   **cannot** mechanically fail multi-host adapters that pass same-process tests
 *   while racing across two connections. Phase 11 durable adapters must prove
 *   multi-connection concurrent claim separately and declare coordination scope
 *   honestly on `StorageAdapterManifest` (never advertise multi-process safety
 *   from single-isolate conformance alone).
 *
 * Crash model under test: acquire then abandon (no complete) — after lease
 * expiry another owner reclaims; stale fencing token is rejected.
 */

import type { IdempotencyStore } from "./contracts";
import { isStoreLeaseLostError } from "./contracts";
import type { FakeClock } from "../memory/fake-clock";
import { createFakeClock } from "../memory/fake-clock";

export type IdempotencyStoreConformanceOptions = {
  createStore: (ctx: { clock: FakeClock }) => IdempotencyStore | Promise<IdempotencyStore>;
  /** Optional shared clock factory; default createFakeClock(). */
  createClock?: () => FakeClock;
  /**
   * When true (default), run same-isolate concurrent double-reserve cases.
   * Does **not** prove multi-process / multi-connection claim atomicity.
   * Memory adapters: keep true for self-proof; multi-host proof is Phase 11.
   */
  concurrency?: boolean;
  /** Label for reports. */
  name?: string;
  /** Default true: throw when any case fails. */
  throwOnFailure?: boolean;
};

export type StoreConformanceCaseResult = {
  name: string;
  ok: boolean;
  status: "passed" | "failed" | "skipped";
  error?: string;
  detail?: string;
};

export type StoreConformanceReport = {
  name: string;
  ok: boolean;
  results: StoreConformanceCaseResult[];
  passed: number;
  failed: number;
  skipped: number;
};

export function buildStoreConformanceReport(
  name: string,
  results: StoreConformanceCaseResult[],
): StoreConformanceReport {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "passed") passed++;
    else if (r.status === "failed") failed++;
    else skipped++;
  }
  return {
    name,
    ok: failed === 0,
    results,
    passed,
    failed,
    skipped,
  };
}

async function runCase(
  name: string,
  fn: () => Promise<void>,
): Promise<StoreConformanceCaseResult> {
  try {
    await fn();
    return { name, ok: true, status: "passed" };
  } catch (err) {
    return {
      name,
      ok: false,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function skipped(name: string, detail: string): StoreConformanceCaseResult {
  return { name, ok: true, status: "skipped", detail };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/**
 * Run lease/idempotency conformance against a store factory.
 * Throws when any case fails if `throwOnFailure` is not false.
 */
export async function runIdempotencyStoreConformanceSuite(
  options: IdempotencyStoreConformanceOptions,
): Promise<StoreConformanceReport> {
  const createClock = options.createClock ?? createFakeClock;
  const suiteName = options.name ?? "IdempotencyStore";
  const concurrency = options.concurrency !== false;
  const results: StoreConformanceCaseResult[] = [];

  results.push(
    await runCase("reserve acquires lease", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k1",
        fingerprint: "fp-a",
        owner: "w1",
        leaseMs: 5_000,
      });
      assert(r.kind === "acquired", `expected acquired, got ${r.kind}`);
      assert(r.leaseToken.length > 0, "lease token required");
      const got = await store.get("k1");
      assert(got?.status === "reserved", "status reserved");
    }),
  );

  results.push(
    await runCase("duplicate reserve while lease active → in_progress", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      await store.reserve({
        key: "k2",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 60_000,
      });
      const r2 = await store.reserve({
        key: "k2",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 60_000,
      });
      assert(r2.kind === "in_progress", `expected in_progress, got ${r2.kind}`);
    }),
  );

  results.push(
    await runCase("fingerprint conflict", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      await store.reserve({
        key: "k3",
        fingerprint: "fp-a",
        owner: "w1",
        leaseMs: 60_000,
      });
      const r2 = await store.reserve({
        key: "k3",
        fingerprint: "fp-b",
        owner: "w2",
        leaseMs: 60_000,
      });
      assert(
        r2.kind === "fingerprint_conflict",
        `expected fingerprint_conflict, got ${r2.kind}`,
      );
    }),
  );

  results.push(
    await runCase("complete requires lease token; second complete fails", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k4",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 60_000,
      });
      assert(r.kind === "acquired", "acquired");
      await store.complete({
        key: "k4",
        leaseToken: r.leaseToken,
        result: { ok: true },
      });
      const done = await store.reserve({
        key: "k4",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 60_000,
      });
      assert(done.kind === "already_completed", `got ${done.kind}`);
      let threw = false;
      try {
        await store.complete({
          key: "k4",
          leaseToken: r.leaseToken,
          result: { ok: false },
        });
      } catch (e) {
        threw = isStoreLeaseLostError(e);
      }
      assert(threw, "stale complete must fail");
    }),
  );

  results.push(
    await runCase("markIndeterminate preserves uncertain outcome", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k5",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 60_000,
      });
      assert(r.kind === "acquired", "acquired");
      await store.markIndeterminate({
        key: "k5",
        leaseToken: r.leaseToken,
        reason: "network_timeout",
      });
      const again = await store.reserve({
        key: "k5",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 60_000,
      });
      assert(again.kind === "indeterminate", `got ${again.kind}`);
      // Must NOT silently become failure/completed
      const got = await store.get("k5");
      assert(got?.status === "indeterminate", "status indeterminate");
    }),
  );

  results.push(
    await runCase("fake-clock lease expiry allows re-reserve", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k6",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 1_000,
      });
      assert(r.kind === "acquired", "acquired");
      clock.advance(1_001);
      const r2 = await store.reserve({
        key: "k6",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 1_000,
      });
      assert(r2.kind === "acquired", `expected re-acquire after expiry, got ${r2.kind}`);
      // Stale token must not complete
      let lost = false;
      try {
        await store.complete({
          key: "k6",
          leaseToken: r.leaseToken,
          result: {},
        });
      } catch (e) {
        lost = isStoreLeaseLostError(e);
      }
      assert(lost, "stale fencing token must be rejected");
    }),
  );

  results.push(
    await runCase("renew extends lease; wrong token rejected", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k7",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 5_000,
      });
      assert(r.kind === "acquired", "acquired");
      const renewed = await store.renew({
        key: "k7",
        leaseToken: r.leaseToken,
        leaseMs: 10_000,
      });
      assert(renewed.ok === true, "renew ok");
      const bad = await store.renew({
        key: "k7",
        leaseToken: "not-the-token",
        leaseMs: 10_000,
      });
      assert(bad.ok === false && bad.reason === "lease_lost", "bad renew");
    }),
  );

  results.push(
    await runCase(
      "generation increments on reserve/renew; post-renew old token cannot complete",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const r = await store.reserve({
          key: "k_gen",
          fingerprint: "fp",
          owner: "w1",
          leaseMs: 5_000,
        });
        assert(r.kind === "acquired", "acquired");
        const gen1 = r.record.generation;
        assert(typeof gen1 === "number" && gen1 >= 1, "generation on acquire");
        const preRenewToken = r.leaseToken;
        const renewed = await store.renew({
          key: "k_gen",
          leaseToken: preRenewToken,
          leaseMs: 10_000,
        });
        assert(renewed.ok === true, "renew ok");
        if (!renewed.ok) return;
        assert(
          renewed.record.generation > gen1,
          `generation must increase after renew: ${gen1} → ${renewed.record.generation}`,
        );
        assert(
          renewed.leaseToken !== preRenewToken,
          "renew must rotate leaseToken",
        );
        let staleComplete = false;
        try {
          await store.complete({
            key: "k_gen",
            leaseToken: preRenewToken,
            result: { should: "not_apply" },
          });
        } catch (e) {
          staleComplete =
            isStoreLeaseLostError(e);
        }
        assert(staleComplete, "pre-renew token must not complete");
        await store.complete({
          key: "k_gen",
          leaseToken: renewed.leaseToken,
          result: { ok: true },
        });
        const got = await store.get("k_gen");
        assert(got?.status === "completed", "post-renew token completes");
      },
    ),
  );

  results.push(
    await runCase(
      "indeterminate blocks reserve permanently; deleteExpired skips indeterminate",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const r = await store.reserve({
          key: "k_ind",
          fingerprint: "fp",
          owner: "w1",
          leaseMs: 60_000,
        });
        assert(r.kind === "acquired", "acquired");
        await store.markIndeterminate({
          key: "k_ind",
          leaseToken: r.leaseToken,
          reason: "network_timeout",
        });
        const blocked = await store.reserve({
          key: "k_ind",
          fingerprint: "fp",
          owner: "w2",
          leaseMs: 60_000,
        });
        assert(blocked.kind === "indeterminate", `got ${blocked.kind}`);
        // Must not hand out a new lease for mutation replay
        assert(
          !("leaseToken" in blocked) ||
            (blocked as { leaseToken?: string }).leaseToken === undefined,
          "indeterminate must not issue leaseToken",
        );
        clock.advance(60_000);
        const before = new Date(clock.nowMs() + 1).toISOString();
        await store.deleteExpired({ before });
        const still = await store.get("k_ind");
        assert(
          still?.status === "indeterminate",
          "deleteExpired must not remove indeterminate by default (A4)",
        );
        const stillBlocked = await store.reserve({
          key: "k_ind",
          fingerprint: "fp",
          owner: "w3",
          leaseMs: 60_000,
        });
        assert(
          stillBlocked.kind === "indeterminate",
          "still blocked after cleanup attempt",
        );
      },
    ),
  );

  results.push(
    await runCase("generation increments on re-reserve after expiry", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k_gen2",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 1_000,
      });
      assert(r.kind === "acquired", "acquired");
      const gen1 = r.record.generation;
      clock.advance(1_001);
      const r2 = await store.reserve({
        key: "k_gen2",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      assert(r2.kind === "acquired", "re-acquire");
      assert(
        r2.record.generation > gen1,
        `generation must increase on reclaim: ${gen1} → ${r2.record.generation}`,
      );
      assert(r2.leaseToken !== r.leaseToken, "reclaim rotates token");
    }),
  );

  // Crash boundary: worker acquires then process dies (no complete).
  // After lease expiry a new worker reclaims; stale token is rejected.
  results.push(
    await runCase("crash abandon lease then reclaim after expiry", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k_crash",
        fingerprint: "fp",
        owner: "w_dead",
        leaseMs: 2_000,
      });
      assert(r.kind === "acquired", "acquired");
      // simulate process crash: drop token, do not complete
      const abandonedToken = r.leaseToken;
      clock.advance(2_001);
      const r2 = await store.reserve({
        key: "k_crash",
        fingerprint: "fp",
        owner: "w_new",
        leaseMs: 5_000,
      });
      assert(r2.kind === "acquired", `reclaim after crash, got ${r2.kind}`);
      let lost = false;
      try {
        await store.complete({
          key: "k_crash",
          leaseToken: abandonedToken,
          result: { should: "not_apply" },
        });
      } catch (e) {
        lost = isStoreLeaseLostError(e);
      }
      assert(lost, "abandoned token rejected");
      await store.complete({
        key: "k_crash",
        leaseToken: r2.leaseToken,
        result: { ok: true },
      });
    }),
  );

  if (concurrency) {
    results.push(
      await runCase("same-isolate concurrent reserves serialize", async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const [a, b] = await Promise.all([
          store.reserve({
            key: "k8",
            fingerprint: "fp",
            owner: "w1",
            leaseMs: 60_000,
          }),
          store.reserve({
            key: "k8",
            fingerprint: "fp",
            owner: "w2",
            leaseMs: 60_000,
          }),
        ]);
        const kinds = [a.kind, b.kind].sort();
        assert(
          kinds[0] === "acquired" && kinds[1] === "in_progress",
          `expected one acquired + one in_progress, got ${kinds.join(",")}`,
        );
      }),
    );
  } else {
    results.push(
      skipped(
        "same-isolate concurrent reserves serialize",
        "concurrency: false",
      ),
    );
  }

  results.push(
    await runCase("deleteExpired removes old terminal rows", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const r = await store.reserve({
        key: "k9",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 60_000,
      });
      assert(r.kind === "acquired", "acquired");
      await store.complete({
        key: "k9",
        leaseToken: r.leaseToken,
        result: { v: 1 },
      });
      clock.advance(60_000);
      const before = new Date(clock.nowMs()).toISOString();
      const cleaned = await store.deleteExpired({ before });
      assert(cleaned.deleted >= 1, "expected delete");
      assert((await store.get("k9")) === undefined, "gone");
    }),
  );

  // Transaction rollback: optional when withTransaction is implemented.
  {
    const clock = createClock();
    const store = await options.createStore({ clock });
    if (typeof store.withTransaction === "function") {
      results.push(
        await runCase("withTransaction rollback leaves no partial claim", async () => {
          let threw = false;
          try {
            await store.withTransaction!(async () => {
              const r = await store.reserve({
                key: "k_tx",
                fingerprint: "fp",
                owner: "w1",
                leaseMs: 60_000,
              });
              assert(r.kind === "acquired", "acquired inside tx");
              throw new Error("force_rollback");
            });
          } catch (e) {
            threw = e instanceof Error && e.message === "force_rollback";
          }
          assert(threw, "expected force_rollback");
          const got = await store.get("k_tx");
          assert(got === undefined, "partial claim must be rolled back");
        }),
      );
    } else {
      results.push(
        skipped(
          "withTransaction rollback leaves no partial claim",
          "store does not implement withTransaction",
        ),
      );
    }
  }

  const report = buildStoreConformanceReport(suiteName, results);
  if (!report.ok && options.throwOnFailure !== false) {
    const failed = results.filter((r) => r.status === "failed");
    throw new Error(
      `${suiteName} conformance failed:\n` +
        failed.map((f) => `  - ${f.name}: ${f.error}`).join("\n"),
    );
  }
  return report;
}
