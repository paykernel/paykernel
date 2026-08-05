/**
 * Conformance suite for WebhookInboxStore.
 *
 * ## Atomicity under test
 * - `claim` must be a single atomic engine-level claim for workers sharing this
 *   store instance. Not application-level get-then-set across processes.
 * - `concurrency: true` exercises **same-isolate** concurrent double-claim only.
 *   Multi-connection concurrent claim is a Phase 11 adapter requirement and is
 *   not proved by this suite alone; declare coordination scope on the manifest.
 *
 * Crash model: claim then abandon (no complete) — after lease expiry another
 * worker reclaims; stale token rejected.
 *
 * ## Required gate coverage (B4 / ackAfterClaim parity)
 * - Pending rows with future `availableAt` → `{ kind: "not_available" }` (no attempt++).
 * - `fail({ restoreAttempt: true })` decrements `attempts` by 1 (floor 0).
 * - Soft-release of expired claimed restores one attempt (WEBHOOKS-1); direct
 *   reclaim of expired claimed also must not burn attempts.
 */

import type { WebhookInboxStore } from "./contracts";
import { isStoreLeaseLostError } from "./contracts";
import type { FakeClock } from "../memory/fake-clock";
import { createFakeClock } from "../memory/fake-clock";
import {
  buildStoreConformanceReport,
  type StoreConformanceCaseResult,
  type StoreConformanceReport,
} from "./idempotency-conformance";

