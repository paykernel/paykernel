import { describe, expect, it } from "bun:test";
import {
  MAX_SANITIZED_ERROR_LENGTH,
  RecordValidationError,
  enforceMaxSanitizedError,
  isIsoTimestamp,
  validateIdempotencyStatus,
  validateIsoTimestamp,
  validateLeaseToken,
  validateNonNegativeInt,
  validatePayloadHash,
  validateReconciliationStatus,
  validateWebhookInboxStatus,
} from "./validation";

describe("enforceMaxSanitizedError", () => {
  it("returns undefined for null/empty", () => {
    expect(enforceMaxSanitizedError(null)).toBeUndefined();
    expect(enforceMaxSanitizedError(undefined)).toBeUndefined();
    expect(enforceMaxSanitizedError("   ")).toBeUndefined();
  });

  it("passes through short messages", () => {
    expect(enforceMaxSanitizedError("timeout")).toBe("timeout");
  });

  it("truncates to MAX_SANITIZED_ERROR_LENGTH", () => {
    const long = "x".repeat(MAX_SANITIZED_ERROR_LENGTH + 50);
    const out = enforceMaxSanitizedError(long)!;
    expect(out.length).toBe(MAX_SANITIZED_ERROR_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects custom maxLength", () => {
    const out = enforceMaxSanitizedError("abcdefghij", { maxLength: 5 })!;
    expect(out.length).toBe(5);
  });
});

describe("status enums", () => {
  it("validates idempotency statuses", () => {
    expect(validateIdempotencyStatus("reserved")).toBe("reserved");
    expect(() => validateIdempotencyStatus("nope")).toThrow(RecordValidationError);
  });

  it("validates webhook statuses", () => {
    expect(validateWebhookInboxStatus("pending")).toBe("pending");
    expect(() => validateWebhookInboxStatus("reserved")).toThrow(RecordValidationError);
  });

  it("validates reconciliation statuses", () => {
    expect(validateReconciliationStatus("scheduled")).toBe("scheduled");
    expect(() => validateReconciliationStatus("pending")).toThrow(RecordValidationError);
  });
});

describe("lease token / payload hash / timestamps", () => {
  it("rejects empty lease token", () => {
    expect(() => validateLeaseToken("")).toThrow(RecordValidationError);
    expect(() => validateLeaseToken(null)).toThrow(RecordValidationError);
    expect(validateLeaseToken("tok_1")).toBe("tok_1");
  });

  it("requires non-empty payload hash", () => {
    expect(validatePayloadHash("abc")).toBe("abc");
    expect(() => validatePayloadHash("")).toThrow(RecordValidationError);
  });

  it("checks ISO-8601 timestamps", () => {
    expect(isIsoTimestamp("2026-01-15T12:00:00.000Z")).toBe(true);
    expect(isIsoTimestamp("2026-01-15T12:00:00+00:00")).toBe(true);
    expect(isIsoTimestamp("not-a-date")).toBe(false);
    expect(isIsoTimestamp("2026-01-15")).toBe(false);
    expect(validateIsoTimestamp("2026-08-03T00:00:00.000Z", "t")).toBe("2026-08-03T00:00:00.000Z");
  });

  it("validates non-negative ints including string digits", () => {
    expect(validateNonNegativeInt(0, "n")).toBe(0);
    expect(validateNonNegativeInt("3", "n")).toBe(3);
    expect(() => validateNonNegativeInt(-1, "n")).toThrow(RecordValidationError);
    expect(() => validateNonNegativeInt(1.5, "n")).toThrow(RecordValidationError);
  });
});

describe("MAX_SANITIZED_ERROR_LENGTH constant", () => {
  it("is 512 (aligned with webhooks default)", () => {
    expect(MAX_SANITIZED_ERROR_LENGTH).toBe(512);
  });
});
