/**
 * Unit tests for Phase 9 store contracts: error taxonomy, interface surface (§9.1),
 * claimable record fields (§9.2), and lease-lost detection (§9.3–§9.4).
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "../memory/fake-clock";
import {
  createMemoryIdempotencyStore,
  createMemoryReconciliationStore,
  createMemoryWebhookInboxStore,
} from "../memory/memory-stores";
import {
  STORE_ERROR_CODES,
  StoreConflictError,
  StoreCorruptedRecordError,
  StoreError,
  StoreInvalidSchemaError,
  StoreLeaseLostError,
  StorePayloadHashConflictError,
  StoreSerializationFailureError,
  StoreTimeoutError,
  StoreUnavailableError,
  StoreUnsupportedFeatureError,
  isStoreLeaseLostError,
  type IdempotencyStore,
  type ReconciliationStore,
  type StoreErrorCode,
  type WebhookInboxStore,
} from "./contracts";

describe("StoreErrorCode taxonomy (§9.4)", () => {
  it("lists every roadmap code once plus payload_hash_conflict", () => {
    const required: StoreErrorCode[] = [
      "unavailable",
      "conflict",
      "lease_lost",
      "timeout",
      "serialization_failure",
      "invalid_schema",
      "unsupported_feature",
      "corrupted_record",
      "payload_hash_conflict",
    ];
    for (const code of required) {
      expect(STORE_ERROR_CODES).toContain(code);
    }
    expect(STORE_ERROR_CODES.length).toBe(required.length);
    expect(new Set(STORE_ERROR_CODES).size).toBe(STORE_ERROR_CODES.length);
  });

  it("subclasses map to stable code and retryability defaults", () => {
    const cases: Array<[StoreError, StoreErrorCode, boolean]> = [
      [new StoreUnavailableError(), "unavailable", true],
      [new StoreConflictError(), "conflict", false],
      [new StoreLeaseLostError(), "lease_lost", false],
      [new StoreTimeoutError(), "timeout", true],
      [new StoreSerializationFailureError(), "serialization_failure", true],
      [new StoreInvalidSchemaError(), "invalid_schema", false],
      [new StoreUnsupportedFeatureError(), "unsupported_feature", false],
      [new StoreCorruptedRecordError(), "corrupted_record", false],
      [new StorePayloadHashConflictError(), "payload_hash_conflict", false],
    ];
    for (const [err, code, retryable] of cases) {
      expect(err).toBeInstanceOf(StoreError);
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
      expect(err.message.length).toBeGreaterThan(0);
      // Default messages must not look like secret dumps
      expect(err.message).not.toMatch(/sk_live|Bearer |-----BEGIN/i);
    }
  });

  it("isStoreLeaseLostError accepts subclass and plain StoreError lease_lost", () => {
    expect(isStoreLeaseLostError(new StoreLeaseLostError())).toBe(true);
    expect(isStoreLeaseLostError(new StoreError("lease_lost", "stale"))).toBe(
      true,
    );
    expect(isStoreLeaseLostError(new StoreConflictError())).toBe(false);
    expect(isStoreLeaseLostError(new Error("lease lost"))).toBe(false);
    expect(isStoreLeaseLostError(null)).toBe(false);
  });
});

/** Runtime method names required by roadmap §9.1 (three separate interfaces). */
const IDEMPOTENCY_METHODS = [
  "reserve",
  "renew",
  "complete",
  "markIndeterminate",
  "get",
  "deleteExpired",
] as const satisfies readonly (keyof IdempotencyStore)[];

const WEBHOOK_INBOX_METHODS = [
  "claim",
  "renew",
  "complete",
  "fail",
  "get",
  "listRetryable",
  "deleteExpired",
] as const satisfies readonly (keyof WebhookInboxStore)[];

const RECONCILIATION_METHODS = [
  "schedule",
  "claim",
  "renew",
  "complete",
  "fail",
  "markManualReview",
  "get",
  "listDue",
  "deleteExpired",
] as const satisfies readonly (keyof ReconciliationStore)[];

function assertMethods(
  store: object,
  methods: readonly string[],
  label: string,
): void {
  for (const methodName of methods) {
    expect(
      typeof (store as Record<string, unknown>)[methodName],
      `${label}.${methodName}`,
    ).toBe("function");
  }
}

function expectAcquired<T extends { kind: string }>(
  result: T,
  label: string,
): asserts result is T & { kind: "acquired" } {
  expect(result.kind, label).toBe("acquired");
  if (result.kind !== "acquired") {
    throw new Error(`${label}: expected acquired, got ${result.kind}`);
  }
}

