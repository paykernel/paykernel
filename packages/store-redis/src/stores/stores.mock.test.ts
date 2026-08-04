/**
 * Store method wiring via mock RedisCommandPort (canned EVAL results).
 * No live Redis required.
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import { StoreLeaseLostError } from "@paykernel/store-contracts";
import { createRedisIdempotencyStore } from "./idempotency-store";
import { createRedisWebhookInboxStore } from "./webhook-inbox-store";
import { createRedisReconciliationStore } from "./reconciliation-store";
import type { RedisCommandPort } from "../port";

type SendCall = { command: string; args: readonly string[] };

function createMockPort(handler: (call: SendCall) => unknown): {
  port: RedisCommandPort;
  calls: SendCall[];
} {
  const calls: SendCall[] = [];
  const port: RedisCommandPort = {
    async send(command, args) {
      const call = { command: command.toUpperCase(), args };
      calls.push(call);
      // SCRIPT LOAD returns a fake sha
      if (call.command === "SCRIPT" && args[0] === "LOAD") {
        return "deadbeefsha";
      }
      return handler(call);
    },
  };
  return { port, calls };
}

function idempPack(overrides: Partial<Record<string, string>> = {}): string[] {
  const base = {
    key: "k1",
    status: "reserved",
    fingerprint: "fp",
    lease_owner: "w1",
    lease_token: "lt_1",
    lease_expires_at: "2099-01-01T00:00:00.000Z",
    attempts: "1",
    generation: "1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    result_json: "",
  };
  const m = { ...base, ...overrides };
  return [
    m.key,
    m.status,
    m.fingerprint,
    m.lease_owner,
    m.lease_token,
    m.lease_expires_at,
    m.attempts,
    m.generation,
    m.created_at,
    m.updated_at,
    m.result_json,
  ];
}

describe("idempotency store mock port", () => {
  it("reserve acquired maps tagged result", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const pack = idempPack();
    const { port } = createMockPort((call) => {
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        return ["acquired", ...pack, "lt_1"];
      }
      return null;
    });
    const store = createRedisIdempotencyStore({ port, clock });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 30_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind === "acquired") {
      expect(r.leaseToken).toBe("lt_1");
      expect(r.record.generation).toBe(1);
    }
  });

  it("reserve indeterminate", async () => {
    const pack = idempPack({ status: "indeterminate", lease_token: "", lease_owner: "" });
    const { port } = createMockPort(() => ["indeterminate", ...pack]);
    const store = createRedisIdempotencyStore({ port });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("indeterminate");
  });

  it("complete lease_lost throws StoreLeaseLostError", async () => {
    const { port } = createMockPort(() => ["lease_lost"]);
    const store = createRedisIdempotencyStore({ port });
    await expect(
      store.complete({ key: "k1", leaseToken: "bad", result: { ok: 1 } }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("renew ok rotates token", async () => {
    const pack = idempPack({ lease_token: "lt_2", generation: "2" });
    const { port } = createMockPort(() => ["ok", ...pack, "lt_2"]);
    const store = createRedisIdempotencyStore({ port });
    const r = await store.renew({
      key: "k1",
      leaseToken: "lt_1",
      leaseMs: 5000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.leaseToken).toBe("lt_2");
  });

  it("passes nowMs ARGV into scripts", async () => {
    const clock = createFakeClock(new Date("2026-06-15T12:00:00.000Z"));
    const { port, calls } = createMockPort(() => {
      const pack = idempPack();
      return ["acquired", ...pack, "lt_1"];
    });
    const store = createRedisIdempotencyStore({ port, clock });
    await store.reserve({
      key: "k1",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 1000,
    });
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    // EVALSHA sha numkeys key nowMs nowIso ...
    // or EVAL script numkeys key nowMs ...
    const args = evalCall!.args;
    const nowMs = String(clock.nowMs());
    expect(args.some((a) => a === nowMs)).toBe(true);
  });
});

function webhookPack(overrides: Partial<Record<string, string>> = {}): string[] {
  const base = {
    key: "e1",
    status: "pending",
    payload_hash: "h1",
    payload_ref: "",
    lease_owner: "",
    lease_token: "",
    lease_expires_at: "",
    attempts: "1",
    generation: "1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    available_at: "2026-01-01T00:05:00.000Z",
    last_error: "retry later",
  };
  const m = { ...base, ...overrides };
  return [
    m.key,
    m.status,
    m.payload_hash,
    m.payload_ref,
    m.lease_owner,
    m.lease_token,
    m.lease_expires_at,
    m.attempts,
    m.generation,
    m.created_at,
    m.updated_at,
    m.available_at,
    m.last_error,
  ];
}

describe("webhook store mock port", () => {
  it("claim payload_hash_conflict", async () => {
    const fields = webhookPack({
      status: "claimed",
      payload_hash: "other",
      lease_owner: "w",
      lease_token: "t",
      lease_expires_at: "2099-01-01T00:00:00.000Z",
      available_at: "2026-01-01T00:00:00.000Z",
      last_error: "",
    });
    const { port } = createMockPort(() => ["payload_hash_conflict", ...fields]);
    const store = createRedisWebhookInboxStore({ port });
    const r = await store.claim({
      key: "e1",
      payloadHash: "mine",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("payload_hash_conflict");
  });

  it("claim not_available maps tagged result (availableAt backoff)", async () => {
    const fields = webhookPack();
    const { port } = createMockPort(() => ["not_available", ...fields]);
    const store = createRedisWebhookInboxStore({ port });
    const r = await store.claim({
      key: "e1",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("not_available");
    expect(r.record.key).toBe("e1");
    expect(r.record.status).toBe("pending");
    expect(r.record.availableAt).toBe("2026-01-01T00:05:00.000Z");
    if (r.kind === "not_available") {
      expect(r.availableAt).toBe("2026-01-01T00:05:00.000Z");
    }
  });

  it("fail lease_lost (expired lease) throws StoreLeaseLostError", async () => {
    const { port } = createMockPort(() => ["lease_lost"]);
    const store = createRedisWebhookInboxStore({ port });
    await expect(
      store.fail({
        key: "e1",
        leaseToken: "stale-or-expired",
        error: "handler_error",
        retryAfterMs: 1000,
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });
});

describe("reconciliation store mock port", () => {
  it("schedule already_exists", async () => {
    const fields = [
      "j1",
      "scheduled",
      "subj",
      "r",
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
    const { port } = createMockPort(() => ["already_exists", ...fields]);
    const store = createRedisReconciliationStore({ port });
    const r = await store.schedule({
      key: "j1",
      subjectId: "subj",
      reason: "r",
      dueAt: "2026-01-01T00:00:00.000Z",
    });
    expect(r.kind).toBe("already_exists");
  });

  it("claim not_found", async () => {
    const { port } = createMockPort(() => ["not_found"]);
    const store = createRedisReconciliationStore({ port });
    const r = await store.claim({ key: "missing", owner: "w", leaseMs: 1000 });
    expect(r.kind).toBe("not_found");
  });

  it("fail lease_lost (expired lease) throws StoreLeaseLostError", async () => {
    const { port } = createMockPort(() => ["lease_lost"]);
    const store = createRedisReconciliationStore({ port });
    await expect(
      store.fail({
        key: "j1",
        leaseToken: "stale-or-expired",
        error: "handler_error",
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("markManualReview lease_lost (expired lease) throws StoreLeaseLostError", async () => {
    const { port } = createMockPort(() => ["lease_lost"]);
    const store = createRedisReconciliationStore({ port });
    await expect(
      store.markManualReview({
        key: "j1",
        leaseToken: "stale-or-expired",
        note: "needs_review",
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });
});
