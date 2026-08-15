/**
 * P17-CURSOR: bindHashPartitionLayout must consume every sql.exec cursor
 * before the next statement (CF DO SQL has no snapshot isolation).
 */
import { describe, expect, it } from "bun:test";
import { PaymentsStoreObject } from "./payments-store-object";
import type { DoStorageLike, SqlStorageCursorLike } from "../types";

function createCursorTrackingStorage(): {
  storage: DoStorageLike;
  outstanding: () => number;
  maxOutstanding: () => number;
  transactionSyncCount: () => number;
} {
  let outstanding = 0;
  let maxOutstanding = 0;
  let transactionSyncCount = 0;
  const storage: DoStorageLike = {
    sql: {
      exec(): SqlStorageCursorLike {
        outstanding += 1;
        maxOutstanding = Math.max(maxOutstanding, outstanding);
        return {
          toArray() {
            outstanding -= 1;
            return [];
          },
        };
      },
    },
    transactionSync<T>(callback: () => T): T {
      transactionSyncCount += 1;
      return callback();
    },
  };
  return {
    storage,
    outstanding: () => outstanding,
    maxOutstanding: () => maxOutstanding,
    transactionSyncCount: () => transactionSyncCount,
  };
}

describe("bindHashPartitionLayout cursor consume (P17-CURSOR)", () => {
  it("toArray() every sql.exec before the next statement and seals inside transactionSync", async () => {
    const handle = createCursorTrackingStorage();
    const obj = new PaymentsStoreObject({ storage: handle.storage });
    await obj.bindHashPartitionLayout(8);
    expect(handle.outstanding()).toBe(0);
    expect(handle.maxOutstanding()).toBe(1);
    expect(handle.transactionSyncCount()).toBeGreaterThanOrEqual(1);
  });
});
