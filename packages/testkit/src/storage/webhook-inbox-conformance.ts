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
