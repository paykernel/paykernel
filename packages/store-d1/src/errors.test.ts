import { describe, expect, it } from "bun:test";
import {
  isLikelyDriverFailure,
  mapDriverError,
  StoreUnavailableError,
  StoreLeaseLostError,
  StoreError,
  StoreTimeoutError,
  withMappedTransaction,
} from "./errors";

describe("mapDriverError", () => {
  it("passes through StoreError", () => {
    const e = new StoreLeaseLostError("x");
    expect(mapDriverError(e)).toBe(e);
  });

  it("maps connection refused to unavailable", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreUnavailableError);
    expect(mapped.code).toBe("unavailable");
    expect(mapped.retryable).toBe(true);
  });

  it("maps sqlite busy to timeout", () => {
    const err = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreTimeoutError);
  });

  it("maps D1_ERROR code to unavailable", () => {
    const err = Object.assign(new Error("D1 storage backend internal error"), {
      code: "D1_ERROR",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreUnavailableError);
  });

  it("sanitizes CF tokens, account IDs, and bearer tokens from messages", () => {
    const err = new Error(
      "fail apiToken=supersecret123 CF_API_TOKEN=abc CLOUDFLARE_API_TOKEN=def account_id=acct_xyz123 Bearer eyJhbGciOiJIUzI1NiJ9.xyz https://api.cloudflare.com/client/v4/accounts/xyz",
    );
    const mapped = mapDriverError(err);
    expect(mapped.message).not.toContain("supersecret123");
    expect(mapped.message).not.toContain("CF_API_TOKEN=abc");
    expect(mapped.message).not.toContain("CLOUDFLARE_API_TOKEN=def");
    expect(mapped.message).not.toContain("acct_xyz123");
    expect(mapped.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(mapped.message).toContain("***");
  });

  it("defaults unknown errors to unavailable StoreError", () => {
    const mapped = mapDriverError(new Error("weird"));
    expect(mapped).toBeInstanceOf(StoreError);
    expect(mapped.code).toBe("unavailable");
  });
});

describe("isLikelyDriverFailure / withMappedTransaction", () => {
  it("treats coded connection errors as driver failures", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
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
        throw Object.assign(new Error("connection refused"), {
          code: "ECONNREFUSED",
        });
      }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });
});
