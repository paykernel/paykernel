/**
 * Store method wiring via mock RedisCommandPort (canned EVAL results).
 * No live Redis required.
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import {
  StoreInvalidSchemaError,
  StoreLeaseLostError,
  StoreSerializationFailureError,
} from "@paykernel/store-contracts";
import { createRedisIdempotencyStore } from "./idempotency-store";
import { createRedisWebhookInboxStore } from "./webhook-inbox-store";
import { createRedisReconciliationStore } from "./reconciliation-store";
import type { RedisCommandPort } from "../port";
import {
  enforceMaxSanitizedError,
  MAX_RESULT_JSON_BYTES,
  MAX_SANITIZED_ERROR_LENGTH,
} from "../limits";
import { canonicalizeIsoZ, msFromIso, serializeResultJson } from "./shared";
import { DEFAULT_DELETE_EXPIRED_LIMIT } from "../limits";

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

  it("P1315-REDIS-4: completed + other fingerprint => already_completed", async () => {
    const pack = idempPack({ status: "completed", fingerprint: "other" });
    const { port } = createMockPort(() => ["already_completed", ...pack]);
    const store = createRedisIdempotencyStore({ port });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp-caller",
      owner: "w1",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("already_completed");
    if (r.kind === "already_completed") {
      expect(r.record.fingerprint).toBe("other");
    }
  });

  it("P1315-REDIS-4: indeterminate + other fingerprint => indeterminate", async () => {
    const pack = idempPack({
      status: "indeterminate",
      fingerprint: "other",
      lease_token: "",
      lease_owner: "",
    });
    const { port } = createMockPort(() => ["indeterminate", ...pack]);
    const store = createRedisIdempotencyStore({ port });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp-caller",
      owner: "w1",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("indeterminate");
    if (r.kind === "indeterminate") {
      expect(r.record.fingerprint).toBe("other");
    }
  });

  it("complete lease_lost throws StoreLeaseLostError", async () => {
    const { port } = createMockPort(() => ["lease_lost"]);
    const store = createRedisIdempotencyStore({ port });
    await expect(
      store.complete({ key: "k1", leaseToken: "bad", result: { ok: 1 } }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("complete with retentionTtlMs still invokes complete script (REDIS-1 fence)", async () => {
    // retentionTtlMs must not strip the completed fence: script ignores EXPIRE.
    // Call-site still passes retention ARGV for parity; Lua PERSIST+no-EXPIRE is the fix.
    let completeArgv: readonly string[] | undefined;
    const { port } = createMockPort((call) => {
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        // ARGV follow KEYS; find result script args after numkeys
        completeArgv = call.args;
        return ["ok"];
      }
      return null;
    });
    const store = createRedisIdempotencyStore({
      port,
      retentionTtlMs: 7 * 24 * 60 * 60 * 1000,
    });
    await store.complete({ key: "k1", leaseToken: "lt_1", result: { paid: true } });
    expect(completeArgv).toBeDefined();
    // retention seconds still forwarded (call-site parity) but must be non-zero so
    // we prove the footgun path is exercised without EXPIRE in the script body.
    const argv = completeArgv ?? [];
    expect(argv.some((a) => a === "604800" || a === String(7 * 24 * 60 * 60))).toBe(
      true,
    );
  });

  it("complete fails closed on oversized result (no truncation marker)", async () => {
    let evalCount = 0;
    const { port } = createMockPort(() => {
      evalCount++;
      return ["ok"];
    });
    const store = createRedisIdempotencyStore({ port });
    const huge = { blob: "x".repeat(MAX_RESULT_JSON_BYTES) };
    await expect(
      store.complete({ key: "k1", leaseToken: "lt_1", result: huge }),
    ).rejects.toBeInstanceOf(StoreSerializationFailureError);
    // Must not reach EVAL/complete with truncated money outcome
    expect(evalCount).toBe(0);
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

  it("markIndeterminate sanitizes and caps reason before serialize (SQL parity)", async () => {
    const { port, calls } = createMockPort(() => ["ok"]);
    const store = createRedisIdempotencyStore({ port });
    const longSecret =
      "token=super-secret-value-that-must-not-persist " + "x".repeat(600);
    await store.markIndeterminate({
      key: "k1",
      leaseToken: "lt_1",
      reason: longSecret,
    });
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    const expected = enforceMaxSanitizedError(longSecret);
    expect(expected).toBeDefined();
    expect(expected!.length).toBeLessThanOrEqual(MAX_SANITIZED_ERROR_LENGTH);
    expect(expected).toContain("token=***");
    expect(expected).not.toContain("super-secret-value-that-must-not-persist");
    // resultJson ARGV must use sanitized reason (not raw)
    const resultJsonArg = evalCall!.args.find((a) => a.startsWith("{") && a.includes("reason"));
    expect(resultJsonArg).toBeDefined();
    const parsed = JSON.parse(resultJsonArg!) as { reason: string };
    expect(parsed.reason).toBe(expected);
    expect(parsed.reason.length).toBeLessThanOrEqual(MAX_SANITIZED_ERROR_LENGTH);
  });

  it("markIndeterminate omits resultJson when reason sanitizes empty", async () => {
    const { port, calls } = createMockPort(() => ["ok"]);
    const store = createRedisIdempotencyStore({ port });
    await store.markIndeterminate({
      key: "k1",
      leaseToken: "lt_1",
      reason: "   ",
    });
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    // Empty sanitized reason → empty resultJson ARGV (last arg after lease token)
    const args = evalCall!.args;
    // EVAL[SHA] script/sha numkeys key nowMs nowIso leaseToken resultJson
    expect(args[args.length - 1]).toBe("");
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

  it("P1315-REDIS-3: webhook fail dead_letter with retentionTtlMs still invokes fail script", async () => {
    let failArgv: readonly string[] | undefined;
    const { port } = createMockPort((call) => {
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        failArgv = call.args;
        return ["ok"];
      }
      return null;
    });
    const store = createRedisWebhookInboxStore({
      port,
      retentionTtlMs: 7 * 24 * 60 * 60 * 1000,
    });
    await store.fail({
      key: "e1",
      leaseToken: "lt_1",
      error: "poison",
      deadLetter: true,
    });
    expect(failArgv).toBeDefined();
    expect(failArgv!.some((a) => a === "604800")).toBe(true);
  });

  it("REDIS-1: webhook renew EVAL includes retry index key for ZSET rescore", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const { port, calls } = createMockPort(() => [
      "ok",
      ...webhookPack({ status: "claimed", attempts: "1", lease_token: "lt_2" }),
      "lt_2",
    ]);
    const store = createRedisWebhookInboxStore({ port, clock });
    const r = await store.renew({ key: "e1", leaseToken: "lt_1", leaseMs: 15_000 });
    expect(r.ok).toBe(true);
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    expect(evalCall!.args.some((a) => String(a).endsWith(":whinbox:retry"))).toBe(
      true,
    );
    expect(evalCall!.args.some((a) => a === String(clock.nowMs() + 15_000))).toBe(
      true,
    );
  });

  it("PERF-1: listRetryable uses ZRANGEBYSCORE and does not SCAN", async () => {
    const { port, calls } = createMockPort((call) => {
      if (call.command === "ZRANGEBYSCORE") return ["e1"];
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        return ["ok", ...webhookPack({ status: "pending", attempts: "0" })];
      }
      return null;
    });
    const store = createRedisWebhookInboxStore({ port });
    const listed = await store.listRetryable({ limit: 10 });
    expect(listed.map((r) => r.key)).toContain("e1");
    expect(calls.some((c) => c.command === "ZRANGEBYSCORE")).toBe(true);
    expect(calls.some((c) => c.command === "SCAN")).toBe(false);
  });

  it("P1315-REDIS-2: webhook claim EVAL ARGV includes leaseExpiresMs", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const leaseMs = 15_000;
    const { port, calls } = createMockPort(() => [
      "acquired",
      ...webhookPack({ status: "claimed", attempts: "1" }),
      "lt_1",
    ]);
    const store = createRedisWebhookInboxStore({ port, clock });
    await store.claim({
      key: "e1",
      payloadHash: "h1",
      owner: "w",
      leaseMs,
    });
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall!.args.some((a) => a === String(clock.nowMs() + leaseMs))).toBe(
      true,
    );
  });
});

function reconPack(overrides: Partial<Record<string, string>> = {}): string[] {
  const base = {
    key: "j1",
    status: "scheduled",
    subject_id: "subj",
    reason: "r",
    lease_owner: "",
    lease_token: "",
    lease_expires_at: "",
    attempts: "0",
    generation: "0",
    due_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_error: "",
  };
  const m = { ...base, ...overrides };
  return [
    m.key,
    m.status,
    m.subject_id,
    m.reason,
    m.lease_owner,
    m.lease_token,
    m.lease_expires_at,
    m.attempts,
    m.generation,
    m.due_at,
    m.created_at,
    m.updated_at,
    m.last_error,
  ];
}

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

  it("P1315-REDIS-1: reclaim after lease expiry keeps attempts; listDue soft-release then scheduled reclaim nets to original", async () => {
    // Store-visible sequence (Lua contracts in registry.test.ts):
    // scheduled claim → attempts=1; get/listDue soft-release → 0; scheduled reclaim → 1.
    // Direct expired-claimed reclaim (no soft-release) stays at 1.
    const clock = createFakeClock(new Date("2026-01-01T00:00:00.000Z"));
    let phase: "claim1" | "list" | "claim2" | "reclaim" = "claim1";
    const { port } = createMockPort((call) => {
      if (call.command === "ZRANGEBYSCORE") return ["j1"];
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        if (phase === "claim1") {
          return ["acquired", ...reconPack({ status: "claimed", attempts: "1" }), "lt_1"];
        }
        if (phase === "list") {
          return ["ok", ...reconPack({ status: "scheduled", attempts: "0" })];
        }
        if (phase === "claim2") {
          return ["acquired", ...reconPack({ status: "claimed", attempts: "1" }), "lt_2"];
        }
        return ["acquired", ...reconPack({ status: "claimed", attempts: "1" }), "lt_3"];
      }
      return null;
    });
    const store = createRedisReconciliationStore({ port, clock });
    const c1 = await store.claim({ key: "j1", owner: "w_dead", leaseMs: 1_000 });
    expect(c1.kind).toBe("acquired");
    if (c1.kind !== "acquired") return;
    expect(c1.record.attempts).toBe(1);

    phase = "list";
    clock.advance(2_000);
    const due = await store.listDue({ limit: 10 });
    const soft = due.find((r) => r.key === "j1");
    expect(soft?.status).toBe("scheduled");
    expect(soft?.attempts).toBe(0);

    phase = "claim2";
    const c2 = await store.claim({ key: "j1", owner: "w_new", leaseMs: 1_000 });
    expect(c2.kind).toBe("acquired");
    if (c2.kind !== "acquired") return;
    expect(c2.record.attempts).toBe(1);

    phase = "reclaim";
    const c3 = await store.claim({ key: "j1", owner: "w3", leaseMs: 5_000 });
    expect(c3.kind).toBe("acquired");
    if (c3.kind === "acquired") {
      expect(c3.record.attempts).toBe(1);
    }
  });

  it("P1315-REDIS-2: claim EVAL ARGV includes leaseExpiresMs (index scored at lease expiry)", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const leaseMs = 30_000;
    const { port, calls } = createMockPort(() => [
      "acquired",
      ...reconPack({ status: "claimed", attempts: "1" }),
      "lt_1",
    ]);
    const store = createRedisReconciliationStore({ port, clock });
    await store.claim({ key: "j1", owner: "w", leaseMs });
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    expect(evalCall!.args.some((a) => a === String(clock.nowMs() + leaseMs))).toBe(
      true,
    );
  });

  it("PERF-1 / PERF-4: listDue rediscovers via ZRANGEBYSCORE without SCAN", async () => {
    const { port, calls } = createMockPort((call) => {
      if (call.command === "ZRANGEBYSCORE") return ["j1", "j2"];
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        const key = String(call.args.find((a) => String(a).includes("j2")) ?? "j1");
        const logical = key.endsWith("j2") ? "j2" : "j1";
        return ["ok", ...reconPack({ key: logical, status: "scheduled", attempts: "0" })];
      }
      return null;
    });
    const store = createRedisReconciliationStore({ port });
    const due = await store.listDue({ limit: 10 });
    expect(due.map((r) => r.key)).toEqual(expect.arrayContaining(["j1", "j2"]));
    expect(calls.some((c) => c.command === "ZRANGEBYSCORE")).toBe(true);
    expect(calls.some((c) => c.command === "SCAN")).toBe(false);
    const evals = calls.filter((c) => c.command === "EVAL" || c.command === "EVALSHA");
    expect(evals.length).toBe(2);
  });

  it("REDIS-1: renew EVAL includes due index key for ZSET rescore", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const { port, calls } = createMockPort(() => [
      "ok",
      ...reconPack({ status: "claimed", attempts: "1", lease_token: "lt_2" }),
      "lt_2",
    ]);
    const store = createRedisReconciliationStore({ port, clock });
    const r = await store.renew({ key: "j1", leaseToken: "lt_1", leaseMs: 30_000 });
    expect(r.ok).toBe(true);
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    expect(evalCall!.args.some((a) => String(a).endsWith(":recon:due"))).toBe(
      true,
    );
    expect(evalCall!.args.some((a) => a === String(clock.nowMs() + 30_000))).toBe(
      true,
    );
  });

  it("P1315-REDIS-3: recon terminal fail / markManualReview with retention still invoke scripts", async () => {
    let failArgv: readonly string[] | undefined;
    let markArgv: readonly string[] | undefined;
    const { port } = createMockPort((call) => {
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        if (failArgv === undefined) {
          failArgv = call.args;
        } else {
          markArgv = call.args;
        }
        return ["ok"];
      }
      return null;
    });
    const store = createRedisReconciliationStore({
      port,
      retentionTtlMs: 7 * 24 * 60 * 60 * 1000,
    });
    await store.fail({
      key: "j1",
      leaseToken: "lt_1",
      error: "terminal",
    });
    await store.markManualReview({
      key: "j1",
      leaseToken: "lt_1",
      note: "review",
    });
    expect(failArgv?.some((a) => a === "604800")).toBe(true);
    expect(markArgv?.some((a) => a === "604800")).toBe(true);
  });
});

describe("serializeResultJson / msFromIso honesty (audit REDIS-1 / REDIS-2)", () => {
  it("serializeResultJson rejects oversized payloads instead of truncating", () => {
    const ok = { status: "paid", amount: "10.00" };
    expect(JSON.parse(serializeResultJson(ok))).toEqual(ok);

    const huge = { blob: "y".repeat(MAX_RESULT_JSON_BYTES) };
    expect(() => serializeResultJson(huge)).toThrow(StoreSerializationFailureError);
    try {
      serializeResultJson(huge);
    } catch (err) {
      expect(err).toBeInstanceOf(StoreSerializationFailureError);
      const msg = (err as Error).message.toLowerCase();
      expect(msg).toContain("max_result_json_bytes");
      expect(msg).not.toContain("_truncated");
    }
  });

  it("canonicalizeIsoZ maps offset forms to Date ISO Z", () => {
    expect(canonicalizeIsoZ("2026-06-15T13:00:00.000+05:00")).toBe(
      "2026-06-15T08:00:00.000Z",
    );
    expect(() => canonicalizeIsoZ("not-a-date")).toThrow(StoreInvalidSchemaError);
    expect(() => canonicalizeIsoZ("")).toThrow(StoreInvalidSchemaError);
  });

  it("msFromIso fails closed on invalid ISO (never due_ms 0 / epoch)", () => {
    expect(msFromIso("2026-01-01T00:00:00.000Z")).toBe(
      String(Date.parse("2026-01-01T00:00:00.000Z")),
    );
    expect(() => msFromIso("not-a-date")).toThrow(StoreInvalidSchemaError);
    expect(() => msFromIso("")).toThrow(StoreInvalidSchemaError);
    expect(() => msFromIso("not-a-date")).toThrow(/invalid ISO/i);
  });

  it("recon schedule rejects invalid dueAt before EVAL", async () => {
    let evalCount = 0;
    const { port } = createMockPort(() => {
      evalCount++;
      return ["scheduled"];
    });
    const store = createRedisReconciliationStore({ port });
    await expect(
      store.schedule({
        key: "job1",
        subjectId: "pay_1",
        reason: "check",
        dueAt: "totally-invalid",
      }),
    ).rejects.toBeInstanceOf(StoreInvalidSchemaError);
    expect(evalCount).toBe(0);
  });

  it("recon fail rejects invalid retryAt before EVAL", async () => {
    let evalCount = 0;
    const { port } = createMockPort(() => {
      evalCount++;
      return ["ok"];
    });
    const store = createRedisReconciliationStore({ port });
    await expect(
      store.fail({
        key: "job1",
        leaseToken: "lt_1",
        error: "boom",
        retryAt: "nope",
      }),
    ).rejects.toBeInstanceOf(StoreInvalidSchemaError);
    expect(evalCount).toBe(0);
  });

  it("STORES-4: listDue / listRetryable reject invalid input.now (no NaN scores)", async () => {
    let sendCount = 0;
    const { port } = createMockPort(() => {
      sendCount++;
      return null;
    });
    const recon = createRedisReconciliationStore({ port });
    const webhook = createRedisWebhookInboxStore({ port });
    await expect(recon.listDue({ now: "not-a-date" })).rejects.toBeInstanceOf(
      StoreInvalidSchemaError,
    );
    await expect(
      webhook.listRetryable({ now: "not-a-date" }),
    ).rejects.toBeInstanceOf(StoreInvalidSchemaError);
    // Fail before SCAN/ZRANGE — never emit NaN score commands.
    expect(sendCount).toBe(0);
  });
});

describe("deleteExpired composite logical keys (REDIS-1)", () => {
  it("webhook deleteExpired passes full gateway:eventId as Lua ARGV logicalKey", async () => {
    const composite = "stripe:evt_abc";
    const redisKey = `psdk:v1:whinbox:${composite}`;
    const { port, calls } = createMockPort((call) => {
      if (call.command === "SCAN") {
        return ["0", [redisKey]];
      }
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        return ["deleted"];
      }
      return null;
    });
    const store = createRedisWebhookInboxStore({ port });
    const result = await store.deleteExpired({
      before: "2099-01-01T00:00:00.000Z",
    });
    expect(result.deleted).toBe(1);
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    // EVAL sha numkeys key1 key2 beforeIso logicalKey
    // After SCRIPT LOAD path uses EVALSHA: sha, 2, record, index, before, logical
    const args = evalCall!.args.map(String);
    expect(args).toContain(composite);
    expect(args).not.toContain("evt_abc"); // bare pop fragment must not be used alone without gateway
    // Stronger: last ARGV is logical key
    expect(args[args.length - 1]).toBe(composite);
  });

  it("recon deleteExpired passes full composite logical key", async () => {
    const composite = "tenant:job:1";
    const redisKey = `psdk:v1:recon:${composite}`;
    const { port, calls } = createMockPort((call) => {
      if (call.command === "SCAN") {
        return ["0", [redisKey]];
      }
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        return ["deleted"];
      }
      return null;
    });
    const store = createRedisReconciliationStore({ port });
    const result = await store.deleteExpired({
      before: "2099-01-01T00:00:00.000Z",
    });
    expect(result.deleted).toBe(1);
    const evalCall = calls.find(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCall).toBeDefined();
    const args = evalCall!.args.map(String);
    expect(args[args.length - 1]).toBe(composite);
  });

  it("P1315-REDIS-5: offset before does not delete a later Z updated_at", async () => {
    // updated_at 12:00Z; offset before 13:00+05:00 = 08:00Z (earlier instant).
    // Lexical without canonicalize: T12 < T13 → would delete. Must skip.
    const updatedAt = "2026-06-15T12:00:00.000Z";
    const beforeOffset = "2026-06-15T13:00:00.000+05:00";
    expect(updatedAt > beforeOffset).toBe(false);
    expect(updatedAt > canonicalizeIsoZ(beforeOffset)).toBe(true);

    let luaBefore: string | undefined;
    const { port } = createMockPort((call) => {
      if (call.command === "SCAN") {
        return ["0", ["psdk:v1:idemp:k-later"]];
      }
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        const args = call.args.map(String);
        luaBefore = args.find((a) => a.endsWith("Z") && a.startsWith("2026-"));
        // Simulate Lua lexical compare of stored Z vs ARGV beforeIso.
        return updatedAt > (luaBefore ?? "") ? ["skipped"] : ["deleted"];
      }
      return null;
    });
    const store = createRedisIdempotencyStore({ port });
    const result = await store.deleteExpired({ before: beforeOffset });
    expect(luaBefore).toBe("2026-06-15T08:00:00.000Z");
    expect(result.deleted).toBe(0);
  });

  it("REDIS-CLEAN-1: deleteExpired default limit is bounded (not Infinity)", async () => {
    expect(DEFAULT_DELETE_EXPIRED_LIMIT).toBe(1000);
    expect(Number.isFinite(DEFAULT_DELETE_EXPIRED_LIMIT)).toBe(true);
    let evals = 0;
    const { port } = createMockPort((call) => {
      if (call.command === "SCAN") {
        const keys = Array.from({ length: 50 }, (_, i) => `psdk:v1:recon:job:${evals + i}`);
        return ["1", keys];
      }
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        evals++;
        return ["deleted"];
      }
      return null;
    });
    const store = createRedisReconciliationStore({ port });
    const result = await store.deleteExpired({ before: "2099-01-01T00:00:00.000Z" });
    expect(result.deleted).toBe(DEFAULT_DELETE_EXPIRED_LIMIT);
    expect(evals).toBe(DEFAULT_DELETE_EXPIRED_LIMIT);
    const higher = await store.deleteExpired({
      before: "2099-01-01T00:00:00.000Z",
      limit: 5,
    });
    expect(higher.deleted).toBe(5);
  });

  it("P1315-REDIS-5: invalid before fails closed before SCAN", async () => {
    let sendCount = 0;
    const { port } = createMockPort(() => {
      sendCount++;
      return null;
    });
    const idemp = createRedisIdempotencyStore({ port });
    const webhook = createRedisWebhookInboxStore({ port });
    const recon = createRedisReconciliationStore({ port });
    await expect(idemp.deleteExpired({ before: "not-a-date" })).rejects.toBeInstanceOf(
      StoreInvalidSchemaError,
    );
    await expect(webhook.deleteExpired({ before: "" })).rejects.toBeInstanceOf(
      StoreInvalidSchemaError,
    );
    await expect(recon.deleteExpired({ before: "nope" })).rejects.toBeInstanceOf(
      StoreInvalidSchemaError,
    );
    expect(sendCount).toBe(0);
  });

  it("P1315-REDIS-5: listDue / listRetryable write canonical Z nowIso", async () => {
    const { port, calls } = createMockPort((call) => {
      if (call.command === "ZRANGEBYSCORE") {
        return String(call.args[0] ?? "").includes("whinbox") ? ["e1"] : ["j1"];
      }
      if (call.command === "EVAL" || call.command === "EVALSHA") {
        const joined = call.args.map(String).join(" ");
        if (joined.includes("whinbox")) {
          return ["ok", ...webhookPack({ status: "pending" })];
        }
        return ["ok", ...reconPack({ status: "scheduled" })];
      }
      return null;
    });
    const recon = createRedisReconciliationStore({ port });
    const webhook = createRedisWebhookInboxStore({ port });
    const offsetNow = "2026-06-15T13:00:00.000+05:00";
    await recon.listDue({ now: offsetNow, limit: 1 });
    await webhook.listRetryable({ now: offsetNow, limit: 1 });
    const evalCalls = calls.filter(
      (c) => c.command === "EVAL" || c.command === "EVALSHA",
    );
    expect(evalCalls.length).toBeGreaterThan(0);
    for (const call of evalCalls) {
      const args = call.args.map(String);
      expect(args).toContain("2026-06-15T08:00:00.000Z");
      expect(args).not.toContain(offsetNow);
    }
  });
});
