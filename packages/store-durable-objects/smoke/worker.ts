/**
 * Live Cloudflare Durable Object smoke Worker for @paykernel/store-durable-objects.
 *
 * Account: Manhali.official (see smoke/wrangler.toml).
 *
 * Endpoints:
 *   GET  /health  — DO binding present
 *   GET|POST /smoke — migrate-via-DO-init + claims + concurrency + partitions + lease + alarms
 *
 * Uses createDoPaymentStores({ namespace: env.PAYMENTS_DO, sharding }) — Workers binding only.
 * SQLite-backed DO only (new_sqlite_classes).
 */

import { DurableObject } from "cloudflare:workers";
import {
  createDoPaymentStores,
  DO_STORAGE_ADAPTER_MANIFEST,
  resolveDoShardName,
  getDoStub,
  PaymentsStoreObject,
  type DoStorageLike,
  type DoNamespaceLike,
} from "../src/index";

export interface Env {
  PAYMENTS_DO: DurableObjectNamespace;
}

type SmokeStep = {
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
};

function uniqueRunId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `sm${Date.now().toString(36)}${rand}`;
}

/**
 * Real Workers Durable Object class (SQLite-backed via wrangler new_sqlite_classes).
 * Wraps PaymentsStoreObject; exposes RPC methods for the Worker client.
 */
export class PaymentsStoreDurableObject extends DurableObject<Env> {
  private readonly inner: PaymentsStoreObject;
  private init: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Structural cast: Workers SQLite storage satisfies DoStorageLike (sql + transactionSync).
    this.inner = new PaymentsStoreObject({
      storage: ctx.storage as unknown as DoStorageLike,
      alarms: {
        enabled: true,
        maxRetries: 3,
        baseBackoffMs: 200,
        maxBackoffMs: 5_000,
      },
    });
    // DO lifecycle schema ensure (not package import auto-migrate).
    this.init = ctx.blockConcurrencyWhile(async () => {
      await this.inner.ensureSchema();
    });
  }

  private async ready(): Promise<void> {
    await this.init;
  }

  /**
   * Required RPC (hash sharding / DO-1). First writer seals `partitions`.
   * See REQUIRED_DO_RPC_METHODS — do not omit the next layout method.
   */
  async bindHashPartitionLayout(partitions: number) {
    await this.ready();
    return this.inner.bindHashPartitionLayout(partitions);
  }

  // ── Idempotency RPC ──────────────────────────────────────────────────────

  async reserveIdempotency(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.reserveIdempotency(input as never, tableNamespace as never);
  }

  async renewIdempotency(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.renewIdempotency(input as never, tableNamespace as never);
  }

  async completeIdempotency(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.completeIdempotency(input as never, tableNamespace as never);
  }

  async markIdempotencyIndeterminate(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.markIdempotencyIndeterminate(
      input as never,
      tableNamespace as never,
    );
  }

  async getIdempotency(key: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.getIdempotency(key as never, tableNamespace as never);
  }

  async deleteExpiredIdempotency(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.deleteExpiredIdempotency(
      input as never,
      tableNamespace as never,
    );
  }

  // ── Webhook RPC ──────────────────────────────────────────────────────────

  async claimWebhook(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.claimWebhook(input as never, tableNamespace as never);
  }

  async renewWebhook(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.renewWebhook(input as never, tableNamespace as never);
  }

  async completeWebhook(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.completeWebhook(input as never, tableNamespace as never);
  }

  async failWebhook(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.failWebhook(input as never, tableNamespace as never);
  }

  async getWebhook(key: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.getWebhook(key as never, tableNamespace as never);
  }

  async peekRetryableWebhooks(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.peekRetryableWebhooks(
      input as never,
      tableNamespace as never,
    );
  }

  async listRetryableWebhooks(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.listRetryableWebhooks(
      input as never,
      tableNamespace as never,
    );
  }

  async deleteExpiredWebhooks(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.deleteExpiredWebhooks(
      input as never,
      tableNamespace as never,
    );
  }

  // ── Reconciliation RPC ───────────────────────────────────────────────────

  async scheduleReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.scheduleReconciliation(
      input as never,
      tableNamespace as never,
    );
  }

  async claimReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.claimReconciliation(input as never, tableNamespace as never);
  }

  async renewReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.renewReconciliation(input as never, tableNamespace as never);
  }

  async completeReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.completeReconciliation(
      input as never,
      tableNamespace as never,
    );
  }

  async failReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.failReconciliation(input as never, tableNamespace as never);
  }

  async markReconciliationManualReview(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.markReconciliationManualReview(
      input as never,
      tableNamespace as never,
    );
  }

  async getReconciliation(key: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.getReconciliation(key as never, tableNamespace as never);
  }

  async peekDueReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.peekDueReconciliation(
      input as never,
      tableNamespace as never,
    );
  }

  async listDueReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.listDueReconciliation(
      input as never,
      tableNamespace as never,
    );
  }

  async deleteExpiredReconciliation(input: unknown, tableNamespace?: unknown) {
    await this.ready();
    return this.inner.deleteExpiredReconciliation(
      input as never,
      tableNamespace as never,
    );
  }

  // ── Alarms (optional 17.4) ───────────────────────────────────────────────

  async enqueueAlarm(input: {
    id: string;
    kind: string;
    payload: unknown;
    dueAtMs: number;
  }) {
    await this.ready();
    const scheduler = this.inner.getAlarmScheduler();
    if (!scheduler) {
      throw new Error("alarms not enabled on this DO");
    }
    await scheduler.enqueue(input);
    const far = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
    const rows = scheduler.listDue(far);
    return {
      ok: true as const,
      queued: rows.length,
      sample: rows.slice(0, 3).map((r) => `${r.id}@${r.dueAt}`),
    };
  }

  /**
   * Platform alarm entry (reserved name — not callable over RPC).
   * Cloudflare may fire this immediately when setAlarm(past) is used.
   *
   * Smoke: only re-schedule — do NOT drain here. Otherwise enqueue(past due)
   * races platform alarm → deletes the row before drainAlarms() runs.
   * Real apps should drain with a lease-aware handler inside alarm().
   */
  async alarm(): Promise<void> {
    await this.ready();
    const scheduler = this.inner.getAlarmScheduler();
    if (scheduler) {
      await scheduler.reschedule();
    }
  }

  /**
   * Explicit drain for smoke/tests (RPC-safe). Platform path uses alarm().
   */
  async drainAlarms(): Promise<{
    processed: number;
    failed: number;
    dueBefore: number;
    dueSample: string[];
  }> {
    await this.ready();
    const scheduler = this.inner.getAlarmScheduler();
    if (!scheduler) {
      return { processed: 0, failed: 0, dueBefore: 0, dueSample: [] };
    }
    // Far-future upper bound so we can see any row for debugging.
    const far = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
    const all = scheduler.listDue(far);
    const dueNow = scheduler.listDue();
    const result = await this.inner.alarm(async () => {
      /* smoke: mark success so row is deleted */
    });
    return {
      processed: result.processed,
      failed: result.failed,
      dueBefore: dueNow.length,
      dueSample: all.slice(0, 5).map((i) => `${i.id}@${i.dueAt}`),
    };
  }
}