describe("store interface surface (§9.1)", () => {
  // Compile-time: method name lists use `satisfies keyof Store`.
  // Runtime: factories must expose those methods (not a partial object).
  it.each([
    [
      "IdempotencyStore",
      () => createMemoryIdempotencyStore({ clock: createFakeClock() }),
      IDEMPOTENCY_METHODS,
    ],
    [
      "WebhookInboxStore",
      () => createMemoryWebhookInboxStore({ clock: createFakeClock() }),
      WEBHOOK_INBOX_METHODS,
    ],
    [
      "ReconciliationStore",
      () => createMemoryReconciliationStore({ clock: createFakeClock() }),
      RECONCILIATION_METHODS,
    ],
  ] as const)("%s factory exposes roadmap methods", (label, create, methods) => {
    assertMethods(create(), methods, label);
  });

  it("post-reserve mutators reject wrong leaseToken (complete/markIndeterminate/renew)", async () => {
    const clock = createFakeClock();
    const idemp = createMemoryIdempotencyStore({ clock });
    const reserved = await idemp.reserve({
      key: "surf_token",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    expectAcquired(reserved, "reserve");

    await expect(
      idemp.complete({
        key: "surf_token",
        leaseToken: "wrong-token",
        result: {},
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);

    await expect(
      idemp.markIndeterminate({
        key: "surf_token",
        leaseToken: "wrong-token",
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);

    const badRenew = await idemp.renew({
      key: "surf_token",
      leaseToken: "wrong-token",
      leaseMs: 5_000,
    });
    expect(badRenew).toEqual({ ok: false, reason: "lease_lost" });
  });
});

describe("claimable record fields (§9.2)", () => {
  it("idempotency acquire yields key/status/lease*/attempts/timestamps/generation/fingerprint", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const reserved = await store.reserve({
      key: "rec_fields",
      fingerprint: "fp-1",
      owner: "worker-a",
      leaseMs: 5_000,
    });
    expectAcquired(reserved, "reserve");
    const rec = reserved.record;
    expect(rec.key).toBe("rec_fields");
    expect(rec.status).toBe("reserved");
    expect(rec.fingerprint).toBe("fp-1");
    expect(rec.leaseOwner).toBe("worker-a");
    expect(typeof rec.leaseToken).toBe("string");
    expect(rec.leaseToken!.length).toBeGreaterThan(0);
    expect(typeof rec.leaseExpiresAt).toBe("string");
    expect(rec.attempts).toBe(1);
    expect(typeof rec.createdAt).toBe("string");
    expect(typeof rec.updatedAt).toBe("string");
    expect(typeof rec.generation).toBe("number");
    expect(rec.generation).toBeGreaterThanOrEqual(1);
    expect(reserved.leaseToken).toBe(rec.leaseToken);
  });

  it("webhook claim yields payloadHash/availableAt plus shared lease fields", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const claimed = await store.claim({
      key: "evt_fields",
      payloadHash: "hash-a",
      owner: "worker-b",
      leaseMs: 5_000,
    });
    expectAcquired(claimed, "claim");
    const rec = claimed.record;
    expect(rec.key).toBe("evt_fields");
    expect(rec.status).toBe("claimed");
    expect(rec.payloadHash).toBe("hash-a");
    expect(rec.leaseOwner).toBe("worker-b");
    expect(typeof rec.leaseToken).toBe("string");
    expect(typeof rec.leaseExpiresAt).toBe("string");
    expect(rec.attempts).toBeGreaterThanOrEqual(1);
    expect(typeof rec.createdAt).toBe("string");
    expect(typeof rec.updatedAt).toBe("string");
    expect(typeof rec.availableAt).toBe("string");
    expect(typeof rec.generation).toBe("number");
    expect(rec.generation).toBeGreaterThanOrEqual(1);
  });

  it("reconciliation claim yields subjectId/reason/dueAt plus shared lease fields", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const dueAt = clock.nowIso();
    await store.schedule({
      key: "recon_fields",
      subjectId: "pay_xyz",
      reason: "network_timeout",
      dueAt,
    });
    const claimed = await store.claim({
      key: "recon_fields",
      owner: "worker-c",
      leaseMs: 5_000,
    });
    expectAcquired(claimed, "claim");
    const rec = claimed.record;
    expect(rec.key).toBe("recon_fields");
    expect(rec.status).toBe("claimed");
    expect(rec.subjectId).toBe("pay_xyz");
    expect(rec.reason).toBe("network_timeout");
    expect(rec.dueAt).toBe(dueAt);
    expect(rec.leaseOwner).toBe("worker-c");
    expect(typeof rec.leaseToken).toBe("string");
    expect(typeof rec.leaseExpiresAt).toBe("string");
    expect(rec.attempts).toBeGreaterThanOrEqual(1);
    expect(typeof rec.createdAt).toBe("string");
    expect(typeof rec.updatedAt).toBe("string");
    expect(typeof rec.generation).toBe("number");
    expect(rec.generation).toBeGreaterThanOrEqual(1);
  });
});
