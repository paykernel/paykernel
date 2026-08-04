/**
 * Conformance suite for ReconciliationStore.
 *
 * ## Atomicity under test
 * - `claim` must be a single atomic engine-level claim for workers sharing this
 *   store instance. Not application-level get-then-set across processes.
 * - `concurrency: true` exercises **same-isolate** concurrent double-claim only.
 *   Multi-connection concurrent claim is a Phase 11 adapter requirement and is
 *   not proved by this suite alone; declare coordination scope on the manifest.
 *
 * ## listDue recovery (poll path)
 * - `createReconciliationScheduler.claimDue` / `processDue` discover work only
 *   via `listDue` then `claim`. Key-addressed reclaim is not enough.
 * - After abandon + lease expiry, `listDue` must soft-release / re-index the
 *   job so pure poll workers rediscover it (SQL soft-release, Redis re-index).
 */

import type { ReconciliationStore } from "./contracts";
import { isStoreLeaseLostError } from "./contracts";
import type { FakeClock } from "../memory/fake-clock";
import { createFakeClock } from "../memory/fake-clock";
import {
  buildStoreConformanceReport,
  type StoreConformanceCaseResult,
  type StoreConformanceReport,
} from "./idempotency-conformance";

export type ReconciliationStoreConformanceOptions = {
  createStore: (
    ctx: { clock: FakeClock },
  ) => ReconciliationStore | Promise<ReconciliationStore>;
  createClock?: () => FakeClock;
  /** When true (default), run same-isolate concurrent claim cases. */
  concurrency?: boolean;
  name?: string;
  throwOnFailure?: boolean;
};

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

