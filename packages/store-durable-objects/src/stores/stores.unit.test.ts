/**
 * Unit tests with a fake executor (no live DO).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
} from "@paykernel/testkit";
import {
  StoreLeaseLostError,
  StoreUnsupportedFeatureError,
} from "@paykernel/store-contracts";
import {
  createDoIdempotencyStore,
  createDoWebhookInboxStore,
  createDoReconciliationStore,
  createDoStores,
  createDoPaymentStoresFromStorage,
} from "../index";
import type { DoExecutor } from "../sql-executor";
import { createMockDoSql } from "../test-utils/mock-do-sql";
import { createDoExecutor, migrateDoAdapter } from "../index";
import { uniqueTablePrefix } from "../test-utils/do-env";
import { DEFAULT_DELETE_EXPIRED_LIMIT } from "./shared";

type Row = Record<string, unknown>;

function createScriptedExecutor(handlers: {
  onQuery?: (sql: string, params: readonly unknown[]) => Row[];
  onRun?: (
    sql: string,
    params: readonly unknown[],
  ) => { changes: number };
  /** When true, omit transaction (and runInTransaction) for SHARED-1 fail-closed tests. */
  omitTransaction?: boolean;
}): DoExecutor & {
  calls: Array<{ sql: string; params: readonly unknown[] }>;
  transactionEntered: number;
} {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const base: DoExecutor & {
    calls: Array<{ sql: string; params: readonly unknown[] }>;
    transactionEntered: number;
  } = {
    calls,
    transactionEntered: 0,
    query<T = Row>(sql: string, params: readonly unknown[] = []): T[] {
      calls.push({ sql, params });
      const rows = handlers.onQuery?.(sql, params) ?? [];
      return rows as T[];
    },
    run(sql: string, params: readonly unknown[] = []): { changes: number } {
      calls.push({ sql, params });
      return handlers.onRun?.(sql, params) ?? { changes: 0 };
    },
    transaction<T>(fn: () => T): T {
      base.transactionEntered += 1;
      return fn();
    },
  };
  if (handlers.omitTransaction) {
    delete (base as { transaction?: unknown }).transaction;
  }
  return base;
}

