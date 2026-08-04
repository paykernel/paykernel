/**
 * 16.1 / 16.2 — D1 binding path + prepared/bind-only executor usage.
 *
 * Proves createD1Executor / createD1PaymentStores use prepare+bind+first|all|run
 * with bound parameters (never raw string concat of user values into SQL).
 * No REST / account credentials required for the binding path.
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import {
  createD1Executor,
  createD1PaymentStores,
  isD1DatabaseLike,
  migrateD1Adapter,
} from "./index";
import { createMockD1 } from "./test-utils/mock-d1";
import { uniqueTablePrefix } from "./test-utils/d1-env";

describe("d1 prepared statements + binding path (16.1 / 16.2)", () => {
  it("createD1PaymentStores accepts structural D1DatabaseLike (no REST credentials)", () => {
    const handle = createMockD1();
    try {
      expect(isD1DatabaseLike(handle.db)).toBe(true);
      // Only { db } — no accountId / apiToken / databaseId fields.
      const stores = createD1PaymentStores({ db: handle.db });
      expect(stores.idempotency).toBeDefined();
      expect(stores.webhookInbox).toBeDefined();
      expect(stores.reconciliation).toBeDefined();
      expect(stores.executor).toBeDefined();
      expect(stores.manifest.coordinationScope).toBe("multi-host");
      // Construction did not touch the binding (no auto-migrate).
      expect(handle.prepareCount).toBe(0);
    } finally {
      handle.close();
    }
  });

  it("createD1Executor uses prepare/bind/all|run — params not interpolated into SQL", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("pb");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });

      handle.resetTraces();

      const userKey = "user-key-with-'quotes";
      const fingerprint = "fp-secret-ish";
      const now = "2020-01-01T00:00:00.000Z";

      await executor.execute(
        `INSERT INTO ${prefix}payment_idempotency (
          key, status, fingerprint, attempts, generation, created_at, updated_at
        ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
        [userKey, fingerprint, now, now],
      );

      expect(handle.prepareCount).toBeGreaterThanOrEqual(1);
      expect(handle.bindCount).toBeGreaterThanOrEqual(1);
      expect(handle.statementTraces.length).toBeGreaterThanOrEqual(1);

      const insertTrace = handle.statementTraces.find((t) =>
        t.sql.includes("INSERT INTO"),
      );
      expect(insertTrace).toBeDefined();
      // SQL must use placeholders — user values only appear as bound params.
      expect(insertTrace!.sql).toContain("?");
      expect(insertTrace!.sql).not.toContain(userKey);
      expect(insertTrace!.sql).not.toContain(fingerprint);
      expect(insertTrace!.boundParams).toContain(userKey);
      expect(insertTrace!.boundParams).toContain(fingerprint);
      expect(insertTrace!.method).toBe("run");

      handle.resetTraces();

      const rows = await executor.query<{ key: string }>(
        `SELECT key FROM ${prefix}payment_idempotency WHERE key = ?`,
        [userKey],
      );
      expect(rows.map((r) => r.key)).toEqual([userKey]);

      const selectTrace = handle.statementTraces.find((t) =>
        t.sql.includes("SELECT"),
      );
      expect(selectTrace).toBeDefined();
      expect(selectTrace!.sql).toContain("?");
      expect(selectTrace!.sql).not.toContain(userKey);
      expect(selectTrace!.boundParams).toEqual([userKey]);
      expect(selectTrace!.method).toBe("all");
    } finally {
      handle.close();
    }
  });

  it("store reserve claims bind lease token / key (single-statement UPSERT path)", async () => {
    const handle = createMockD1();
    try {
      const prefix = uniqueTablePrefix("cl");
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const stores = createD1PaymentStores({
        db: handle.db,
        clock,
        namespace: { tablePrefix: prefix },
      });
      await migrateD1Adapter(handle.db, { namespace: { tablePrefix: prefix } });

      handle.resetTraces();

      const key = "claim-key-xyz";
      const r = await stores.idempotency.reserve({
        key,
        fingerprint: "fp1",
        owner: "worker-1",
        leaseMs: 10_000,
      });
      expect(r.kind).toBe("acquired");

      // Claim SQL is prepared + bound; key never spliced into SQL text.
      const claimTrace = handle.statementTraces.find(
        (t) => t.sql.includes("ON CONFLICT") || t.sql.includes("INSERT INTO"),
      );
      expect(claimTrace).toBeDefined();
      expect(claimTrace!.sql).toContain("?");
      expect(claimTrace!.sql).not.toContain(key);
      expect(claimTrace!.boundParams).toContain(key);
      expect(claimTrace!.boundParams).toContain("fp1");
      expect(claimTrace!.boundParams).toContain("worker-1");
      // RETURNING path uses .all() so rows surface for classification.
      expect(claimTrace!.method).toBe("all");
      expect(handle.bindCount).toBeGreaterThan(0);
    } finally {
      handle.close();
    }
  });

  it("batch statements are prepare+bind; not string-concat of params", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("bb");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });
      handle.resetTraces();

      const k1 = "batch-k1";
      const k2 = "batch-k2";
      await executor.batch!([
        {
          sql: `INSERT INTO ${prefix}payment_idempotency (
            key, status, fingerprint, attempts, generation, created_at, updated_at
          ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: [k1, "fp", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
        },
        {
          sql: `INSERT INTO ${prefix}payment_idempotency (
            key, status, fingerprint, attempts, generation, created_at, updated_at
          ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: [k2, "fp", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
        },
      ]);

      expect(handle.prepareCount).toBe(2);
      expect(handle.bindCount).toBe(2);
      for (const t of handle.statementTraces) {
        expect(t.sql).toContain("?");
        expect(t.sql).not.toContain(k1);
        expect(t.sql).not.toContain(k2);
      }
      const boundKeys = handle.statementTraces.flatMap((t) => t.boundParams);
      expect(boundKeys).toContain(k1);
      expect(boundKeys).toContain(k2);
    } finally {
      handle.close();
    }
  });
});