export async function runReconciliationStoreConformanceSuite(
  options: ReconciliationStoreConformanceOptions,
): Promise<StoreConformanceReport> {
  const createClock = options.createClock ?? createFakeClock;
  const suiteName = options.name ?? "ReconciliationStore";
  const concurrency = options.concurrency !== false;
  const results: StoreConformanceCaseResult[] = [];

  results.push(
    await runCase("schedule + claim when due", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      const s = await store.schedule({
        key: "rec_1",
        subjectId: "pay_1",
        reason: "network_timeout",
        dueAt,
      });
      assert(s.kind === "scheduled", `got ${s.kind}`);
      const c = await store.claim({
        key: "rec_1",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(c.kind === "acquired", `got ${c.kind}`);
    }),
  );

  results.push(
    await runCase("not_due before dueAt", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs() + 60_000).toISOString();
      await store.schedule({
        key: "rec_2",
        subjectId: "pay_2",
        reason: "timeout",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_2",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(c.kind === "not_due", `got ${c.kind}`);
    }),
  );

  results.push(
    await runCase("duplicate schedule already_exists", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_3",
        subjectId: "pay_3",
        reason: "x",
        dueAt,
      });
      const s2 = await store.schedule({
        key: "rec_3",
        subjectId: "pay_3",
        reason: "x",
        dueAt,
      });
      assert(s2.kind === "already_exists", `got ${s2.kind}`);
    }),
  );

  results.push(
    await runCase("complete terminal; stale token rejected", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_4",
        subjectId: "pay_4",
        reason: "x",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_4",
        owner: "w1",
        leaseMs: 1_000,
      });
      assert(c.kind === "acquired", "acquired");
      clock.advance(2_000);
      const c2 = await store.claim({
        key: "rec_4",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(c2.kind === "acquired", "reclaim");
      let lost = false;
      try {
        await store.complete({ key: "rec_4", leaseToken: c.leaseToken });
      } catch (e) {
        lost = isStoreLeaseLostError(e);
      }
      assert(lost, "stale rejected");
      await store.complete({ key: "rec_4", leaseToken: c2.leaseToken });
      const terminal = await store.claim({
        key: "rec_4",
        owner: "w3",
        leaseMs: 30_000,
      });
      assert(terminal.kind === "already_terminal", `got ${terminal.kind}`);
    }),
  );

  results.push(
    await runCase("fail with retryAt reschedules", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_5",
        subjectId: "pay_5",
        reason: "x",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_5",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(c.kind === "acquired", "acquired");
      const retryAt = new Date(clock.nowMs() + 5_000).toISOString();
      await store.fail({
        key: "rec_5",
        leaseToken: c.leaseToken,
        error: "temporary",
        retryAt,
      });
      const notYet = await store.claim({
        key: "rec_5",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(notYet.kind === "not_due", `got ${notYet.kind}`);
      clock.advance(5_001);
      const again = await store.claim({
        key: "rec_5",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(again.kind === "acquired", `got ${again.kind}`);
    }),
  );

  results.push(
    await runCase("markManualReview is terminal", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_6",
        subjectId: "pay_6",
        reason: "ambiguous",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_6",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(c.kind === "acquired", "acquired");
      await store.markManualReview({
        key: "rec_6",
        leaseToken: c.leaseToken,
        note: "needs_human",
      });
      const t = await store.claim({
        key: "rec_6",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(t.kind === "already_terminal", `got ${t.kind}`);
      const got = await store.get("rec_6");
      assert(got?.status === "manual_review", "manual_review");
    }),
  );

  results.push(
    await runCase("listDue returns scheduled due rows", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      await store.schedule({
        key: "rec_7",
        subjectId: "pay_7",
        reason: "x",
        dueAt: new Date(clock.nowMs() - 1).toISOString(),
      });
      await store.schedule({
        key: "rec_8",
        subjectId: "pay_8",
        reason: "x",
        dueAt: new Date(clock.nowMs() + 60_000).toISOString(),
      });
      const due = await store.listDue({ limit: 10 });
      assert(due.some((r) => r.key === "rec_7"), "rec_7 due");
      assert(!due.some((r) => r.key === "rec_8"), "rec_8 not due");
    }),
  );

  results.push(
    await runCase(
      "listDue rediscovers abandoned claim after lease expiry (soft-release)",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const dueAt = new Date(clock.nowMs()).toISOString();
        await store.schedule({
          key: "rec_list_abandon",
          subjectId: "pay_list_abandon",
          reason: "indeterminate",
          dueAt,
        });
        const c = await store.claim({
          key: "rec_list_abandon",
          owner: "w_dead",
          leaseMs: 1_000,
        });
        assert(c.kind === "acquired", "acquired");

        // Still leased — must not appear as due scheduled work.
        const mid = await store.listDue({
          now: new Date(clock.nowMs()).toISOString(),
          limit: 50,
        });
        assert(
          !mid.some((r) => r.key === "rec_list_abandon"),
          "active claim must not listDue",
        );

        // Process crash: no complete / renew. Advance past lease expiry.
        clock.advance(1_001);

        // Poll path only (no key-addressed get/claim first) — listDue must soft-release.
        const due = await store.listDue({
          now: new Date(clock.nowMs()).toISOString(),
          limit: 50,
        });
        assert(
          due.some((r) => r.key === "rec_list_abandon"),
          "listDue must soft-release/re-index expired claimed → scheduled",
        );
        const row = due.find((r) => r.key === "rec_list_abandon")!;
        assert(row.status === "scheduled", `status after soft-release: ${row.status}`);
        assert(row.leaseToken === undefined, "lease cleared");

        // Subsequent claim via poll-discovered key must acquire a new token.
        const c2 = await store.claim({
          key: "rec_list_abandon",
          owner: "w_new",
          leaseMs: 30_000,
        });
        assert(c2.kind === "acquired", `reclaim after listDue got ${c2.kind}`);
        assert(c2.leaseToken !== c.leaseToken, "token rotated");
        await store.complete({
          key: "rec_list_abandon",
          leaseToken: c2.leaseToken,
        });
      },
    ),
  );

  results.push(
    await runCase("crash abandon lease then reclaim after expiry", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_crash",
        subjectId: "pay_crash",
        reason: "indeterminate",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_crash",
        owner: "w_dead",
        leaseMs: 1_000,
      });
      assert(c.kind === "acquired", "acquired");
      const abandoned = c.leaseToken;
      clock.advance(1_001);
      const c2 = await store.claim({
        key: "rec_crash",
        owner: "w_new",
        leaseMs: 30_000,
      });
      assert(c2.kind === "acquired", `reclaim got ${c2.kind}`);
      let lost = false;
      try {
        await store.complete({ key: "rec_crash", leaseToken: abandoned });
      } catch (e) {
        lost = isStoreLeaseLostError(e);
      }
      assert(lost, "abandoned token rejected");
      await store.complete({ key: "rec_crash", leaseToken: c2.leaseToken });
    }),
  );

  results.push(
    await runCase("renew extends lease; wrong token rejected", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_renew",
        subjectId: "pay_renew",
        reason: "x",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_renew",
        owner: "w1",
        leaseMs: 5_000,
      });
      assert(c.kind === "acquired", "acquired");
      const renewed = await store.renew({
        key: "rec_renew",
        leaseToken: c.leaseToken,
        leaseMs: 10_000,
      });
      assert(renewed.ok === true, "renew ok");
      const bad = await store.renew({
        key: "rec_renew",
        leaseToken: "not-the-token",
        leaseMs: 10_000,
      });
      assert(bad.ok === false && bad.reason === "lease_lost", "bad renew");
    }),
  );

  results.push(
    await runCase(
      "generation increments on claim/renew; post-renew old token cannot complete",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const dueAt = new Date(clock.nowMs()).toISOString();
        await store.schedule({
          key: "rec_gen",
          subjectId: "pay_gen",
          reason: "x",
          dueAt,
        });
        const c = await store.claim({
          key: "rec_gen",
          owner: "w1",
          leaseMs: 5_000,
        });
        assert(c.kind === "acquired", "acquired");
        const gen1 = c.record.generation;
        assert(typeof gen1 === "number" && gen1 >= 1, "generation on acquire");
        const preRenewToken = c.leaseToken;
        const renewed = await store.renew({
          key: "rec_gen",
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
            key: "rec_gen",
            leaseToken: preRenewToken,
          });
        } catch (e) {
          staleComplete =
            isStoreLeaseLostError(e);
        }
        assert(staleComplete, "pre-renew token must not complete");
        await store.complete({
          key: "rec_gen",
          leaseToken: renewed.leaseToken,
        });
        const got = await store.get("rec_gen");
        assert(got?.status === "completed", "post-renew token completes");
      },
    ),
  );

  results.push(
    await runCase("generation increments on reclaim after expiry", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_gen2",
        subjectId: "pay_gen2",
        reason: "x",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_gen2",
        owner: "w1",
        leaseMs: 1_000,
      });
      assert(c.kind === "acquired", "acquired");
      const gen1 = c.record.generation;
      clock.advance(1_001);
      const c2 = await store.claim({
        key: "rec_gen2",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(c2.kind === "acquired", "reclaim");
      assert(
        c2.record.generation > gen1,
        `generation must increase on reclaim: ${gen1} → ${c2.record.generation}`,
      );
      assert(c2.leaseToken !== c.leaseToken, "reclaim rotates token");
    }),
  );

  if (concurrency) {
    results.push(
      await runCase("concurrent same-isolate claims", async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const dueAt = new Date(clock.nowMs()).toISOString();
        await store.schedule({
          key: "rec_conc",
          subjectId: "pay_c",
          reason: "x",
          dueAt,
        });
        const [a, b] = await Promise.all([
          store.claim({ key: "rec_conc", owner: "w1", leaseMs: 30_000 }),
          store.claim({ key: "rec_conc", owner: "w2", leaseMs: 30_000 }),
        ]);
        const kinds = [a.kind, b.kind].sort();
        assert(
          kinds[0] === "acquired" && kinds[1] === "in_progress",
          `got ${kinds.join(",")}`,
        );
      }),
    );
  } else {
    results.push(skipped("concurrent same-isolate claims", "concurrency: false"));
  }

  results.push(
    await runCase("cleanup removes terminal rows", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const dueAt = new Date(clock.nowMs()).toISOString();
      await store.schedule({
        key: "rec_clean",
        subjectId: "pay_clean",
        reason: "x",
        dueAt,
      });
      const c = await store.claim({
        key: "rec_clean",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(c.kind === "acquired", "acquired");
      await store.complete({ key: "rec_clean", leaseToken: c.leaseToken });
      clock.advance(1);
      const before = new Date(clock.nowMs() + 1).toISOString();
      const cleaned = await store.deleteExpired({ before });
      assert(cleaned.deleted >= 1, "deleted");
      assert((await store.get("rec_clean")) === undefined, "gone");
    }),
  );

  {
    const clock = createClock();
    const store = await options.createStore({ clock });
    if (typeof store.withTransaction === "function") {
      results.push(
        await runCase("withTransaction rollback leaves no partial schedule", async () => {
          let threw = false;
          try {
            await store.withTransaction!(async () => {
              const s = await store.schedule({
                key: "rec_tx",
                subjectId: "pay_tx",
                reason: "x",
                dueAt: new Date(clock.nowMs()).toISOString(),
              });
              assert(s.kind === "scheduled", "scheduled inside tx");
              throw new Error("force_rollback");
            });
          } catch (e) {
            threw = e instanceof Error && e.message === "force_rollback";
          }
          assert(threw, "expected force_rollback");
          const got = await store.get("rec_tx");
          assert(got === undefined, "partial schedule must be rolled back");
        }),
      );
    } else {
      results.push(
        skipped(
          "withTransaction rollback leaves no partial schedule",
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
