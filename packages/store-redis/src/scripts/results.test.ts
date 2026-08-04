import { describe, expect, it } from "bun:test";
import {
  IDEMPOTENCY_PACK_LEN,
  parseIdempotencyRecord,
  parseReconciliationRecord,
  parseTaggedResult,
  parseWebhookRecord,
  splitRecordAndToken,
  WEBHOOK_PACK_LEN,
  RECON_PACK_LEN,
} from "./results";

describe("parseTaggedResult", () => {
  it("parses array with tag and fields", () => {
    const r = parseTaggedResult(["acquired", "k", "reserved"]);
    expect(r.tag).toBe("acquired");
    expect(r.fields).toEqual(["k", "reserved"]);
  });

  it("parses single-element tag", () => {
    const r = parseTaggedResult(["lease_lost"]);
    expect(r.tag).toBe("lease_lost");
    expect(r.fields).toEqual([]);
  });

  it("coerces buffer-like and numbers", () => {
    const r = parseTaggedResult(["ok", 42, true as unknown as string]);
    expect(r.tag).toBe("ok");
    expect(r.fields[0]).toBe("42");
  });

  it("throws on empty", () => {
    expect(() => parseTaggedResult(null)).toThrow();
  });
});

describe("parseIdempotencyRecord", () => {
  const fields = [
    "pay_1",
    "reserved",
    "fp",
    "owner",
    "lt_abc",
    "2026-01-01T00:00:30.000Z",
    "1",
    "2",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
    "",
  ];

  it("maps pack fields", () => {
    const rec = parseIdempotencyRecord(fields);
    expect(rec.key).toBe("pay_1");
    expect(rec.status).toBe("reserved");
    expect(rec.fingerprint).toBe("fp");
    expect(rec.leaseOwner).toBe("owner");
    expect(rec.leaseToken).toBe("lt_abc");
    expect(rec.attempts).toBe(1);
    expect(rec.generation).toBe(2);
    expect(rec.result).toBeUndefined();
  });

  it("parses result_json", () => {
    const withResult = [...fields];
    withResult[10] = JSON.stringify({ ok: true });
    const rec = parseIdempotencyRecord(withResult);
    expect(rec.result).toEqual({ ok: true });
  });

  it("omits empty optional lease fields", () => {
    const terminal = [...fields];
    terminal[1] = "completed";
    terminal[3] = "";
    terminal[4] = "";
    terminal[5] = "";
    const rec = parseIdempotencyRecord(terminal);
    expect(rec.leaseToken).toBeUndefined();
    expect(rec.leaseOwner).toBeUndefined();
  });
});

describe("parseWebhookRecord / parseReconciliationRecord", () => {
  it("parses webhook pack", () => {
    const fields = [
      "evt",
      "claimed",
      "hash",
      "ref",
      "w1",
      "tok",
      "2026-01-01T00:01:00.000Z",
      "3",
      "4",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:30.000Z",
      "2026-01-01T00:00:00.000Z",
      "err",
    ];
    expect(fields.length).toBe(WEBHOOK_PACK_LEN);
    const rec = parseWebhookRecord(fields);
    expect(rec.payloadHash).toBe("hash");
    expect(rec.payloadRef).toBe("ref");
    expect(rec.lastError).toBe("err");
    expect(rec.generation).toBe(4);
  });

  it("parses recon pack", () => {
    const fields = [
      "job",
      "scheduled",
      "subj",
      "reason",
      "",
      "",
      "",
      "0",
      "0",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "",
    ];
    expect(fields.length).toBe(RECON_PACK_LEN);
    const rec = parseReconciliationRecord(fields);
    expect(rec.subjectId).toBe("subj");
    expect(rec.reason).toBe("reason");
    expect(rec.leaseToken).toBeUndefined();
  });
});

describe("splitRecordAndToken", () => {
  it("splits trailing token", () => {
    const fields = Array.from({ length: IDEMPOTENCY_PACK_LEN }, (_, i) => `f${i}`);
    fields.push("lt_new");
    const { pack, token } = splitRecordAndToken(fields, IDEMPOTENCY_PACK_LEN);
    expect(pack.length).toBe(IDEMPOTENCY_PACK_LEN);
    expect(token).toBe("lt_new");
  });
});

describe("parseTaggedResult preserves known outcome tags", () => {
  // One scenario: every store script tag must round-trip as the string tag.
  // Catches accidental numeric/boolean coercion of tags at the parser boundary.
  it("round-trips all store script tags without coercion", () => {
    const tags = [
      "acquired",
      "already_completed",
      "in_progress",
      "indeterminate",
      "fingerprint_conflict",
      "payload_hash_conflict",
      "duplicate_failed",
      "not_available",
      "lease_lost",
      "not_found",
      "wrong_status",
      "ok",
      "missing",
      "skipped",
      "deleted",
      "scheduled",
      "already_exists",
      "not_due",
      "already_terminal",
    ];
    for (const tag of tags) {
      expect(parseTaggedResult([tag]).tag).toBe(tag);
      expect(parseTaggedResult([tag]).fields).toEqual([]);
    }
  });
});
