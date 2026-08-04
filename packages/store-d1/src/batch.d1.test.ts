/**
 * D1 batch() multi-statement atomicity / rollback verification (mock D1).
 *
 * Mock fidelity: implements batch as BEGIN IMMEDIATE … COMMIT/ROLLBACK on
 * local bun:sqlite. This mirrors D1's documented "batch is a SQL transaction;
 * failure aborts the sequence" semantics. It does not model remote D1 limits
 * (statement count/size caps, network partitions, or read replicas).
 */
import { describe, expect, it } from "bun:test";
import { createD1Executor, migrateD1Adapter } from "./index";
import { createMockD1 } from "./test-utils/mock-d1";
import { uniqueTablePrefix } from "./test-utils/d1-env";

describe("d1 batch atomicity (mock)", () => {
  it("batch commits multiple statements", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("bt");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });

      expect(typeof executor.batch).toBe("function");
      await executor.batch!([
        {
          sql: `INSERT INTO ${prefix}payment_idempotency (
            key, status, fingerprint, attempts, generation, created_at, updated_at
          ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: ["k1", "fp", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
        },
        {
          sql: `INSERT INTO ${prefix}payment_idempotency (
            key, status, fingerprint, attempts, generation, created_at, updated_at
          ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
          params: ["k2", "fp", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
        },
      ]);

      const rows = await executor.query<{ key: string }>(
        `SELECT key FROM ${prefix}payment_idempotency ORDER BY key`,
      );
      expect(rows.map((r) => r.key)).toEqual(["k1", "k2"]);
    } finally {
      handle.close();
    }
  });

  it("batch rolls back entire sequence when a statement fails", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("br");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });

      // Seed one row
      await executor.execute(
        `INSERT INTO ${prefix}payment_idempotency (
          key, status, fingerprint, attempts, generation, created_at, updated_at
        ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
        ["exists", "fp", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
      );

      await expect(
        executor.batch!([
          {
            sql: `INSERT INTO ${prefix}payment_idempotency (
              key, status, fingerprint, attempts, generation, created_at, updated_at
            ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
            params: [
              "new-row",
              "fp",
              "2020-01-01T00:00:00.000Z",
              "2020-01-01T00:00:00.000Z",
            ],
          },
          // Unique constraint failure — should roll back previous insert in batch
          {
            sql: `INSERT INTO ${prefix}payment_idempotency (
              key, status, fingerprint, attempts, generation, created_at, updated_at
            ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
            params: [
              "exists",
              "fp",
              "2020-01-01T00:00:00.000Z",
              "2020-01-01T00:00:00.000Z",
            ],
          },
        ]),
      ).rejects.toBeDefined();

      const rows = await executor.query<{ key: string }>(
        `SELECT key FROM ${prefix}payment_idempotency ORDER BY key`,
      );
      // new-row must not be present (batch rollback)
      expect(rows.map((r) => r.key)).toEqual(["exists"]);
    } finally {
      handle.close();
    }
  });
});
