/**
 * Unit tests with a fake executor (no live D1).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
} from "@paykernel/testkit";
import {
  StoreLeaseLostError,
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

