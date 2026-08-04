/**
 * Live Cloudflare D1 smoke Worker for payments-adapter-cloudflare-d1.
 *
 * Endpoints:
 *   GET  /health  — binding present
 *   POST /smoke   — migrate + claims + concurrency + batch + sessions + restart-like reclaim
 *
 * Uses createD1PaymentStores({ db: env.PAYMENTS_DB }) — Workers binding only.
 */

import {
  createD1PaymentStores,
  createD1Executor,
  migrateD1Adapter,
  verifyD1AdapterSchema,
  supportsD1Sessions,
  D1_SESSION_FIRST_PRIMARY,
  D1_STORAGE_ADAPTER_MANIFEST,
  createSystemClock,
} from "../src/index";
import { createFakeClock } from "@paykernel/testkit";

export interface Env {
  PAYMENTS_DB: D1Database;
}

type SmokeStep = {
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
};

function uniquePrefix(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `sm${Date.now().toString(36)}${rand}_`;
}

async function runSmoke(env: Env): Promise<{
  ok: boolean;
  prefix: string;
  steps: SmokeStep[];
  manifest: typeof D1_STORAGE_ADAPTER_MANIFEST;
}> {
  const steps: SmokeStep[] = [];
  const prefix = uniquePrefix();
  const add = (step: SmokeStep) => {
    steps.push(step);
  };

  try {
    // ── 16.1 binding ──────────────────────────────────────────────
    if (!env.PAYMENTS_DB || typeof env.PAYMENTS_DB.prepare !== "function") {
      add({
        name: "16.1 binding present",
        ok: false,
        error: "PAYMENTS_DB binding missing or not D1Database",
      });
      return { ok: false, prefix, steps, manifest: D1_STORAGE_ADAPTER_MANIFEST };
    }
    add({
      name: "16.1 binding present",
      ok: true,
      detail: `prepare=${typeof env.PAYMENTS_DB.prepare} batch=${typeof env.PAYMENTS_DB.batch}`,
    });

    // ── createD1PaymentStores (no migrate) ────────────────────────
    const stores = createD1PaymentStores({
      db: env.PAYMENTS_DB,
      namespace: { tablePrefix: prefix },
    });
    add({
      name: "16.1 createD1PaymentStores",
      ok: true,
      detail: `manifest=${stores.manifest.name} scope=${stores.manifest.coordinationScope}`,
    });

    // ── 16.3 migrate ──────────────────────────────────────────────
    const migrateResult = await migrateD1Adapter(env.PAYMENTS_DB, {
      namespace: { tablePrefix: prefix },
    });
    add({
      name: "16.3 migrateD1Adapter",
      ok: true,
      detail: JSON.stringify(migrateResult).slice(0, 200),
    });

    const verify = await verifyD1AdapterSchema(env.PAYMENTS_DB, {
      namespace: { tablePrefix: prefix },
    });
    add({
      name: "16.3 verifyD1AdapterSchema",
      ok: verify.ok === true,
      detail: JSON.stringify(verify).slice(0, 240),
    });

    // ── 16.2 prepared single-statement claim ──────────────────────
    const clock = createFakeClock({ initialMs: Date.now() });
    const storesClock = createD1PaymentStores({
      db: env.PAYMENTS_DB,
      clock,
      namespace: { tablePrefix: prefix },
    });

    const r1 = await storesClock.idempotency.reserve({
      key: "live-key-1",
      fingerprint: "fp-live-1",
      owner: "smoke-worker-a",
      leaseMs: 60_000,
    });
    add({
      name: "16.2 atomic reserve acquired",
      ok: r1.kind === "acquired",
      detail: `kind=${r1.kind} gen=${"record" in r1 ? r1.record.generation : "?"}`,
    });

    if (r1.kind !== "acquired") {
      return {
        ok: steps.every((s) => s.ok),
        prefix,
        steps,
        manifest: D1_STORAGE_ADAPTER_MANIFEST,
      };
    }

    // Duplicate concurrent-style: second reserve same key → in_progress
    const r2 = await storesClock.idempotency.reserve({
      key: "live-key-1",
      fingerprint: "fp-live-1",
      owner: "smoke-worker-b",
      leaseMs: 60_000,
    });
    add({
      name: "16.6 duplicate delivery → in_progress",
      ok: r2.kind === "in_progress",
      detail: `kind=${r2.kind}`,
    });

    // Fingerprint conflict
    const r3 = await storesClock.idempotency.reserve({
      key: "live-key-1",
      fingerprint: "fp-OTHER",
      owner: "smoke-worker-c",
      leaseMs: 60_000,
    });
    add({
      name: "16.6 fingerprint_conflict",
      ok: r3.kind === "fingerprint_conflict",
      detail: `kind=${r3.kind}`,
    });

    // Complete with lease
    await storesClock.idempotency.complete({
      key: "live-key-1",
      leaseToken: r1.leaseToken,
      result: { status: "ok", source: "d1-smoke" },
    });
    const after = await storesClock.idempotency.get("live-key-1");
    add({
      name: "16.2 complete + get",
      ok: after?.status === "completed",
      detail: `status=${after?.status}`,
    });

    // Stale token after complete
    let staleOk = false;
    try {
      await storesClock.idempotency.complete({
        key: "live-key-1",
        leaseToken: r1.leaseToken,
        result: {},
      });
    } catch {
      staleOk = true;
    }
    add({
      name: "16.6 stale complete rejected",
      ok: staleOk,
    });

    // ── Webhook claim ─────────────────────────────────────────────
    const wh = await storesClock.webhookInbox.claim({
      key: "evt-live-1",
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
      await storesClock.webhookInbox.complete({
        key: "evt-live-1",
        leaseToken: wh.leaseToken,
      });
      add({ name: "webhook complete", ok: true });
    }

    // ── Reconciliation schedule/claim ─────────────────────────────
    const nowIso = new Date(clock.nowMs()).toISOString();
    const sched = await storesClock.reconciliation.schedule({
      key: "recon-live-1",
      subjectId: "pay_live_1",
      reason: "smoke",
      dueAt: nowIso,
    });
    add({
      name: "recon schedule",
      ok: sched.kind === "scheduled" || sched.kind === "already_exists",
      detail: `kind=${sched.kind}`,
    });
    const rc = await storesClock.reconciliation.claim({
      key: "recon-live-1",
      owner: "smoke-worker-a",
      leaseMs: 60_000,
    });
    add({
      name: "recon claim",
      ok: rc.kind === "acquired",
      detail: `kind=${rc.kind}`,
    });
    if (rc.kind === "acquired") {
      await storesClock.reconciliation.complete({
        key: "recon-live-1",
        leaseToken: rc.leaseToken,
      });
      add({ name: "recon complete", ok: true });
    }

    // ── 16.2 batch atomicity ──────────────────────────────────────
    const executor = createD1Executor(env.PAYMENTS_DB);
    const table = `${prefix}payment_idempotency`;
    const t0 = nowIso;
    try {
      await executor.batch!([
        {
          sql: `INSERT INTO ${table} (key, status, fingerprint, attempts, generation, created_at, updated_at)
                VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: ["batch-ok-1", "fp", t0, t0],
        },
        {
          sql: `INSERT INTO ${table} (key, status, fingerprint, attempts, generation, created_at, updated_at)
                VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: ["batch-ok-2", "fp", t0, t0],
        },
      ]);
      const rows = await executor.query<{ key: string }>(
        `SELECT key FROM ${table} WHERE key LIKE 'batch-ok-%' ORDER BY key`,
      );
      add({
        name: "16.2 batch commit",
        ok: rows.length === 2,
        detail: `keys=${rows.map((r) => r.key).join(",")}`,
      });
    } catch (err) {
      add({
        name: "16.2 batch commit",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // batch rollback
    try {
      await executor.batch!([
        {
          sql: `INSERT INTO ${table} (key, status, fingerprint, attempts, generation, created_at, updated_at)
                VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: ["batch-roll-new", "fp", t0, t0],
        },
        {
          // duplicate primary key — should abort entire batch
          sql: `INSERT INTO ${table} (key, status, fingerprint, attempts, generation, created_at, updated_at)
                VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: ["batch-ok-1", "fp", t0, t0],
        },
      ]);
      add({
        name: "16.2 batch rollback",
        ok: false,
        error: "expected batch to reject on PK conflict",
      });
    } catch {
      const rows = await executor.query<{ key: string }>(
        `SELECT key FROM ${table} WHERE key = 'batch-roll-new'`,
      );
      add({
        name: "16.2 batch rollback",
        ok: rows.length === 0,
        detail: rows.length === 0 ? "mid-batch insert rolled back" : "row leaked",
      });
    }

    // ── 16.5 sessions ─────────────────────────────────────────────
    const sessionSupported = supportsD1Sessions(
      env.PAYMENTS_DB as unknown as {
        prepare: typeof env.PAYMENTS_DB.prepare;
        batch: typeof env.PAYMENTS_DB.batch;
        withSession?: (c?: string) => unknown;
      },
    );
    add({
      name: "16.5 supportsD1Sessions",
      ok: true,
      detail: `supported=${sessionSupported}`,
    });

    if (sessionSupported) {
      const sessionStores = createD1PaymentStores({
        db: env.PAYMENTS_DB,
        clock,
        namespace: { tablePrefix: prefix },
        session: D1_SESSION_FIRST_PRIMARY,
      });
      const sr = await sessionStores.idempotency.reserve({
        key: "session-key-1",
        fingerprint: "fp-session",
        owner: "session-worker",
        leaseMs: 30_000,
      });
      const got = await sessionStores.idempotency.get("session-key-1");
      add({
        name: "16.5 session first-primary reserve+get",
        ok: sr.kind === "acquired" && got?.status === "reserved",
        detail: `reserve=${sr.kind} get=${got?.status}`,
      });
      if (sr.kind === "acquired") {
        await sessionStores.idempotency.complete({
          key: "session-key-1",
          leaseToken: sr.leaseToken,
          result: { ok: true },
        });
      }
    } else {
      add({
        name: "16.5 session first-primary reserve+get",
        ok: true,
        detail: "withSession not on this binding; skipped (still ok for local/miniflare)",
      });
    }

    // ── 16.6 lease reclaim after FakeClock advance ────────────────
    const rLease = await storesClock.idempotency.reserve({
      key: "lease-reclaim-1",
      fingerprint: "fp-lease",
      owner: "owner-old",
      leaseMs: 5_000,
    });
    if (rLease.kind === "acquired") {
      clock.advance(6_000);
      const reclaim = await storesClock.idempotency.reserve({
        key: "lease-reclaim-1",
        fingerprint: "fp-lease",
        owner: "owner-new",
        leaseMs: 30_000,
      });
      add({
        name: "16.6 FakeClock lease reclaim",
        ok:
          reclaim.kind === "acquired" &&
          reclaim.record.generation === (rLease.record.generation + 1),
        detail: `kind=${reclaim.kind} gen=${"record" in reclaim ? reclaim.record.generation : "?"}`,
      });
      if (reclaim.kind === "acquired") {
        await storesClock.idempotency.complete({
          key: "lease-reclaim-1",
          leaseToken: reclaim.leaseToken,
          result: { reclaimed: true },
        });
      }
    } else {
      add({
        name: "16.6 FakeClock lease reclaim",
        ok: false,
        detail: `initial reserve kind=${rLease.kind}`,
      });
    }

    // ── Parallel claims (Promise.all) ─────────────────────────────
    const parallelKey = "parallel-live-1";
    const parallel = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        storesClock.idempotency.reserve({
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
      name: "16.6 parallel reserve single winner",
      ok: acquired.length === 1 && inProgress.length === 5,
      detail: `acquired=${acquired.length} in_progress=${inProgress.length}`,
    });
    if (acquired[0]?.kind === "acquired") {
      await storesClock.idempotency.complete({
        key: parallelKey,
        leaseToken: acquired[0].leaseToken,
        result: { parallel: true },
      });
    }

    // ── Manifest honesty ──────────────────────────────────────────
    add({
      name: "manifest multi-host durable",
      ok:
        D1_STORAGE_ADAPTER_MANIFEST.coordinationScope === "multi-host" &&
        D1_STORAGE_ADAPTER_MANIFEST.durability === "durable" &&
        D1_STORAGE_ADAPTER_MANIFEST.consistency.claims === "strong",
      detail: `scope=${D1_STORAGE_ADAPTER_MANIFEST.coordinationScope}`,
    });

    // wall clock factory still works
    const wall = createD1PaymentStores({
      db: env.PAYMENTS_DB,
      clock: createSystemClock(),
      namespace: { tablePrefix: prefix },
    });
    add({
      name: "system clock factory",
      ok: typeof wall.idempotency.reserve === "function",
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
    prefix,
    steps,
    manifest: D1_STORAGE_ADAPTER_MANIFEST,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        binding: typeof env.PAYMENTS_DB?.prepare === "function",
        package: "@paykernel/store-d1",
        accountHint: "manhali project account smoke",
      });
    }

    if (url.pathname === "/smoke" && (request.method === "POST" || request.method === "GET")) {
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
