import { describe, expect, it } from "bun:test";
import {
  isLikelyDriverFailure,
  mapDriverError,
  StoreUnavailableError,
  StoreLeaseLostError,
  StoreError,
  StoreTimeoutError,
  StoreUnsupportedFeatureError,
  StoreInvalidSchemaError,
  withMappedErrors,
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

  it("maps durable object errors to unavailable", () => {
    const err = new Error("Durable Object internal error");
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

describe("P17-ERR reconstruct StoreError after RPC clone", () => {
  it("cloned Error { name: StoreLeaseLostError } through withMappedErrors is StoreLeaseLostError not StoreUnavailableError", async () => {
    const cloned = new Error("Lease lost or fencing token rejected");
    cloned.name = "StoreLeaseLostError";
    expect(cloned instanceof StoreLeaseLostError).toBe(false);
    expect(cloned instanceof StoreError).toBe(false);

    let caught: unknown;
    try {
      await withMappedErrors(() => {
        throw cloned;
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StoreLeaseLostError);
    expect(caught).not.toBeInstanceOf(StoreUnavailableError);
    expect((caught as StoreLeaseLostError).code).toBe("lease_lost");
    expect((caught as StoreLeaseLostError).retryable).toBe(false);
  });

  it("does not treat lease_lost as retryable unavailable via mapDriverError", () => {
    const cloned = new Error("Durable Object lease lost");
    cloned.name = "StoreLeaseLostError";
    const mapped = mapDriverError(cloned);
    expect(mapped).toBeInstanceOf(StoreLeaseLostError);
    expect(mapped).not.toBeInstanceOf(StoreUnavailableError);
    expect(mapped.retryable).toBe(false);
    expect(mapped.code).toBe("lease_lost");
  });

  it("reconstructs other StoreError names and __pkStoreError envelopes", async () => {
    const unsupported = new Error("listDue unsupported");
    unsupported.name = "StoreUnsupportedFeatureError";
    await expect(
      withMappedErrors(() => {
        throw unsupported;
      }),
    ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);

    const envelope = {
      __pkStoreError: true,
      code: "invalid_schema" as const,
      name: "StoreInvalidSchemaError",
      message: "no such table",
    };
    const mapped = mapDriverError(envelope);
    expect(mapped).toBeInstanceOf(StoreInvalidSchemaError);
    expect(mapped.code).toBe("invalid_schema");
    expect(mapped.retryable).toBe(false);
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
});