describe("idempotency store unit (fake executor)", () => {
  it("complete with 0 rows throws StoreLeaseLostError", async () => {
    const executor = createScriptedExecutor({
      onQuery: () => [],
    });
    const store = createDoIdempotencyStore({ executor });
    await expect(
      store.complete({ key: "k", leaseToken: "tok", result: {} }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("renew returns lease_lost when update empty and row reserved", async () => {
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("UPDATE")) return [];
        if (sql.includes("SELECT")) {
          return [
            {
              key: "k",
              status: "reserved",
              fingerprint: "fp",
              lease_owner: "w",
              lease_token: "other",
              lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
              attempts: 1,
              generation: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              result_json: null,
            },
          ];
        }
        return [];
      },
    });
    const store = createDoIdempotencyStore({ executor });
    const r = await store.renew({ key: "k", leaseToken: "stale", leaseMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lease_lost");
  });

  it("reserve returns acquired when RETURNING row present", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const leaseTok = "lt_abc";
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) {
          return [
            {
              key: "k1",
              status: "reserved",
              fingerprint: "fp",
              lease_owner: "w1",
              lease_token: leaseTok,
              lease_expires_at: new Date(clock.nowMs() + 5000).toISOString(),
              attempts: 1,
              generation: 1,
              created_at: new Date(clock.nowMs()).toISOString(),
              updated_at: new Date(clock.nowMs()).toISOString(),
              result_json: null,
            },
          ];
        }
        return [];
      },
    });
    const store = createDoIdempotencyStore({ executor, clock });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 5000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind === "acquired") {
      expect(r.leaseToken).toBe(leaseTok);
    }
  });

  it("P11-IDEM-1: completed + different fingerprint is already_completed (not fingerprint_conflict)", async () => {
    const now = new Date().toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) return [];
        return [
          {
            key: "k",
            status: "completed",
            fingerprint: "fp-old",
            lease_owner: null,
            lease_token: null,
            lease_expires_at: null,
            attempts: 1,
            generation: 1,
            created_at: now,
            updated_at: now,
            result_json: null,
          },
        ];
      },
    });
    const store = createDoIdempotencyStore({ executor });
    const r = await store.reserve({
      key: "k",
      fingerprint: "fp-new",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("already_completed");
  });

  it("P11-IDEM-1: indeterminate + different fingerprint is indeterminate (not fingerprint_conflict)", async () => {
    const now = new Date().toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) return [];
        return [
          {
            key: "k",
            status: "indeterminate",
            fingerprint: "fp-old",
            lease_owner: null,
            lease_token: null,
            lease_expires_at: null,
            attempts: 1,
            generation: 1,
            created_at: now,
            updated_at: now,
            result_json: null,
          },
        ];
      },
    });
    const store = createDoIdempotencyStore({ executor });
    const r = await store.reserve({
      key: "k",
      fingerprint: "fp-new",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("indeterminate");
  });

  it("P11-IDEM-2: offset-form expired lease_expires_at repairs and acquires", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const leaseOffset = "2026-01-15T14:00:00+05:00";
    const leaseZ = "2026-01-15T09:00:00.000Z";
    const now = new Date(clock.nowMs()).toISOString();
    let reserveAttempts = 0;
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT") || sql.includes("ON CONFLICT")) {
          reserveAttempts += 1;
          if (reserveAttempts === 1) return [];
          return [
            {
              key: "k-lex",
              status: "reserved",
              fingerprint: "fp",
              lease_owner: "w",
              lease_token: "lt_repaired",
              lease_expires_at: new Date(clock.nowMs() + 1000).toISOString(),
              attempts: 2,
              generation: 2,
              created_at: leaseZ,
              updated_at: now,
              result_json: null,
            },
          ];
        }
        if (sql.includes("SELECT") && sql.includes("WHERE key")) {
          return [
            {
              key: "k-lex",
              status: "reserved",
              fingerprint: "fp",
              lease_owner: "stale",
              lease_token: "lt_old",
              lease_expires_at: leaseOffset,
              attempts: 1,
              generation: 1,
              created_at: leaseZ,
              updated_at: leaseZ,
              result_json: null,
            },
          ];
        }
        return [];
      },
      onRun: () => ({ changes: 1 }),
    });
    const store = createDoIdempotencyStore({ executor, clock });
    const r = await store.reserve({
      key: "k-lex",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("acquired");
    expect(reserveAttempts).toBe(2);
    const repair = executor.calls.find(
      (c) =>
        c.sql.includes("UPDATE") &&
        c.sql.includes("lease_expires_at") &&
        !c.sql.includes("ON CONFLICT") &&
        !c.sql.includes("INSERT"),
    );
    expect(repair).toBeDefined();
    expect(repair!.params).toEqual([leaseZ, "k-lex", now, leaseOffset]);
  });

  it("P11-DEL-1: deleteExpired binds canonical Z before", async () => {
    const executor = createScriptedExecutor({ onQuery: () => [] });
    const store = createDoIdempotencyStore({ executor });
    await store.deleteExpired({ before: "2026-01-15T17:00:00+05:00" });
    const del = executor.calls.find((c) => c.sql.includes("DELETE"));
    expect(del).toBeDefined();
    expect(del!.params[0]).toBe("2026-01-15T12:00:00.000Z");
  });

  it("P11-DEL-1: webhook/recon deleteExpired binds canonical Z before", async () => {
    const before = "2026-01-15T17:00:00+05:00";
    const z = "2026-01-15T12:00:00.000Z";
    const webhookExec = createScriptedExecutor({ onQuery: () => [] });
    await createDoWebhookInboxStore({ executor: webhookExec }).deleteExpired({
      before,
    });
    expect(webhookExec.calls.find((c) => c.sql.includes("DELETE"))?.params[0]).toBe(z);
    const reconExec = createScriptedExecutor({ onQuery: () => [] });
    await createDoReconciliationStore({ executor: reconExec }).deleteExpired({
      before,
    });
    expect(reconExec.calls.find((c) => c.sql.includes("DELETE"))?.params[0]).toBe(z);
  });

  it("NEW-PERF-8: omit limit binds finite LIMIT (not unbounded DELETE)", async () => {
    expect(DEFAULT_DELETE_EXPIRED_LIMIT).toBe(1000);
    expect(Number.isFinite(DEFAULT_DELETE_EXPIRED_LIMIT)).toBe(true);
    const webhookExec = createScriptedExecutor({ onQuery: () => [] });
    await createDoWebhookInboxStore({ executor: webhookExec }).deleteExpired({
      before: "2099-01-01T00:00:00.000Z",
    });
    const webhookDel = webhookExec.calls.find((c) => c.sql.includes("DELETE"));
    expect(webhookDel).toBeDefined();
    expect(webhookDel!.sql).toMatch(/LIMIT\s+\?/i);
    expect(webhookDel!.params[1]).toBe(DEFAULT_DELETE_EXPIRED_LIMIT);

    const reconExec = createScriptedExecutor({ onQuery: () => [] });
    await createDoReconciliationStore({ executor: reconExec }).deleteExpired({
      before: "2099-01-01T00:00:00.000Z",
    });
    const reconDel = reconExec.calls.find((c) => c.sql.includes("DELETE"));
    expect(reconDel).toBeDefined();
    expect(reconDel!.sql).toMatch(/LIMIT\s+\?/i);
    expect(reconDel!.params[1]).toBe(DEFAULT_DELETE_EXPIRED_LIMIT);

    const explicit = createScriptedExecutor({ onQuery: () => [] });
    await createDoReconciliationStore({ executor: explicit }).deleteExpired({
      before: "2099-01-01T00:00:00.000Z",
      limit: 5,
    });
    expect(explicit.calls.find((c) => c.sql.includes("DELETE"))?.params[1]).toBe(5);
  });
});

