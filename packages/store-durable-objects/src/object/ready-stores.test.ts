/**
 * I15-DO-ENSURE-SCHEMA: readyStores must apply schema even when
 * tableNamespace is omitted, and fail closed if migrate throws.
 */
import { describe, expect, it } from "bun:test";
import { PaymentsStoreObject } from "./payments-store-object";
import { createMockDoSql } from "../test-utils/mock-do-sql";
import type { DoStorageLike, SqlStorageCursorLike } from "../types";

describe("readyStores schema ensure (I15-DO-ENSURE-SCHEMA)", () => {
  it("default RPC path applies schema when tableNamespace is omitted", async () => {
    const handle = createMockDoSql();
    try {
      const obj = new PaymentsStoreObject({ storage: handle.storage });
      const before = handle.sqlite
        .query(
          `SELECT name AS name FROM sqlite_master WHERE type = 'table' AND name LIKE 'payment_%'`,
        )
        .all() as Array<{ name: string }>;
      expect(before.length).toBe(0);

      const r = await obj.reserveIdempotency({
        key: "default-rpc",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      expect(r.kind).toBe("acquired");

      const tables = handle.sqlite
        .query(`SELECT name AS name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>;
      expect(tables.some((t) => t.name === "payment_idempotency")).toBe(true);

      const row = handle.sqlite
        .query(
          `SELECT key AS key FROM payment_idempotency WHERE key = ?`,
        )
        .get("default-rpc") as { key: string } | null;
      expect(row?.key).toBe("default-rpc");
    } finally {
      handle.close();
    }
  });

  it("fails closed when migrate errors (does not run the store mutation)", async () => {
    const executed: string[] = [];
    const storage: DoStorageLike = {
      sql: {
        exec(query: string): SqlStorageCursorLike {
          executed.push(query);
          throw new Error("schema migrate failed");
        },
      },
      transactionSync<T>(callback: () => T): T {
        return callback();
      },
    };
    const obj = new PaymentsStoreObject({ storage });
    await expect(
      obj.reserveIdempotency({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
      }),
    ).rejects.toThrow();
    expect(
      executed.some(
        (sql) =>
          /INSERT\s+INTO/i.test(sql) && /payment_idempotency/i.test(sql),
      ),
    ).toBe(false);
  });
});
