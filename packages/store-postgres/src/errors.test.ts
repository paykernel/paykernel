import { describe, expect, it } from "bun:test";
import {
  isLikelyDriverFailure,
  mapDriverError,
  StoreUnavailableError,
  StoreLeaseLostError,
  StoreError,
  StoreSerializationFailureError,
  StoreTimeoutError,
  withMappedTransaction,
} from "./errors";

describe("mapDriverError", () => {
  it("passes through StoreError", () => {
    const e = new StoreLeaseLostError("x");
    expect(mapDriverError(e)).toBe(e);
  });

  it("maps connection refused to unavailable", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreUnavailableError);
    expect(mapped.code).toBe("unavailable");
    expect(mapped.retryable).toBe(true);
  });

  it("maps serialization failure 40001", () => {
    const err = Object.assign(new Error("could not serialize access"), { code: "40001" });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreSerializationFailureError);
    expect(mapped.code).toBe("serialization_failure");
  });

  it("maps statement timeout", () => {
    const err = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreTimeoutError);
  });

  it("sanitizes connection strings from messages", () => {
    const err = new Error("fail postgres://user:secret@localhost:5432/db boom");
    const mapped = mapDriverError(err);
    expect(mapped.message).not.toContain("secret");
    expect(mapped.message).toContain("postgres://***");
  });

  it("defaults unknown errors to unavailable StoreError", () => {
    const mapped = mapDriverError(new Error("weird"));
    expect(mapped).toBeInstanceOf(StoreError);
    expect(mapped.code).toBe("unavailable");
  });
});

describe("isLikelyDriverFailure / withMappedTransaction", () => {
  it("treats coded connection errors as driver failures", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(isLikelyDriverFailure(err)).toBe(true);
  });

  it("does not treat plain application errors as driver failures", () => {
    expect(isLikelyDriverFailure(new Error("force_rollback"))).toBe(false);
    expect(isLikelyDriverFailure(new Error("business rule violated"))).toBe(false);
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
        throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });
});