describe("createDoStores / from storage smoke", () => {
  it("createDoStores shares clock and manifest", () => {
    const executor = createScriptedExecutor({});
    const clock = createFakeClock();
    const bundle = createDoStores({ executor, clock });
    expect(bundle.clock).toBe(clock);
    expect(bundle.manifest.name).toBe("cloudflare-do");
    expect(bundle.idempotency).toBeDefined();
    expect(bundle.webhookInbox).toBeDefined();
    expect(bundle.reconciliation).toBeDefined();
  });

  it("mock storage end-to-end reserve/complete", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("u");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const bundle = createDoPaymentStoresFromStorage({
        storage: handle.storage,
        tableNamespace: { tablePrefix: prefix },
      });
      const r = await bundle.idempotency.reserve({
        key: "e2e",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;
      await bundle.idempotency.complete({
        key: "e2e",
        leaseToken: r.leaseToken,
        result: { ok: true },
      });
      const got = await bundle.idempotency.get("e2e");
      expect(got?.status).toBe("completed");

      // webhook + recon smoke
      const wh = await bundle.webhookInbox.claim({
        key: "wh1",
        payloadHash: "h",
        owner: "w",
        leaseMs: 5000,
      });
      expect(wh.kind).toBe("acquired");

      const sch = await bundle.reconciliation.schedule({
        key: "rj1",
        subjectId: "sub",
        reason: "check",
        dueAt: new Date().toISOString(),
      });
      expect(sch.kind).toBe("scheduled");
    } finally {
      handle.close();
    }
  });

  it("webhook fail and recon claim paths", async () => {
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("UPDATE") && sql.includes("RETURNING key")) {
          return [{ key: "k", status: "pending", generation: 1 }];
        }
        return [];
      },
    });
    const wh = createDoWebhookInboxStore({ executor });
    // fail with empty returning → lease lost
    const empty = createScriptedExecutor({ onQuery: () => [] });
    const wh2 = createDoWebhookInboxStore({ executor: empty });
    await expect(
      wh2.fail({ key: "k", leaseToken: "t", error: "x" }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);

    const recon = createDoReconciliationStore({
      executor: createScriptedExecutor({
        onQuery: (sql) => {
          if (sql.includes("INSERT")) return [];
          if (sql.includes("SELECT")) {
            return [
              {
                key: "r1",
                status: "scheduled",
                subject_id: "s",
                reason: "x",
                due_at: new Date().toISOString(),
                attempts: 0,
                generation: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ];
          }
          return [];
        },
      }),
    });
    const s = await recon.schedule({
      key: "r1",
      subjectId: "s",
      reason: "x",
      dueAt: new Date().toISOString(),
    });
    expect(s.kind).toBe("already_exists");
    // silence unused
    expect(wh).toBeDefined();
  });
});

