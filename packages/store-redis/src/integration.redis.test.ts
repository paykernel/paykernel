/**
 * Live Redis integration tests (env-gated).
 *
 * Env (prefer first): PAYMENTS_SDK_REDIS_URL, REDIS_URL, VALKEY_URL.
 * When unset: skip cleanly. When set: MUST run and pass.
 *
 * Covers Stream B 13.7 items beyond pure conformance:
 * concurrent multi-client claims, FakeClock reclaim, stale lease,
 * unavailable mapping, server version, deleteExpired TTL cleanup,
 * Lua atomicity (no JS get-then-set).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createFakeClock,
  StoreLeaseLostError,
  StoreUnavailableError,
} from "@paykernel/testkit";
import {
  createRedisIdempotencyStore,
  createRedisStores,
  createRedisWebhookInboxStore,
} from "./index-stores";
import { mapDriverError } from "./errors";
import {
  hasLiveRedis,
  createLivePort,
  uniqueKeyPrefix,
  readRedisServerVersion,
  isRedisVersionAtLeast,
} from "./test-utils/redis-env";

const live = hasLiveRedis();

describe.skipIf(!live)("integration: concurrent multi-client claims", () => {
  it("exactly one acquired under concurrent reserve (2 clients)", async () => {
    const a = await createLivePort();
    const b = await createLivePort();
    const prefix = uniqueKeyPrefix("race");
    try {
      const clock = createFakeClock();
      const storeA = createRedisIdempotencyStore({
        port: a.port,
        clock,
        keys: { prefix, version: "v1" },
      });
      const storeB = createRedisIdempotencyStore({
        port: b.port,
        clock,
        keys: { prefix, version: "v1" },
      });

      const key = `race_${Date.now()}`;
      const workers = 24;
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) => {
          const store = i % 2 === 0 ? storeA : storeB;
          return store.reserve({
            key,
            fingerprint: "fp",
            owner: `w${i}`,
            leaseMs: 30_000,
          });
        }),
      );

      const acquired = results.filter((r) => r.kind === "acquired");
      const inProgress = results.filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(inProgress.length).toBe(workers - 1);
    } finally {
      await a.close();
      await b.close();
    }
  }, 60_000);
});

describe.skipIf(!live)("integration: lease reclaim + stale token", () => {
  it("FakeClock.advance allows reclaim; stale complete → StoreLeaseLostError", async () => {
    const { port, close } = await createLivePort();
    const prefix = uniqueKeyPrefix("lease");
    try {
      const clock = createFakeClock(new Date("2026-01-01T00:00:00.000Z"));
      const store = createRedisIdempotencyStore({
        port,
        clock,
        keys: { prefix, version: "v1" },
      });

      const r1 = await store.reserve({
        key: "stale1",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(r1.kind).toBe("acquired");
      if (r1.kind !== "acquired") return;
      const token1 = r1.leaseToken;

      clock.advance(2_000);

      const r2 = await store.reserve({
        key: "stale1",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(r2.kind).toBe("acquired");
      if (r2.kind !== "acquired") return;
      expect(r2.leaseToken).not.toBe(token1);
      expect(r2.record.generation).toBeGreaterThan(r1.record.generation);

      await expect(
        store.complete({
          key: "stale1",
          leaseToken: token1,
          result: { ok: false },
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);

      await store.complete({
        key: "stale1",
        leaseToken: r2.leaseToken,
        result: { ok: true },
      });
      const got = await store.get("stale1");
      expect(got?.status).toBe("completed");
    } finally {
      await close();
    }
  }, 60_000);

  it("stale fail/complete token rejected without live reclaim", async () => {
    const { port, close } = await createLivePort();
    const prefix = uniqueKeyPrefix("stok");
    try {
      const clock = createFakeClock();
      const store = createRedisIdempotencyStore({
        port,
        clock,
        keys: { prefix },
      });
      const r = await store.reserve({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 30_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;

      await expect(
        store.complete({
          key: "k",
          leaseToken: "not-the-token",
          result: { x: 1 },
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);
    } finally {
      await close();
    }
  }, 30_000);
});

describe.skipIf(!live)("integration: abandoned claim re-index", () => {
  it("listRetryable sees claim after lease expiry soft-release via get", async () => {
    // Memory store re-indexes expired claims on read; Redis must ZADD on soft-release
    // or workers that poll listRetryable never see abandoned work.
    const { port, close } = await createLivePort();
    const prefix = uniqueKeyPrefix("abandon");
    try {
      const clock = createFakeClock(new Date("2026-04-01T00:00:00.000Z"));
      const store = createRedisWebhookInboxStore({
        port,
        clock,
        keys: { prefix },
      });
      const claimed = await store.claim({
        key: "evt_abandon",
        payloadHash: "h1",
        owner: "w_dead",
        leaseMs: 1_000,
      });
      expect(claimed.kind).toBe("acquired");
      clock.advance(1_500);
      // Soft-release path (get) must re-add to retry ZSET
      const after = await store.get("evt_abandon");
      expect(after?.status).toBe("pending");
      const retryable = await store.listRetryable({ limit: 20 });
      expect(retryable.some((r) => r.key === "evt_abandon")).toBe(true);
    } finally {
      await close();
    }
  }, 60_000);
});

describe.skipIf(!live)("integration: webhook fail lease expiry fence (B6)", () => {
  it("claim, expire lease (FakeClock), fail → StoreLeaseLostError", async () => {
    const { port, close } = await createLivePort();
    const prefix = uniqueKeyPrefix("whfail");
    try {
      const clock = createFakeClock(new Date("2026-05-01T00:00:00.000Z"));
      const store = createRedisWebhookInboxStore({
        port,
        clock,
        keys: { prefix },
      });
      const a = await store.claim({
        key: "evt_fail_exp",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(a.kind).toBe("acquired");
      if (a.kind !== "acquired") return;
      clock.advance(2_000);
      await expect(
        store.fail({
          key: "evt_fail_exp",
          leaseToken: a.leaseToken,
          error: "too_late",
          retryAfterMs: 5_000,
        }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);
      // Recovery: expired lease reclaim still works
      const b = await store.claim({
        key: "evt_fail_exp",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      expect(b.kind).toBe("acquired");
    } finally {
      await close();
    }
  }, 60_000);
});

describe.skipIf(!live)("integration: webhook claim availableAt backoff (B4)", () => {
  it("pending with future available_ms → not_available; after clock advance → acquired", async () => {
    const { port, close } = await createLivePort();
    const prefix = uniqueKeyPrefix("whavail");
    try {
      const clock = createFakeClock(new Date("2026-05-01T00:00:00.000Z"));
      const store = createRedisWebhookInboxStore({
        port,
        clock,
        keys: { prefix },
      });
      const a = await store.claim({
        key: "evt_backoff",
        payloadHash: "h1",
        owner: "w1",
        leaseMs: 30_000,
      });
      expect(a.kind).toBe("acquired");
      if (a.kind !== "acquired") return;
      await store.fail({
        key: "evt_backoff",
        leaseToken: a.leaseToken,
        error: "retryable",
        retryAfterMs: 10_000,
      });
      const early = await store.claim({
        key: "evt_backoff",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      expect(early.kind).toBe("not_available");
      clock.advance(10_001);
      const later = await store.claim({
        key: "evt_backoff",
        payloadHash: "h1",
        owner: "w2",
        leaseMs: 30_000,
      });
      expect(later.kind).toBe("acquired");
    } finally {
      await close();
    }
  }, 60_000);
});

describe.skipIf(!live)("integration: deleteExpired TTL cleanup", () => {
  it("deleteExpired removes completed past before; keeps reserved", async () => {
    const { port, close } = await createLivePort();
    const prefix = uniqueKeyPrefix("ttl");
    try {
      const clock = createFakeClock(new Date("2026-03-01T00:00:00.000Z"));
      const store = createRedisIdempotencyStore({
        port,
        clock,
        keys: { prefix },
      });

      const reserved = await store.reserve({
        key: "live",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 60_000,
      });
      expect(reserved.kind).toBe("acquired");

      const done = await store.reserve({
        key: "done",
        fingerprint: "fp2",
        owner: "w",
        leaseMs: 60_000,
      });
      expect(done.kind).toBe("acquired");
      if (done.kind !== "acquired") return;
      await store.complete({
        key: "done",
        leaseToken: done.leaseToken,
        result: { ok: 1 },
      });

      clock.advance(5_000);
      const before = clock.now().toISOString();
      const cleaned = await store.deleteExpired({ before, limit: 100 });
      expect(cleaned.deleted).toBeGreaterThanOrEqual(1);

      expect(await store.get("done")).toBeUndefined();
      expect(await store.get("live")).toBeDefined();
    } finally {
      await close();
    }
  }, 60_000);
});

describe.skipIf(!live)("integration: server version", () => {
  it("INFO server reports redis_version when available; warn if < 7.2", async () => {
    const { port, close } = await createLivePort();
    try {
      const version = await readRedisServerVersion(port);
      // Some proxies strip INFO — tolerate null; when present assert parseable.
      if (version !== null) {
        expect(version).toMatch(/^\d+\.\d+/);
        if (!isRedisVersionAtLeast(version, 7, 2)) {
          // Document matrix target Redis 7.2+ / Valkey; do not fail older test DBs.
          console.warn(
            `[adapter-redis] live Redis version ${version} < 7.2 — preferred matrix is Redis 7.2+ / Valkey`,
          );
        }
      }
    } finally {
      await close();
    }
  }, 30_000);
});

describe("unavailable mapping (unit)", () => {
  it("mapDriverError maps connection refused to StoreUnavailableError", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
      code: "ECONNREFUSED",
    });
    const mapped = mapDriverError(err);
    expect(mapped).toBeInstanceOf(StoreUnavailableError);
  });
});

describe("Lua atomicity source policy (no live Redis required)", () => {
  it("store sources do not implement claim via get-then-set in JS", () => {
    const storesDir = join(import.meta.dir, "stores");
    const files = readdirSync(storesDir)
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
      .map((n) => join(storesDir, n));

    for (const file of files) {
      if (!statSync(file).isFile()) continue;
      const src = readFileSync(file, "utf8");
      // Forbidden patterns: client-side claim sequencing without EVAL.
      expect(src.includes("HGETALL")).toBe(false);
      expect(src.includes("SETNX")).toBe(false);
      // Claims must go through ctx.eval.eval / EVAL helper.
      if (file.endsWith("shared.ts")) continue;
      expect(
        src.includes("ctx.eval.eval") || src.includes("createEvalHelper"),
        `${file} should use EVAL helper for transitions`,
      ).toBe(true);
    }
  });
});

describe.skipIf(!live)("integration: binding factories (primary)", () => {
  it("createRedisStores + reserve/complete round-trip", async () => {
    const { port, close, binding } = await createLivePort();
    try {
      const prefix = uniqueKeyPrefix("rt");
      const clock = createFakeClock();
      const stores = createRedisStores({
        port,
        clock,
        keys: { prefix },
      });
      const r = await stores.idempotency.reserve({
        key: "k1",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;
      await stores.idempotency.complete({
        key: "k1",
        leaseToken: r.leaseToken,
        result: { binding },
      });
      const got = await stores.idempotency.get("k1");
      expect(got?.status).toBe("completed");
    } finally {
      await close();
    }
  }, 30_000);
});
