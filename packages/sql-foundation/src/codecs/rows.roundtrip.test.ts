import { describe, expect, it } from "bun:test";
import {
  idempotencyRecordToRow,
  idempotencyRowToRecord,
  migrationRecordToRow,
  migrationRowToRecord,
  reconciliationRecordToRow,
  reconciliationRowToRecord,
  serializeResultJson,
  MAX_RESULT_JSON_BYTES,
  webhookInboxRecordToRow,
  webhookInboxRowToRecord,
} from "./rows";
import {
  sampleIdempotencyRecord,
  sampleReconciliationRecord,
  sampleWebhookRecord,
} from "../fixtures/migration-fixtures";
import { MAX_SANITIZED_ERROR_LENGTH, RecordValidationError } from "./validation";

describe("codec round-trips", () => {
  it("idempotency record ↔ row", () => {
    const original = sampleIdempotencyRecord({
      result: { ok: true, id: "pay_1" },
      tenantId: "t1",
    });
    const row = idempotencyRecordToRow(original);
    expect(row.result_json).toContain("pay_1");
    expect(row.lease_token).toBe(original.leaseToken!);
    const back = idempotencyRowToRecord(row);
    expect(back.key).toBe(original.key);
    expect(back.status).toBe(original.status);
    expect(back.fingerprint).toBe(original.fingerprint);
    expect(back.generation).toBe(original.generation);
    expect(back.result).toEqual({ ok: true, id: "pay_1" });
    expect(back.tenantId).toBe("t1");
  });

  it("SQL-2: serializeResultJson fails closed on oversized money outcome (no truncation)", () => {
    const ok = { ok: true, id: "pay_1" };
    expect(JSON.parse(serializeResultJson(ok)!)).toEqual(ok);
    expect(serializeResultJson(undefined)).toBeNull();
    const huge = { blob: "x".repeat(MAX_RESULT_JSON_BYTES) };
    expect(() => serializeResultJson(huge)).toThrow(RecordValidationError);
    expect(() =>
      idempotencyRecordToRow(
        sampleIdempotencyRecord({
          result: huge,
          status: "completed",
        }),
      ),
    ).toThrow(RecordValidationError);
  });

  it("webhook inbox record ↔ row", () => {
    const original = sampleWebhookRecord({
      gateway: "stripe",
      lastError: "handler timeout",
    });
    const row = webhookInboxRecordToRow(original);
    expect(row.payload_hash).toBe(original.payloadHash);
    expect(row.last_error_sanitized).toBe("handler timeout");
    const back = webhookInboxRowToRecord(row);
    expect(back.payloadHash).toBe(original.payloadHash);
    expect(back.lastError).toBe("handler timeout");
    expect(back.status).toBe("claimed");
    expect(back.availableAt).toBe(original.availableAt);
  });

  it("reconciliation record ↔ row", () => {
    const original = sampleReconciliationRecord({
      status: "claimed",
      leaseToken: "lt",
      leaseOwner: "w",
      leaseExpiresAt: "2026-01-15T12:01:00.000Z",
      generation: 2,
      attempts: 1,
    });
    const row = reconciliationRecordToRow(original);
    expect(row.subject_id).toBe("pay_123");
    expect(row.due_at).toBe(original.dueAt);
    const back = reconciliationRowToRecord(row);
    expect(back.subjectId).toBe(original.subjectId);
    expect(back.generation).toBe(2);
    expect(back.leaseToken).toBe("lt");
  });

  it("migration record ↔ row", () => {
    const original = {
      version: 1,
      name: "create_payment_storage_foundation",
      appliedAt: "2026-01-15T12:00:00.000Z",
      checksum: "v1_foundation",
    };
    const row = migrationRecordToRow(original);
    const back = migrationRowToRecord(row);
    expect(back).toEqual(original);
  });

  it("enforces error field max size on encode", () => {
    const long = "e".repeat(MAX_SANITIZED_ERROR_LENGTH + 100);
    const row = webhookInboxRecordToRow(sampleWebhookRecord({ lastError: long }));
    expect(row.last_error_sanitized!.length).toBe(MAX_SANITIZED_ERROR_LENGTH);
  });
});
