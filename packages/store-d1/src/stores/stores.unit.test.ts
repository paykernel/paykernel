/**
 * Unit tests with a fake executor (no live D1).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  StoreLeaseLostError,
} from "@paykernel/testkit";
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