describe("webhook store unit (B5/B4)", () => {
  it("listRetryable soft-releases expired claimed rows then selects pending", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onRun: () => ({ changes: 1 }),
      onQuery: (sql) => {
        if (sql.includes("SELECT") && sql.includes("pending")) {
          return [
            {
              key: "abandoned",
              status: "pending",
              payload_hash: "h1",
              payload_ref: null,
              gateway: null,
              provider_event_id: null,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 1,
              generation: 1,
              available_at: now,
              first_received_at: now,
              last_received_at: now,
              completed_at: null,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: now,
              updated_at: now,
            },
          ];
        }
        return [];
      },
    });
    const store = createDoWebhookInboxStore({ executor, clock });
    const listed = await store.listRetryable({ now });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe("abandoned");
    const soft = executor.calls.find(
      (c) => c.sql.includes("status = 'claimed'") && c.sql.includes("lease_expires_at"),
    );
    expect(soft).toBeDefined();
    expect(soft?.sql).toMatch(/LIMIT\s+\?/i);
    expect(soft?.params.at(-1)).toBe(100);
    expect(soft?.sql).toMatch(/WHERE\s+status\s*=\s*'claimed'\s+AND\s+key\s+IN/i);
  });

  it("claim SQL gates pending on available_at", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const future = new Date(clock.nowMs() + 60_000).toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT") || sql.includes("ON CONFLICT") || sql.includes("on conflict")) {
          return [];
        }
        if (sql.includes("SELECT")) {
          return [
            {
              key: "backoff",
              status: "pending",
              payload_hash: "h1",
              payload_ref: null,
              gateway: null,
              provider_event_id: null,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 1,
              generation: 1,
              available_at: future,
              first_received_at: now,
              last_received_at: now,
              completed_at: null,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: now,
              updated_at: now,
            },
          ];
        }
        return [];
      },
    });
    const store = createDoWebhookInboxStore({ executor, clock });
    const r = await store.claim({
      key: "backoff",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("not_available");
    if (r.kind === "not_available") {
      expect(r.availableAt).toBe(future);
      expect(r.record.status).toBe("pending");
    }
    const claimCall = executor.calls.find(
      (c) => c.sql.includes("ON CONFLICT") || c.sql.includes("on conflict") || c.sql.includes("INSERT"),
    );
    expect(claimCall?.sql).toContain("available_at");
  });
});