export type WebhookInboxStoreConformanceOptions = {
  createStore: (ctx: { clock: FakeClock }) => WebhookInboxStore | Promise<WebhookInboxStore>;
  createClock?: () => FakeClock;
  /**
   * When true (default), run same-isolate concurrent double-claim cases.
   */
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

export async function runWebhookInboxStoreConformanceSuite(
  options: WebhookInboxStoreConformanceOptions,
): Promise<StoreConformanceReport> {
  const createClock = options.createClock ?? createFakeClock;
  const suiteName = options.name ?? "WebhookInboxStore";
  const concurrency = options.concurrency !== false;
  const results: StoreConformanceCaseResult[] = [];

  results.push(
    await runCase("claim acquires; duplicate claim in_progress", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_1",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(a.kind === "acquired", `got ${a.kind}`);
      const b = await store.claim({
        key: "evt_1",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(b.kind === "in_progress", `got ${b.kind}`);
    }),
  );

  results.push(
    await runCase("payload hash conflict", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      await store.claim({
        key: "evt_2",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 30_000,
      });
      const b = await store.claim({
        key: "evt_2",
        payloadHash: "h2",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(b.kind === "payload_hash_conflict", `got ${b.kind}`);
    }),
  );

  results.push(
    await runCase("complete is terminal for duplicates", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_3",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(a.kind === "acquired", "acquired");
      await store.complete({ key: "evt_3", leaseToken: a.leaseToken });
      const b = await store.claim({
        key: "evt_3",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(b.kind === "already_completed", `got ${b.kind}`);
    }),
  );

  results.push(
    await runCase(
      "WEBHOOKS-1 terminal completed before payload_hash_conflict",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const a = await store.claim({
          key: "evt_term_hash",
          payloadHash: "h1",
          owner: "w1",
          leaseMs: 30_000,
        });
        assert(a.kind === "acquired", "acquired");
        await store.complete({
          key: "evt_term_hash",
          leaseToken: a.leaseToken,
        });
        const b = await store.claim({
          key: "evt_term_hash",
          payloadHash: "h2-different",
          owner: "w2",
          leaseMs: 30_000,
        });
        assert(
          b.kind === "already_completed",
          `terminal must win before hash conflict, got ${b.kind}`,
        );
      },
    ),
  );

  results.push(
    await runCase(
      "WEBHOOKS-1 terminal dead_letter before payload_hash_conflict",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const a = await store.claim({
          key: "evt_dl_hash",
          payloadHash: "h1",
          owner: "w1",
          leaseMs: 30_000,
        });
        assert(a.kind === "acquired", "acquired");
        await store.fail({
          key: "evt_dl_hash",
          leaseToken: a.leaseToken,
          error: "poison",
          deadLetter: true,
        });
        const b = await store.claim({
          key: "evt_dl_hash",
          payloadHash: "h2-different",
          owner: "w2",
          leaseMs: 30_000,
        });
        assert(
          b.kind === "duplicate_failed",
          `dead_letter must win before hash conflict, got ${b.kind}`,
        );
      },
    ),
  );

  results.push(
    await runCase("stale lease token cannot complete", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_4",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 1_000,
      });
      assert(a.kind === "acquired", "acquired");
      clock.advance(2_000);
      const b = await store.claim({
        key: "evt_4",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(b.kind === "acquired", `reclaim got ${b.kind}`);
      let lost = false;
      try {
        await store.complete({ key: "evt_4", leaseToken: a.leaseToken });
      } catch (e) {
        lost = isStoreLeaseLostError(e);
      }
      assert(lost, "stale complete rejected");
      await store.complete({ key: "evt_4", leaseToken: b.leaseToken });
    }),
  );

  results.push(
    await runCase("fail → retryable list; dead letter terminal", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_5",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(a.kind === "acquired", "acquired");
      await store.fail({
        key: "evt_5",
        leaseToken: a.leaseToken,
        error: "handler_error",
        retryAfterMs: 0,
      });
      const retryable = await store.listRetryable({ limit: 10 });
      assert(
        retryable.some((r) => r.key === "evt_5"),
        "retryable",
      );
      const c = await store.claim({
        key: "evt_5",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(c.kind === "acquired", "reclaim");
      await store.fail({
        key: "evt_5",
        leaseToken: c.leaseToken,
        error: "fatal",
        deadLetter: true,
      });
      const d = await store.claim({
        key: "evt_5",
        payloadHash: "h1",
        owner: "w3",
        leaseMs: 30_000,
      });
      assert(d.kind === "duplicate_failed", `got ${d.kind}`);
    }),
  );

  results.push(
    await runCase(
      "claim respects availableAt: pending future → not_available (no attempt++)",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const a = await store.claim({
          key: "evt_navail",
          payloadHash: "h1",
          owner: "w1",
          leaseMs: 30_000,
        });
        assert(a.kind === "acquired", "acquired");
        assert(a.record.attempts === 1, `attempts after claim: ${a.record.attempts}`);
        await store.fail({
          key: "evt_navail",
          leaseToken: a.leaseToken,
          error: "backoff",
          retryAfterMs: 60_000,
        });
        const mid = await store.get("evt_navail");
        assert(mid?.status === "pending", "pending after fail");
        assert(mid?.attempts === 1, "fail without restoreAttempt keeps attempts");
        const early = await store.claim({
          key: "evt_navail",
          payloadHash: "h1",
          owner: "w2",
          leaseMs: 30_000,
        });
        assert(
          early.kind === "not_available",
          `expected not_available during backoff, got ${early.kind}`,
        );
        if (early.kind === "not_available") {
          assert(
            early.availableAt === mid!.availableAt,
            "not_available.availableAt must echo record.availableAt",
          );
          assert(
            early.record.availableAt === mid!.availableAt,
            "not_available.record.availableAt must match",
          );
        }
        const afterEarly = await store.get("evt_navail");
        assert(
          afterEarly?.attempts === 1,
          "not_available must not increment attempts",
        );
        assert(
          afterEarly?.status === "pending",
          "not_available must leave row pending",
        );
        const listed = await store.listRetryable({ limit: 10 });
        assert(
          !listed.some((r) => r.key === "evt_navail"),
          "listRetryable must gate on availableAt (same as claim)",
        );
        clock.advance(60_000);
        const late = await store.claim({
          key: "evt_navail",
          payloadHash: "h1",
          owner: "w3",
          leaseMs: 30_000,
        });
        assert(late.kind === "acquired", `after availableAt: got ${late.kind}`);
        if (late.kind === "acquired") {
          assert(
            late.record.attempts === 2,
            `reclaim after due should attempt++: ${late.record.attempts}`,
          );
        }
      },
    ),
  );

  results.push(
    await runCase(
      "fail({ restoreAttempt: true }) decrements attempts (parking claim parity)",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const a = await store.claim({
          key: "evt_restore",
          payloadHash: "h1",
          owner: "w1",
          leaseMs: 30_000,
        });
        assert(a.kind === "acquired", "acquired");
        assert(a.record.attempts === 1, "first claim attempts=1");
        await store.fail({
          key: "evt_restore",
          leaseToken: a.leaseToken,
          error: "ack_after_claim: scheduled for durable worker",
          retryAfterMs: 0,
          restoreAttempt: true,
        });
        const parked = await store.get("evt_restore");
        assert(parked?.status === "pending", "pending after park fail");
        assert(
          parked?.attempts === 0,
          `restoreAttempt must undo parking claim attempt (got ${parked?.attempts})`,
        );
        // Second acquire + restore again (floor at 0).
        const b = await store.claim({
          key: "evt_restore",
          payloadHash: "h1",
          owner: "w2",
          leaseMs: 30_000,
        });
        assert(b.kind === "acquired", "reclaim");
        if (b.kind !== "acquired") return;
        assert(b.record.attempts === 1, "reclaim after restore → attempts=1");
        await store.fail({
          key: "evt_restore",
          leaseToken: b.leaseToken,
          error: "handler_error",
          retryAfterMs: 0,
          // restoreAttempt omitted / false — keeps attempts
        });
        const afterFail = await store.get("evt_restore");
        assert(
          afterFail?.attempts === 1,
          `fail without restoreAttempt keeps attempts (got ${afterFail?.attempts})`,
        );
        // Floor: restoreAttempt on attempts=0 path via park from 0 would not go negative.
        const c = await store.claim({
          key: "evt_restore",
          payloadHash: "h1",
          owner: "w3",
          leaseMs: 30_000,
        });
        assert(c.kind === "acquired", "third claim");
        if (c.kind !== "acquired") return;
        // attempts was 1, claim → 2; restore → 1
        assert(c.record.attempts === 2, `third claim attempts=${c.record.attempts}`);
        await store.fail({
          key: "evt_restore",
          leaseToken: c.leaseToken,
          error: "park",
          retryAfterMs: 5_000,
          restoreAttempt: true,
        });
        const restored = await store.get("evt_restore");
        assert(
          restored?.attempts === 1,
          `restoreAttempt: 2→1 (got ${restored?.attempts})`,
        );
      },
    ),
  );

  results.push(
    await runCase("crash abandon lease then reclaim after expiry", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_crash",
        payloadHash: "h1",
        owner: "w_dead",
        leaseMs: 1_500,
      });
      assert(a.kind === "acquired", "acquired");
      if (a.kind !== "acquired") return;
      assert(a.record.attempts === 1, "first claim attempts=1");
      const abandoned = a.leaseToken;
      // process crash: no complete, no renew
      clock.advance(1_501);
      const b = await store.claim({
        key: "evt_crash",
        payloadHash: "h1",
        owner: "w_new",
        leaseMs: 30_000,
      });
      assert(b.kind === "acquired", `reclaim got ${b.kind}`);
      if (b.kind === "acquired") {
        // WEBHOOKS-1: direct reclaim of expired claimed must not burn attempts
        assert(
          b.record.attempts === 1,
          `crash reclaim must keep attempts=1 (got ${b.record.attempts})`,
        );
      }
      let lost = false;
      try {
        await store.complete({ key: "evt_crash", leaseToken: abandoned });
      } catch (e) {
        lost = isStoreLeaseLostError(e);
      }
      assert(lost, "abandoned token rejected");
      await store.complete({ key: "evt_crash", leaseToken: b.leaseToken });
    }),
  );

  results.push(
    await runCase(
      "WEBHOOKS-1: soft-release restores attempt; get/listRetryable do not burn budget",
      async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const a = await store.claim({
          key: "evt_soft_restore",
          payloadHash: "h1",
          owner: "w_dead",
          leaseMs: 1_000,
        });
        assert(a.kind === "acquired", "acquired");
        if (a.kind !== "acquired") return;
        assert(a.record.attempts === 1, "first claim attempts=1");
        clock.advance(1_001);
        // Soft-release via get must restore unfinished attempt
        const afterGet = await store.get("evt_soft_restore");
        assert(afterGet?.status === "pending", "soft-release → pending");
        assert(
          afterGet?.attempts === 0,
          `get soft-release must restore attempt (got ${afterGet?.attempts})`,
        );
        // Reclaim after soft-release is a pending claim → attempts++
        const b = await store.claim({
          key: "evt_soft_restore",
          payloadHash: "h1",
          owner: "w2",
          leaseMs: 1_000,
        });
        assert(b.kind === "acquired", "reclaim after soft-release");
        if (b.kind !== "acquired") return;
        assert(
          b.record.attempts === 1,
          `pending reclaim after soft-release → attempts=1 (got ${b.record.attempts})`,
        );
        clock.advance(1_001);
        // listRetryable soft-release path also restores
        const listed = await store.listRetryable({ limit: 10 });
        const row = listed.find((r) => r.key === "evt_soft_restore");
        assert(row !== undefined, "listRetryable rediscovers soft-released row");
        assert(
          row!.attempts === 0,
          `listRetryable soft-release must restore attempt (got ${row!.attempts})`,
        );
      },
    ),
  );

  results.push(
    await runCase("renew extends lease; wrong token rejected", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_renew",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 5_000,
      });
      assert(a.kind === "acquired", "acquired");
      const renewed = await store.renew({
        key: "evt_renew",
        leaseToken: a.leaseToken,
        leaseMs: 10_000,
      });
      assert(renewed.ok === true, "renew ok");
      const bad = await store.renew({
        key: "evt_renew",
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
        const a = await store.claim({
          key: "evt_gen",
          payloadHash: "h1",
          owner: "w1",
          leaseMs: 5_000,
        });
        assert(a.kind === "acquired", "acquired");
        const gen1 = a.record.generation;
        assert(typeof gen1 === "number" && gen1 >= 1, "generation on acquire");
        const preRenewToken = a.leaseToken;
        const renewed = await store.renew({
          key: "evt_gen",
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
            key: "evt_gen",
            leaseToken: preRenewToken,
          });
        } catch (e) {
          staleComplete =
            isStoreLeaseLostError(e);
        }
        assert(staleComplete, "pre-renew token must not complete");
        await store.complete({
          key: "evt_gen",
          leaseToken: renewed.leaseToken,
        });
        const got = await store.get("evt_gen");
        assert(got?.status === "completed", "post-renew token completes");
      },
    ),
  );

  results.push(
    await runCase("generation increments on reclaim after expiry", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_gen2",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 1_000,
      });
      assert(a.kind === "acquired", "acquired");
      const gen1 = a.record.generation;
      clock.advance(1_001);
      const b = await store.claim({
        key: "evt_gen2",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      assert(b.kind === "acquired", "reclaim");
      assert(
        b.record.generation > gen1,
        `generation must increase on reclaim: ${gen1} → ${b.record.generation}`,
      );
      assert(b.leaseToken !== a.leaseToken, "reclaim rotates token");
    }),
  );

  if (concurrency) {
    results.push(
      await runCase("concurrent same-isolate claims", async () => {
        const clock = createClock();
        const store = await options.createStore({ clock });
        const [a, b] = await Promise.all([
          store.claim({
            key: "evt_6",
            payloadHash: "h1",
            owner: "w1",
            leaseMs: 30_000,
          }),
          store.claim({
            key: "evt_6",
            payloadHash: "h1",
            owner: "w2",
            leaseMs: 30_000,
          }),
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
    await runCase("cleanup removes completed", async () => {
      const clock = createClock();
      const store = await options.createStore({ clock });
      const a = await store.claim({
        key: "evt_7",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 30_000,
      });
      assert(a.kind === "acquired", "acquired");
      await store.complete({ key: "evt_7", leaseToken: a.leaseToken });
      clock.advance(1);
      const before = new Date(clock.nowMs() + 1).toISOString();
      const cleaned = await store.deleteExpired({ before });
      assert(cleaned.deleted >= 1, "deleted");
    }),
  );

  {
    const clock = createClock();
    const store = await options.createStore({ clock });
    if (typeof store.withTransaction === "function") {
      results.push(
        await runCase("withTransaction rollback leaves no partial claim", async () => {
          let threw = false;
          try {
            await store.withTransaction!(async () => {
              const r = await store.claim({
                key: "evt_tx",
                payloadHash: "h1",
                owner: "w1",
                leaseMs: 30_000,
              });
              assert(r.kind === "acquired", "acquired inside tx");
              throw new Error("force_rollback");
            });
          } catch (e) {
            threw = e instanceof Error && e.message === "force_rollback";
          }
          assert(threw, "expected force_rollback");
          const got = await store.get("evt_tx");
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
