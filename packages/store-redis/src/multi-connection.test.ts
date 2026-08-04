/**
 * Multi-connection concurrent claim proofs (live Redis only).
 *
 * Evidence for multi-host / multi-process safety: engine-level Lua, not a
 * process mutex. Uses ≥2 separate clients (ports).
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import { createRedisIdempotencyStore } from "./index-stores";
import {
  hasLiveRedis,
  createLivePort,
  uniqueKeyPrefix,
} from "./test-utils/redis-env";

const live = hasLiveRedis();

describe.skipIf(!live)("multi-connection concurrent claims", () => {
  it("only one worker acquires under concurrent reserve (3 clients)", async () => {
    const ports = await Promise.all([
      createLivePort(),
      createLivePort(),
      createLivePort(),
    ]);
    const prefix = uniqueKeyPrefix("mc");
    try {
      const clock = createFakeClock();
      const stores = ports.map((p) =>
        createRedisIdempotencyStore({
          port: p.port,
          clock,
          keys: { prefix, version: "v1" },
        }),
      );

      const key = `race_mc_${Date.now()}`;
      const workers = 30;
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) =>
          stores[i % stores.length]!.reserve({
            key,
            fingerprint: "fp",
            owner: `w${i}`,
            leaseMs: 30_000,
          }),
        ),
      );

      const acquired = results.filter((r) => r.kind === "acquired");
      expect(acquired.length).toBe(1);
      expect(results.filter((r) => r.kind === "in_progress").length).toBe(
        workers - 1,
      );
    } finally {
      await Promise.all(ports.map((p) => p.close()));
    }
  }, 60_000);

  it("parallel renew with wrong token fails; owner renew succeeds", async () => {
    const a = await createLivePort();
    const b = await createLivePort();
    const prefix = uniqueKeyPrefix("rn");
    try {
      const clock = createFakeClock();
      const storeA = createRedisIdempotencyStore({
        port: a.port,
        clock,
        keys: { prefix },
      });
      const storeB = createRedisIdempotencyStore({
        port: b.port,
        clock,
        keys: { prefix },
      });

      const r = await storeA.reserve({
        key: "k",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 30_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;

      const wrong = await storeB.renew({
        key: "k",
        leaseToken: "wrong",
        leaseMs: 30_000,
      });
      expect(wrong.ok).toBe(false);

      const ok = await storeA.renew({
        key: "k",
        leaseToken: r.leaseToken,
        leaseMs: 30_000,
      });
      expect(ok.ok).toBe(true);
    } finally {
      await a.close();
      await b.close();
    }
  }, 30_000);
});