async function runSmoke(env: Env): Promise<{
  ok: boolean;
  runId: string;
  steps: SmokeStep[];
  manifest: typeof DO_STORAGE_ADAPTER_MANIFEST;
  accountHint: string;
}> {
  const steps: SmokeStep[] = [];
  const runId = uniqueRunId();
  const add = (step: SmokeStep) => {
    steps.push(step);
  };

  try {
    // ── 17.1 binding ──────────────────────────────────────────────
    if (!env.PAYMENTS_DO || typeof env.PAYMENTS_DO.idFromName !== "function") {
      add({
        name: "17.1 DO binding present",
        ok: false,
        error: "PAYMENTS_DO binding missing or not DurableObjectNamespace",
      });
      return {
        ok: false,
        runId,
        steps,
        manifest: DO_STORAGE_ADAPTER_MANIFEST,
        accountHint: "manhali.official account smoke",
      };
    }
    add({
      name: "17.1 DO binding present",
      ok: true,
      detail: `idFromName=${typeof env.PAYMENTS_DO.idFromName} get=${typeof env.PAYMENTS_DO.get}`,
    });

    // ── createDoPaymentStores (hash sharding — never global) ──────
    const namespace = env.PAYMENTS_DO as unknown as DoNamespaceLike;
    const partitions = 16;
    const stores = createDoPaymentStores({
      namespace,
      sharding: { kind: "hash", partitions },
    });
    add({
      name: "17.2 createDoPaymentStores hash sharding",
      ok:
        stores.manifest.name === "cloudflare-do" &&
        stores.sharding?.kind === "hash",
      detail: `manifest=${stores.manifest.name} partitions=${partitions}`,
    });

    // Key strategy factory also constructs
    const keyStores = createDoPaymentStores({
      namespace,
      sharding: { kind: "key" },
    });
    add({
      name: "17.2 key sharding factory",
      ok: keyStores.sharding?.kind === "key",
    });

    // ── 17.2 deterministic shard names ────────────────────────────
    const shardA = resolveDoShardName(
      { kind: "hash", partitions },
      { key: `${runId}-a` },
    );
    const shardB = resolveDoShardName(
      { kind: "hash", partitions },
      { key: `${runId}-b` },
    );
    const shardA2 = resolveDoShardName(
      { kind: "hash", partitions },
      { key: `${runId}-a` },
    );
    add({
      name: "17.2 resolveDoShardName stable",
      ok: shardA === shardA2 && shardA.startsWith("hash:"),
      detail: `a=${shardA} b=${shardB} sameA=${shardA === shardA2}`,
    });

    // ── 17.1/17.3 atomic reserve + complete (via DO SQL) ──────────
    const key1 = `${runId}-idem-1`;
    const r1 = await stores.idempotency.reserve({
      key: key1,
      fingerprint: "fp-live-1",
      owner: "smoke-worker-a",
      leaseMs: 60_000,
    });
    add({
      name: "17.3 atomic reserve acquired",
      ok: r1.kind === "acquired",
      detail: `kind=${r1.kind} gen=${"record" in r1 ? r1.record.generation : "?"}`,
    });

    if (r1.kind !== "acquired") {
      return {
        ok: steps.every((s) => s.ok),
        runId,
        steps,
        manifest: DO_STORAGE_ADAPTER_MANIFEST,
        accountHint: "manhali.official account smoke",
      };
    }

    // Duplicate → in_progress
    const r2 = await stores.idempotency.reserve({
      key: key1,
      fingerprint: "fp-live-1",
      owner: "smoke-worker-b",
      leaseMs: 60_000,
    });
    add({
      name: "17.5 duplicate delivery → in_progress",
      ok: r2.kind === "in_progress",
      detail: `kind=${r2.kind}`,
    });

    // Fingerprint conflict
    const r3 = await stores.idempotency.reserve({
      key: key1,
      fingerprint: "fp-OTHER",
      owner: "smoke-worker-c",
      leaseMs: 60_000,
    });
    add({
      name: "17.5 fingerprint_conflict",
      ok: r3.kind === "fingerprint_conflict",
      detail: `kind=${r3.kind}`,
    });

    // Complete with lease (external work would be between reserve and complete)
    await stores.idempotency.complete({
      key: key1,
      leaseToken: r1.leaseToken,
      result: { status: "ok", source: "do-smoke", runId },
    });
    const after = await stores.idempotency.get(key1);
    add({
      name: "17.3 complete + get",
      ok: after?.status === "completed",
      detail: `status=${after?.status}`,
    });

    // Stale token after complete
    let staleOk = false;
    try {
      await stores.idempotency.complete({
        key: key1,
        leaseToken: r1.leaseToken,
        result: {},
      });
    } catch {
      staleOk = true;
    }
    add({
      name: "17.5 stale complete rejected",
      ok: staleOk,
    });

    // ── Webhook claim ─────────────────────────────────────────────
    const evtKey = `${runId}-evt-1`;
    const wh = await stores.webhookInbox.claim({
      key: evtKey,
      payloadHash: "hash-live-1",
      owner: "smoke-worker-a",
      leaseMs: 60_000,
    });
    add({
      name: "webhook claim acquired",
      ok: wh.kind === "acquired",
      detail: `kind=${wh.kind}`,
    });
    if (wh.kind === "acquired") {
      await stores.webhookInbox.complete({
        key: evtKey,
        leaseToken: wh.leaseToken,
      });
      add({ name: "webhook complete", ok: true });
    }

    // ── Reconciliation schedule/claim ─────────────────────────────
    const reconKey = `${runId}-recon-1`;
    const nowIso = new Date().toISOString();
    const sched = await stores.reconciliation.schedule({
      key: reconKey,
      subjectId: `pay_${runId}`,
      reason: "smoke",
      dueAt: nowIso,
    });
    add({
      name: "recon schedule",
      ok: sched.kind === "scheduled" || sched.kind === "already_exists",
      detail: `kind=${sched.kind}`,
    });
    const rc = await stores.reconciliation.claim({
      key: reconKey,
      owner: "smoke-worker-a",
      leaseMs: 60_000,
    });
    add({
      name: "recon claim",
      ok: rc.kind === "acquired",
      detail: `kind=${rc.kind}`,
    });
    if (rc.kind === "acquired") {
      await stores.reconciliation.complete({
        key: reconKey,
        leaseToken: rc.leaseToken,
      });
      add({ name: "recon complete", ok: true });
    }

    // ── 17.5 parallel same-key (Promise.all) ──────────────────────
    const parallelKey = `${runId}-par`;
    const parallel = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        stores.idempotency.reserve({
          key: parallelKey,
          fingerprint: "fp-par",
          owner: `p${i}`,
          leaseMs: 60_000,
        }),
      ),
    );
    const acquired = parallel.filter((r) => r.kind === "acquired");
    const inProgress = parallel.filter((r) => r.kind === "in_progress");
    add({
      name: "17.5 parallel reserve single winner",
      ok: acquired.length === 1 && inProgress.length === 5,
      detail: `acquired=${acquired.length} in_progress=${inProgress.length}`,
    });
    if (acquired[0]?.kind === "acquired") {
      await stores.idempotency.complete({
        key: parallelKey,
        leaseToken: acquired[0].leaseToken,
        result: { parallel: true },
      });
    }

    // ── 17.5 different partitions isolation ───────────────────────
    // Pick two keys that hash to different partitions when possible.
    let partKey1 = `${runId}-part-x`;
    let partKey2 = `${runId}-part-y`;
    let foundDifferent = false;
    for (let i = 0; i < 64; i++) {
      const k1 = `${runId}-p${i}a`;
      const k2 = `${runId}-p${i}b`;
      const s1 = resolveDoShardName({ kind: "hash", partitions }, { key: k1 });
      const s2 = resolveDoShardName({ kind: "hash", partitions }, { key: k2 });
      if (s1 !== s2) {
        partKey1 = k1;
        partKey2 = k2;
        foundDifferent = true;
        break;
      }
    }
    const pr1 = await stores.idempotency.reserve({
      key: partKey1,
      fingerprint: "fp-p1",
      owner: "part-a",
      leaseMs: 60_000,
    });
    const pr2 = await stores.idempotency.reserve({
      key: partKey2,
      fingerprint: "fp-p2",
      owner: "part-b",
      leaseMs: 60_000,
    });
    add({
      name: "17.5 different partitions both acquire",
      ok: pr1.kind === "acquired" && pr2.kind === "acquired" && foundDifferent,
      detail: `foundDifferent=${foundDifferent} k1=${pr1.kind} k2=${pr2.kind}`,
    });
    if (pr1.kind === "acquired") {
      await stores.idempotency.complete({
        key: partKey1,
        leaseToken: pr1.leaseToken,
        result: { p: 1 },
      });
    }
    if (pr2.kind === "acquired") {
      await stores.idempotency.complete({
        key: partKey2,
        leaseToken: pr2.leaseToken,
        result: { p: 2 },
      });
    }

    // ── 17.5 short-lease reclaim (wall clock; FakeClock is not DO-side) ─
    const leaseKey = `${runId}-lease`;
    const short = await stores.idempotency.reserve({
      key: leaseKey,
      fingerprint: "fp-lease",
      owner: "owner-old",
      leaseMs: 2_000,
    });
    if (short.kind === "acquired") {
      await new Promise((r) => setTimeout(r, 2_500));
      const reclaim = await stores.idempotency.reserve({
        key: leaseKey,
        fingerprint: "fp-lease",
        owner: "owner-new",
        leaseMs: 30_000,
      });
      add({
        name: "17.5 short-lease reclaim after expiry",
        ok:
          reclaim.kind === "acquired" &&
          reclaim.record.generation === short.record.generation + 1,
        detail: `kind=${reclaim.kind} gen=${"record" in reclaim ? reclaim.record.generation : "?"}`,
      });
      if (reclaim.kind === "acquired") {
        // Stale old token must fail
        let lost = false;
        try {
          await stores.idempotency.complete({
            key: leaseKey,
            leaseToken: short.leaseToken,
            result: {},
          });
        } catch {
          lost = true;
        }
        add({
          name: "17.5 stale lease after reclaim rejected",
          ok: lost,
        });
        await stores.idempotency.complete({
          key: leaseKey,
          leaseToken: reclaim.leaseToken,
          result: { reclaimed: true },
        });
      }
    } else {
      add({
        name: "17.5 short-lease reclaim after expiry",
        ok: false,
        detail: `initial reserve kind=${short.kind}`,
      });
    }

    // ── 17.4 optional alarms (enqueue + platform alarm handler) ───
    // Route to a known shard via key strategy for direct stub access.
    const alarmKey = `${runId}-alarm`;
    const alarmStores = createDoPaymentStores({
      namespace,
      sharding: { kind: "key" },
    });
    // Touch the object first so schema/init runs via a store op, then enqueue.
    const alarmTouch = await alarmStores.idempotency.reserve({
      key: alarmKey,
      fingerprint: "fp-alarm",
      owner: "alarm-owner",
      leaseMs: 30_000,
    });
    add({
      name: "17.4 alarm partition warm",
      ok: alarmTouch.kind === "acquired",
      detail: `kind=${alarmTouch.kind}`,
    });

    if (alarmTouch.kind === "acquired") {
      await alarmStores.idempotency.complete({
        key: alarmKey,
        leaseToken: alarmTouch.leaseToken,
        result: { warm: true },
      });

      // Same stub routing as createDoPaymentStores (getDoStub), never platform `alarm` RPC.
      const shardName = resolveDoShardName({ kind: "key" }, { key: alarmKey });
      const stub = getDoStub(namespace, shardName) as {
        enqueueAlarm: (input: {
          id: string;
          kind: string;
          payload: unknown;
          dueAtMs: number;
        }) => Promise<{ ok: true }>;
        drainAlarms: () => Promise<{
          processed: number;
          failed: number;
          dueBefore: number;
          dueSample: string[];
        }>;
      };
      try {
        // due well in the past to avoid Worker/DO wall-clock skew on due_at compare
        const enq = await stub.enqueueAlarm({
          id: `${runId}-job-1`,
          kind: "smoke_retry",
          payload: { runId },
          dueAtMs: Date.now() - 60_000,
        });
        add({
          name: "17.4 enqueueAlarm",
          ok: enq.ok === true && (enq.queued ?? 0) >= 1,
          detail: `queued=${enq.queued} sample=${JSON.stringify(enq.sample ?? [])}`,
        });
        const drained = await stub.drainAlarms();
        add({
          name: "17.4 alarm drain",
          ok: drained.processed >= 1 && drained.failed === 0,
          detail: `processed=${drained.processed} failed=${drained.failed} dueBefore=${drained.dueBefore} sample=${JSON.stringify(drained.dueSample)}`,
        });
      } catch (err) {
        add({
          name: "17.4 alarm RPC",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Manifest honesty ──────────────────────────────────────────
    add({
      name: "manifest multi-host durable strong",
      ok:
        DO_STORAGE_ADAPTER_MANIFEST.coordinationScope === "multi-host" &&
        DO_STORAGE_ADAPTER_MANIFEST.durability === "durable" &&
        DO_STORAGE_ADAPTER_MANIFEST.consistency.claims === "strong" &&
        DO_STORAGE_ADAPTER_MANIFEST.consistency.readAfterWrite === "strong",
      detail: `scope=${DO_STORAGE_ADAPTER_MANIFEST.coordinationScope}`,
    });

    add({
      name: "no global DO default in notes",
      ok: DO_STORAGE_ADAPTER_MANIFEST.notes.some((n) =>
        /never route all|global Durable Object/i.test(n),
      ),
    });
  } catch (err) {
    add({
      name: "unhandled",
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }

  return {
    ok: steps.every((s) => s.ok),
    runId,
    steps,
    manifest: DO_STORAGE_ADAPTER_MANIFEST,
    accountHint: "manhali.official account smoke",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        binding: typeof env.PAYMENTS_DO?.idFromName === "function",
        package: "@paykernel/store-durable-objects",
        accountHint: "manhali.official account smoke",
        sqliteClasses: ["PaymentsStoreDurableObject"],
        smokeBuild: "2026-08-04-alarm-debug-v3",
      });
    }

    if (
      url.pathname === "/smoke" &&
      (request.method === "POST" || request.method === "GET")
    ) {
      const result = await runSmoke(env);
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }

    return Response.json(
      {
        ok: true,
        endpoints: ["GET /health", "GET|POST /smoke"],
      },
      { status: 200 },
    );
  },
};
