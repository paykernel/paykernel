/**
 * Conformance suite against live Redis when PAYMENTS_SDK_REDIS_URL / REDIS_URL is set.
 * Skips cleanly otherwise (Redis is optional infrastructure).
 *
 * Primary live binding under Bun: Bun.RedisClient; else ioredis / node-redis.
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
} from "@paykernel/testkit";
import { createRedisStores } from "./index-stores";
import {
  hasLiveRedis,
  getRedisUrl,
  createLivePort,
  uniqueKeyPrefix,
} from "./test-utils/redis-env";

const live = hasLiveRedis();

function assertSuiteOk(report: {
  ok: boolean;
  results: readonly { ok: boolean; name?: string; error?: string }[];
}): void {
  expect(
    report.ok,
    JSON.stringify(
      report.results.filter((r) => !r.ok),
      null,
      2,
    ),
  ).toBe(true);
}

describe.skipIf(!live)("Redis store conformance (live)", () => {
  it("idempotency suite", async () => {
    const { port, close, binding } = await createLivePort();
    try {
      const prefix = uniqueKeyPrefix("conf_id");
      const report = await runIdempotencyStoreConformanceSuite({
        name: `redis-idempotency-${binding}`,
        createStore: async ({ clock }) =>
          createRedisStores({
            port,
            clock,
            keys: { prefix, version: "v1" },
          }).idempotency,
        createClock: () => createFakeClock(),
      });
      assertSuiteOk(report);
    } finally {
      await close();
    }
  }, 120_000);

  it("webhook inbox suite", async () => {
    const { port, close, binding } = await createLivePort();
    try {
      const prefix = uniqueKeyPrefix("conf_wh");
      const report = await runWebhookInboxStoreConformanceSuite({
        name: `redis-webhook-${binding}`,
        createStore: async ({ clock }) =>
          createRedisStores({
            port,
            clock,
            keys: { prefix, version: "v1" },
          }).webhookInbox,
        createClock: () => createFakeClock(),
      });
      assertSuiteOk(report);
    } finally {
      await close();
    }
  }, 120_000);

  it("reconciliation suite", async () => {
    const { port, close, binding } = await createLivePort();
    try {
      const prefix = uniqueKeyPrefix("conf_rc");
      const report = await runReconciliationStoreConformanceSuite({
        name: `redis-recon-${binding}`,
        createStore: async ({ clock }) =>
          createRedisStores({
            port,
            clock,
            keys: { prefix, version: "v1" },
          }).reconciliation,
        createClock: () => createFakeClock(),
      });
      assertSuiteOk(report);
    } finally {
      await close();
    }
  }, 120_000);
});

describe("Redis conformance skip policy", () => {
  it("documents optional Redis", () => {
    if (!live) {
      expect(hasLiveRedis()).toBe(false);
    } else {
      expect(getRedisUrl()).toBeTruthy();
    }
  });
});
