/**
 * Unit tests with a fake executor (no live DO).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  StoreLeaseLostError,
} from "@paykernel/testkit";
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

type Row = Record<string, unknown>;

function createScriptedExecutor(handlers: {
  onQuery?: (sql: string, params: readonly unknown[]) => Row[];
  onRun?: (
    sql: string,
    params: readonly unknown[],
  ) => { changes: number };
}): DoExecutor & { calls: Array<{ sql: string; params: readonly unknown[] }> } {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  return {
    calls,
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
      return fn();
    },
  };
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