describe("reconciliation store unit (listDue recovery + markManualReview fence)", () => {
  it("listDue soft-releases expired claimed rows then selects scheduled", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onRun: () => ({ changes: 1 }),
      onQuery: (sql) => {
        if (sql.includes("SELECT") && sql.includes("scheduled")) {
          return [
            {
              key: "abandoned-job",
              status: "scheduled",
              subject_id: "pay_1",
              reason: "timeout",
              due_at: now,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 1,
              generation: 1,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: now,
              updated_at: now,
              completed_at: null,
            },
          ];
        }
        return [];
      },
    });
    const store = createDoReconciliationStore({ executor, clock });
    const listed = await store.listDue({ now });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe("abandoned-job");
    const soft = executor.calls.find(
      (c) =>
        c.sql.includes("status = 'claimed'") &&
        c.sql.includes("lease_expires_at") &&
        c.sql.toLowerCase().includes("status = 'scheduled'"),
    );
    expect(soft).toBeDefined();
    expect(soft?.sql).toMatch(/LIMIT\s+\?/i);
    expect(soft?.params.at(-1)).toBe(100);
    expect(soft?.sql).toMatch(/WHERE\s+status\s*=\s*'claimed'\s+AND\s+key\s+IN/i);
  });

  it("RECON-LEASE-1: fail after expiry uses token+claimed (no lease_expires_at >)", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const retryAt = new Date(clock.nowMs() + 60_000).toISOString();
    const executor = createScriptedExecutor({
      onQuery: () => [{ key: "job-hang", status: "scheduled", generation: 1 }],
    });
    const store = createDoReconciliationStore({ executor, clock });
    await store.fail({
      key: "job-hang",
      leaseToken: "lt_hang",
      error: "timeout",
      retryAt,
    });
    const call = executor.calls.find(
      (c) => c.sql.includes("UPDATE") && c.sql.includes("lease_token"),
    );
    expect(call).toBeDefined();
    expect(call!.sql).toContain("status = 'claimed'");
    expect(call!.sql).not.toMatch(/lease_expires_at\s*>/i);
    expect(call!.params).toContain("scheduled");
  });

  it("RECON-LEASE-1: markManualReview matches token on claimed (no lease_expires_at >)", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onQuery: () => [],
    });
    const store = createDoReconciliationStore({ executor, clock });
    await expect(
      store.markManualReview({
        key: "job-exp",
        leaseToken: "stale",
        note: "review",
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    const call = executor.calls.find(
      (c) => c.sql.includes("manual_review") && c.sql.includes("UPDATE"),
    );
    expect(call).toBeDefined();
    expect(call!.sql).toContain("status = 'claimed'");
    expect(call!.sql).not.toMatch(/lease_expires_at\s*>/i);
    expect(call!.params).toContain(now);
  });

  it("SQL-1: timestamp repair UPDATE is free-lease fenced (never unfenced key-only)", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const dueOffset = "2026-01-15T14:00:00+05:00";
    const dueZ = "2026-01-15T09:00:00.000Z";
    const now = new Date(clock.nowMs()).toISOString();
    const winnerLease = new Date(clock.nowMs() + 60_000).toISOString();
    let selectN = 0;
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("UPDATE") && sql.includes("status = 'claimed'")) {
          return [];
        }
        if (sql.includes("SELECT") && sql.includes("WHERE key")) {
          selectN += 1;
          if (selectN === 1) {
            return [
              {
                key: "job-race",
                status: "scheduled",
                subject_id: "pay_1",
                reason: "timeout",
                due_at: dueOffset,
                lease_owner: null,
                lease_token: null,
                lease_expires_at: null,
                attempts: 0,
                generation: 0,
                last_error_sanitized: null,
                tenant_id: null,
                created_at: dueZ,
                updated_at: dueZ,
                completed_at: null,
              },
            ];
          }
          return [
            {
              key: "job-race",
              status: "claimed",
              subject_id: "pay_1",
              reason: "timeout",
              due_at: dueZ,
              lease_owner: "winner",
              lease_token: "lt_winner",
              lease_expires_at: winnerLease,
              attempts: 1,
              generation: 1,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: dueZ,
              updated_at: now,
              completed_at: null,
            },
          ];
        }
        return [];
      },
      onRun: () => ({ changes: 0 }),
    });
    const store = createDoReconciliationStore({ executor, clock });
    const r = await store.claim({ key: "job-race", owner: "loser", leaseMs: 1000 });
    expect(r.kind).toBe("in_progress");
    const repair = executor.calls.find(
      (c) =>
        c.sql.includes("UPDATE") &&
        c.sql.includes("due_at") &&
        !c.sql.includes("status = 'claimed'"),
    );
    expect(repair).toBeDefined();
    expect(repair!.sql).toContain("status = 'scheduled'");
    expect(repair!.sql).toMatch(/lease_expires_at IS NULL/i);
    expect(repair!.sql).toMatch(/lease_expires_at\s*<=/i);
    expect(repair!.params).toEqual([dueZ, null, "job-race", now]);
  });

  it("schedule ON CONFLICT reopens only terminal statuses", async () => {
    const now = new Date().toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) {
          expect(sql).toMatch(/ON CONFLICT/i);
          expect(sql).toMatch(/DO UPDATE/i);
          expect(sql).toMatch(/completed['"]?\s*,\s*['"]failed['"]?\s*,\s*['"]manual_review/i);
          return [];
        }
        return [
          {
            key: "job1",
            status: "scheduled",
            subject_id: "pay_1",
            reason: "timeout",
            due_at: now,
            attempts: 0,
            generation: 0,
            created_at: now,
            updated_at: now,
          },
        ];
      },
    });
    const store = createDoReconciliationStore({ executor });
    const r = await store.schedule({
      key: "job1",
      subjectId: "pay_1",
      reason: "timeout",
      dueAt: now,
    });
    expect(r.kind).toBe("already_exists");
  });

  it("STORES-3: listDue canonicalizes offset input.now for soft-release and select", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const canonicalNow = "2026-01-15T12:00:00.000Z";
    const offsetNow = "2026-01-15T14:00:00+02:00";
    const executor = createScriptedExecutor({
      onRun: () => ({ changes: 0 }),
      onQuery: () => [],
    });
    const store = createDoReconciliationStore({ executor, clock });
    await store.listDue({ now: offsetNow });
    const soft = executor.calls.find(
      (c) => c.sql.includes("status = 'claimed'") && c.sql.includes("lease_expires_at"),
    );
    expect(soft).toBeDefined();
    expect(soft!.params[0]).toBe(canonicalNow);
    // STORES-1: soft-release restores unfinished attempt
    expect(soft!.sql).toMatch(/attempts\s*=\s*CASE WHEN attempts > 0 THEN attempts - 1/i);
    const select = executor.calls.find(
      (c) => c.sql.includes("SELECT") && c.sql.includes("scheduled"),
    );
    expect(select).toBeDefined();
    expect(select!.params[0]).toBe(canonicalNow);
  });
});

