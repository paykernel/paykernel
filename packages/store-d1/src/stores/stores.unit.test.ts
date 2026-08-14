/**
 * Unit tests with a fake executor (no live D1).
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
  createD1IdempotencyStore,
  createD1WebhookInboxStore,
  createD1ReconciliationStore,
  createD1Stores,
  createD1PaymentStores,
} from "../index";
import type { D1Executor } from "../executor";

type Row = Record<string, unknown>;

function createScriptedExecutor(handlers: {
  onQuery?: (sql: string, params: readonly unknown[]) => Row[] | Promise<Row[]>;
  onExecute?: (
    sql: string,
    params: readonly unknown[],
  ) => { changes: number } | Promise<{ changes: number }>;
}): D1Executor & { calls: Array<{ sql: string; params: readonly unknown[] }> } {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  return {
    calls,
    async query<T = Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      calls.push({ sql, params });
      const rows = (await handlers.onQuery?.(sql, params)) ?? [];
      return rows as T[];
    },
    async execute(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<{ changes: number }> {
      calls.push({ sql, params });
      return (await handlers.onExecute?.(sql, params)) ?? { changes: 0 };
    },
  };
}

describe("idempotency store unit (fake executor)", () => {
  it("complete with 0 rows throws StoreLeaseLostError", async () => {
    const executor = createScriptedExecutor({
      onQuery: () => [],
    });
    const store = createD1IdempotencyStore({ executor });
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
    const store = createD1IdempotencyStore({ executor });
    const r = await store.renew({ key: "k", leaseToken: "stale", leaseMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lease_lost");
  });

  it("reserve returns acquired when RETURNING row present", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
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
              created_at: now,
              updated_at: now,
              result_json: null,
            },
          ];
        }
        return [];
      },
    });
    const store = createD1IdempotencyStore({ executor, clock });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 5000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind === "acquired") {
      expect(r.record.generation).toBe(1);
      expect(r.leaseToken.length).toBeGreaterThan(0);
    }
    const insertCall = executor.calls.find((c) => c.sql.includes("INSERT"));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params).toContain(now);
    // Prefer single-statement ON CONFLICT
    expect(insertCall!.sql).toContain("ON CONFLICT");
    expect(insertCall!.sql).toContain("RETURNING");
  });

  it("reserve classifies indeterminate when claim empty", async () => {
    const now = new Date().toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) return [];
        return [
          {
            key: "k",
            status: "indeterminate",
            fingerprint: "fp",
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
    const store = createD1IdempotencyStore({ executor });
    const r = await store.reserve({
      key: "k",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("indeterminate");
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
    const store = createD1IdempotencyStore({ executor });
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
    const store = createD1IdempotencyStore({ executor });
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
      onExecute: () => ({ changes: 1 }),
    });
    const store = createD1IdempotencyStore({ executor, clock });
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
    const store = createD1IdempotencyStore({ executor });
    await store.deleteExpired({ before: "2026-01-15T17:00:00+05:00" });
    const del = executor.calls.find((c) => c.sql.includes("DELETE"));
    expect(del).toBeDefined();
    expect(del!.params[0]).toBe("2026-01-15T12:00:00.000Z");
  });
});

describe("webhook / recon unit (fake executor)", () => {
  it("webhook complete with 0 rows throws StoreLeaseLostError", async () => {
    const executor = createScriptedExecutor({ onQuery: () => [] });
    const store = createD1WebhookInboxStore({ executor });
    await expect(
      store.complete({ key: "k", leaseToken: "tok" }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("recon claim returns not_found when empty", async () => {
    const executor = createScriptedExecutor({ onQuery: () => [] });
    const store = createD1ReconciliationStore({ executor });
    const r = await store.claim({ key: "missing", owner: "w", leaseMs: 1000 });
    expect(r.kind).toBe("not_found");
  });

  it("P11-DEL-1: webhook/recon deleteExpired binds canonical Z before", async () => {
    const before = "2026-01-15T17:00:00+05:00";
    const z = "2026-01-15T12:00:00.000Z";
    const webhookExec = createScriptedExecutor({ onQuery: () => [] });
    await createD1WebhookInboxStore({ executor: webhookExec }).deleteExpired({
      before,
    });
    expect(webhookExec.calls.find((c) => c.sql.includes("DELETE"))?.params[0]).toBe(z);
    const reconExec = createScriptedExecutor({ onQuery: () => [] });
    await createD1ReconciliationStore({ executor: reconExec }).deleteExpired({
      before,
    });
    expect(reconExec.calls.find((c) => c.sql.includes("DELETE"))?.params[0]).toBe(z);
  });
});

describe("createD1Stores / createD1PaymentStores bundle", () => {
  it("shares clock and does not require migrate", () => {
    const clock = createFakeClock();
    const executor = createScriptedExecutor({});
    const bundle = createD1Stores({ executor, clock });
    expect(bundle.clock).toBe(clock);
    expect(bundle.manifest.name).toBe("cloudflare-d1");
    expect(bundle.idempotency).toBeDefined();
    expect(bundle.webhookInbox).toBeDefined();
    expect(bundle.reconciliation).toBeDefined();
    expect(executor.calls.length).toBe(0);
  });

  it("createD1PaymentStores accepts structural db binding", () => {
    const clock = createFakeClock();
    let prepareCalls = 0;
    const db = {
      prepare() {
        prepareCalls += 1;
        return {
          bind() {
            return this;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [], success: true };
          },
          async run() {
            return { success: true, meta: { changes: 0 } };
          },
        };
      },
      async batch() {
        return [];
      },
    };
    const bundle = createD1PaymentStores({ db, clock });
    expect(bundle.manifest.coordinationScope).toBe("multi-host");
    expect(prepareCalls).toBe(0);
  });
});

describe("webhook store unit (B5/B4)", () => {
  it("listRetryable soft-releases expired claimed rows then selects pending", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onExecute: () => ({ changes: 1 }),
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
    const store = createD1WebhookInboxStore({ executor, clock });
    const listed = await store.listRetryable({ now });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe("abandoned");
    const soft = executor.calls.find(
      (c) => c.sql.includes("status = 'claimed'") && c.sql.includes("lease_expires_at"),
    );
    expect(soft).toBeDefined();
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
    const store = createD1WebhookInboxStore({ executor, clock });
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
  it("SQL-1: timestamp repair UPDATE is free-lease fenced (never unfenced key-only)", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const dueOffset = "2026-01-15T14:00:00+05:00";
    const dueZ = "2026-01-15T09:00:00.000Z";
    const now = new Date(clock.nowMs()).toISOString();
    const winnerLease = new Date(clock.nowMs() + 60_000).toISOString();
    let selectN = 0;
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        // claim UPDATE … RETURNING
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
      onExecute: () => ({ changes: 0 }),
    });
    const store = createD1ReconciliationStore({ executor, clock });
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
    // params: dueAt, leaseExpiresAt, key, now
    expect(repair!.params).toEqual([dueZ, null, "job-race", now]);
  });

  it("listDue soft-releases expired claimed rows then selects scheduled", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onExecute: () => ({ changes: 1 }),
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
    const store = createD1ReconciliationStore({ executor, clock });
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
  });

  it("SQL-2: listDue canonicalizes offset input.now for TEXT lexical compares", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const offsetNow = "2026-01-15T17:00:00+05:00";
    const canonicalNow = "2026-01-15T12:00:00.000Z";
    const executor = createScriptedExecutor({
      onExecute: () => ({ changes: 0 }),
      onQuery: () => [],
    });
    const store = createD1ReconciliationStore({ executor, clock });
    await store.listDue({ now: offsetNow, limit: 10 });
    const soft = executor.calls.find(
      (c) => c.sql.includes("status = 'claimed'") && c.sql.includes("lease_expires_at"),
    );
    expect(soft).toBeDefined();
    expect(soft!.params[0]).toBe(canonicalNow);
    const select = executor.calls.find(
      (c) => c.sql.includes("SELECT") && c.sql.includes("due_at <="),
    );
    expect(select).toBeDefined();
    expect(select!.params[0]).toBe(canonicalNow);
  });

  it("markManualReview requires active lease (expired → lease_lost)", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onQuery: () => [],
    });
    const store = createD1ReconciliationStore({ executor, clock });
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
    expect(call!.sql).toContain("lease_expires_at");
    expect(call!.sql).toContain("lease_expires_at >");
    expect(call!.params).toContain(now);
  });
});

describe("withTransaction honesty (SHARED-1)", () => {
  it("fails closed when executor lacks transaction (no silent no-op)", async () => {
    const executor = createScriptedExecutor({});
    expect(executor.transaction).toBeUndefined();
    const store = createD1IdempotencyStore({ executor });
    await expect(
      store.withTransaction(async () => "should-not-run"),
    ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
    await expect(
      store.withTransaction(async () => "should-not-run"),
    ).rejects.toThrow(/refusing silent no-op/i);
  });

  it("uses executor.transaction when present", async () => {
    const executor = createScriptedExecutor({});
    let nested = false;
    executor.transaction = async <T>(fn: (tx: typeof executor) => Promise<T>) => {
      nested = true;
      return fn(executor);
    };
    const store = createD1IdempotencyStore({ executor });
    const out = await store.withTransaction(async () => "ok");
    expect(out).toBe("ok");
    expect(nested).toBe(true);
  });

  it("STORES-1: concurrent withTransaction isolate getExecutor (no process-global swap)", async () => {
    const queryLog: string[] = [];
    let nextLabel = 0;
    const labels = ["A", "B"] as const;

    const base = createScriptedExecutor({});
    base.transaction = async <T>(fn: (tx: D1Executor) => Promise<T>) => {
      const label = labels[nextLabel++] ?? `T${nextLabel}`;
      const tx: D1Executor = {
        async query() {
          queryLog.push(label);
          return [];
        },
        async execute() {
          queryLog.push(`${label}:exec`);
          return { changes: 0 };
        },
      };
      return fn(tx);
    };

    const store = createD1IdempotencyStore({ executor: base });

    let releaseA!: () => void;
    let releaseB!: () => void;
    const holdA = new Promise<void>((r) => {
      releaseA = r;
    });
    const holdB = new Promise<void>((r) => {
      releaseB = r;
    });

    const pA = store.withTransaction(async () => {
      await store.get("a1");
      await holdA;
      await store.get("a2");
      return "a";
    });

    for (let i = 0; i < 20; i++) await Promise.resolve();

    const pB = store.withTransaction(async () => {
      await store.get("b1");
      await holdB;
      await store.get("b2");
      return "b";
    });

    for (let i = 0; i < 20; i++) await Promise.resolve();

    releaseA();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    releaseB();

    await expect(Promise.all([pA, pB])).resolves.toEqual(["a", "b"]);
    expect(queryLog).toEqual(["A", "B", "A", "B"]);
  });
});

describe("serializeResultJson honesty (STORES-3)", () => {
  it("rejects oversized idempotency result instead of truncating", async () => {
    const { serializeResultJson } = await import("./shared");
    const { MAX_RESULT_JSON_BYTES } = await import("@paykernel/sql-foundation");
    const { StoreSerializationFailureError } = await import("@paykernel/store-contracts");
    const ok = { status: "paid", amount: "10.00" };
    expect(JSON.parse(serializeResultJson(ok))).toEqual(ok);
    const huge = { blob: "x".repeat(MAX_RESULT_JSON_BYTES) };
    expect(() => serializeResultJson(huge)).toThrow(StoreSerializationFailureError);
  });
});

describe("listRetryable now canonical (STORES-2)", () => {
  it("canonicalizes offset input.now for soft-release and select", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const canonicalNow = "2026-01-15T12:00:00.000Z";
    const offsetNow = "2026-01-15T14:00:00+02:00";
    const executor = createScriptedExecutor({
      onExecute: () => ({ changes: 0 }),
      onQuery: () => [],
    });
    const store = createD1WebhookInboxStore({ executor, clock });
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

