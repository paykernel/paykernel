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
  withMappedErrors,
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

  it("maps timeout", () => {
    const err = Object.assign(new Error("Command timed out"), {
      code: "ETIMEDOUT",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreTimeoutError);
  });

  it("maps WRONGTYPE to corrupted", () => {
    const err = Object.assign(new Error("WRONGTYPE Operation against a key"), {
      code: "WRONGTYPE",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreCorruptedRecordError);
  });

  it("maps CROSSSLOT with clusterKeys honesty (REDIS-2)", () => {
    const err = new Error(
      "CROSSSLOT Keys in request don't hash to the same slot",
    );
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreInvalidSchemaError);
    expect(mapped.message.toLowerCase()).toContain("crossslot");
    expect(mapped.message).toMatch(/clusterKeys/i);
  });

  it("sanitizes redis URLs and secrets from messages", () => {
    const err = new Error(
      "fail redis://user:supersecret@localhost:6379/0 password=hunter2 boom",
    );
    const mapped = mapDriverError(err);
    expect(mapped.message).not.toContain("supersecret");
    expect(mapped.message).not.toContain("hunter2");
    expect(mapped.message).toContain("redis://***");
    expect(mapped.message.length).toBeLessThanOrEqual(256);
  });

  it("maps auth failures to unavailable", () => {
    const err = new Error("NOAUTH Authentication required");
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreUnavailableError);
  });

  it("defaults unknown errors to unavailable", () => {
    const mapped = mapDriverError(new Error("weird"));
    expect(mapped).toBeInstanceOf(StoreError);
    expect(mapped.code).toBe("unavailable");
  });
});

describe("withMappedErrors", () => {
  it("maps driver failures", async () => {
    await expect(
      withMappedErrors(async () => {
        throw Object.assign(new Error("connection refused"), {
          code: "ECONNREFUSED",
        });
      }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("passes StoreError through", async () => {
    await expect(
      withMappedErrors(async () => {
        throw new StoreLeaseLostError("lost");
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });
});

describe("isLikelyDriverFailure", () => {
  it("detects coded redis errors", () => {
    expect(
      isLikelyDriverFailure(
        Object.assign(new Error("x"), { code: "ECONNRESET" }),
      ),
    ).toBe(true);
  });

  it("does not treat plain app errors as driver failures", () => {
    expect(isLikelyDriverFailure(new Error("business rule"))).toBe(false);
  });
});