describe("listRetryable now canonical (STORES-2)", () => {
  it("canonicalizes offset input.now for soft-release and select", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const canonicalNow = "2026-01-15T12:00:00.000Z";
    const offsetNow = "2026-01-15T14:00:00+02:00";
    const executor = createScriptedExecutor({
      onRun: () => ({ changes: 0 }),
      onQuery: () => [],
    });
    const store = createDoWebhookInboxStore({ executor, clock });
    await store.listRetryable({ now: offsetNow });
    const soft = executor.calls.find(
      (c) => c.sql.includes("status = 'claimed'") && c.sql.includes("lease_expires_at"),
    );
    expect(soft).toBeDefined();
    expect(soft!.params[0]).toBe(canonicalNow);
    const select = executor.calls.find(
      (c) => c.sql.includes("SELECT") && c.sql.includes("pending"),
    );
    expect(select).toBeDefined();
    expect(select!.params[0]).toBe(canonicalNow);
  });
});

describe("withTransaction honesty (SHARED-1 / DO)", () => {
  it("fails closed when executor lacks transaction and runInTransaction", async () => {
    const executor = createScriptedExecutor({ omitTransaction: true });
    expect(executor.transaction).toBeUndefined();
    expect(executor.runInTransaction).toBeUndefined();
    const store = createDoIdempotencyStore({ executor });
    await expect(
      store.withTransaction(async () => "should-not-run"),
    ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
    await expect(
      store.withTransaction(() => "should-not-run"),
    ).rejects.toThrow(/refusing silent no-op/i);
  });

  it("runs sync fn inside executor.transaction (not pre-execute)", async () => {
    const executor = createScriptedExecutor({});
    const store = createDoIdempotencyStore({ executor });
    let ranInside = false;
    const out = await store.withTransaction(() => {
      // transaction must have been entered before body runs
      expect(executor.transactionEntered).toBe(1);
      ranInside = true;
      return "ok";
    });
    expect(out).toBe("ok");
    expect(ranInside).toBe(true);
    expect(executor.transactionEntered).toBe(1);
  });

  it("fails closed for async callbacks when only sync transaction is available", async () => {
    const executor = createScriptedExecutor({});
    expect(executor.runInTransaction).toBeUndefined();
    const store = createDoIdempotencyStore({ executor });
    await expect(
      store.withTransaction(async () => "async-without-runInTransaction"),
    ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
  });

  it("uses runInTransaction when present (async ok)", async () => {
    const executor = createScriptedExecutor({});
    let nested = false;
    executor.runInTransaction = async <T>(fn: () => Promise<T> | T) => {
      nested = true;
      return await fn();
    };
    const store = createDoIdempotencyStore({ executor });
    const out = await store.withTransaction(async () => "ok");
    expect(out).toBe("ok");
    expect(nested).toBe(true);
    // Prefer runInTransaction over bare transaction
    expect(executor.transactionEntered).toBe(0);
  });
});

describe("PERF-5 peek occupancy (fake executor)", () => {
  it("peekDue is a read-only SELECT (no lease UPDATE)", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const executor = createScriptedExecutor({
      onQuery: () => [{ earliest: now }],
    });
    const store = createDoReconciliationStore({ executor });
    expect(await store.peekDue({ now })).toEqual({
      occupied: true,
      earliest: now,
    });
    expect(executor.calls.every((c) => !/UPDATE/i.test(c.sql))).toBe(true);
  });

  it("peekRetryable is a read-only SELECT (no lease UPDATE)", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const executor = createScriptedExecutor({
      onQuery: () => [],
    });
    const store = createDoWebhookInboxStore({ executor });
    expect(await store.peekRetryable({ now })).toEqual({ occupied: false });
    expect(executor.calls.every((c) => !/UPDATE/i.test(c.sql))).toBe(true);
  });
});

