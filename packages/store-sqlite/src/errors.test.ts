import { describe, expect, it } from "bun:test";
import {
  isLikelyDriverFailure,
  mapDriverError,
  StoreUnavailableError,
  StoreLeaseLostError,
  StoreError,
  StoreTimeoutError,
  StoreCorruptedRecordError,
  StoreInvalidSchemaError,
  withMappedTransaction,
} from "./errors";

describe("mapDriverError", () => {
  it("passes through StoreError", () => {
    const e = new StoreLeaseLostError("x");
    expect(mapDriverError(e)).toBe(e);
  });

  it("maps SQLITE_BUSY to timeout", () => {
    const err = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreTimeoutError);
    expect(mapped.code).toBe("timeout");
    expect(mapped.retryable).toBe(true);
  });

  it("maps SQLITE_LOCKED to timeout", () => {
    const err = Object.assign(new Error("database table is locked"), {
      code: "SQLITE_LOCKED",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreTimeoutError);
  });

  it("maps no such table to invalid schema", () => {
    const err = Object.assign(new Error("no such table: payment_idempotency"), {
      code: "SQLITE_ERROR",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreInvalidSchemaError);
  });

  it("maps corrupt database", () => {
    const err = Object.assign(new Error("database disk image is malformed"), {
      code: "SQLITE_CORRUPT",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreCorruptedRecordError);
  });

  it("sanitizes secrets and path-like tokens from messages", () => {
    const err = new Error("fail password=supersecret token=abc file:///tmp/secret.db boom");
    const mapped = mapDriverError(err);
    expect(mapped.message).not.toContain("supersecret");
    expect(mapped.message).not.toContain("token=abc");
  });

  it("defaults unknown errors to unavailable StoreError", () => {
    const mapped = mapDriverError(new Error("weird"));
    expect(mapped).toBeInstanceOf(StoreError);
    expect(mapped.code).toBe("unavailable");
  });
});

describe("isLikelyDriverFailure / withMappedTransaction", () => {
  it("treats coded SQLITE_BUSY as driver failures", () => {
    const err = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    expect(isLikelyDriverFailure(err)).toBe(true);
  });

  it("does not treat plain application errors as driver failures", () => {
    expect(isLikelyDriverFailure(new Error("force_rollback"))).toBe(false);
    expect(isLikelyDriverFailure(new Error("business rule violated"))).toBe(false);
  });

  it("does not reclassify already-mapped StoreError as raw driver failure", () => {
    expect(isLikelyDriverFailure(new StoreLeaseLostError("lease lost"))).toBe(false);
    expect(isLikelyDriverFailure(new StoreUnavailableError("down"))).toBe(false);
  });

  it("propagates application errors from transaction callbacks", async () => {
    await expect(
      withMappedTransaction(async () => {
        throw new Error("force_rollback");
      }),
    ).rejects.toThrow("force_rollback");
  });

  it("maps driver-like failures inside transaction wrappers", async () => {
    await expect(
      withMappedTransaction(async () => {
        throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
      }),
    ).rejects.toBeInstanceOf(StoreTimeoutError);
  });
});
