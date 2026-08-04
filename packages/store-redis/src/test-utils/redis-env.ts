/**
 * Live Redis env helpers for integration / conformance tests.
 *
 * Prefer PAYMENTS_SDK_REDIS_URL; fall back to REDIS_URL / VALKEY_URL.
 * When set, live tests MUST run (not skip) and pass.
 * When unset, integration/conformance skip cleanly so CI without Redis stays green.
 */

import type { RedisCommandPort } from "../port";

export function getRedisUrl(): string | undefined {
  return (
    process.env["PAYMENTS_SDK_REDIS_URL"] ??
    process.env["REDIS_URL"] ??
    process.env["VALKEY_URL"] ??
    undefined
  );
}

export function hasLiveRedis(): boolean {
  const url = getRedisUrl();
  return typeof url === "string" && url.length > 0;
}

/** Unique key prefix per test run to avoid collisions on shared Redis. */
export function uniqueKeyPrefix(label = "t"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const safe = label.replace(/[^A-Za-z0-9_]/g, "").slice(0, 8) || "t";
  return `psdk_${safe}_${Date.now().toString(36)}_${rand}`;
}

export type LivePortHandle = {
  port: RedisCommandPort;
  /** Binding used to open the connection. */
  binding: "bun" | "ioredis" | "node-redis";
  close: () => Promise<void>;
};

function hasBunRedisClient(): boolean {
  const BunGlobal = (globalThis as { Bun?: { RedisClient?: unknown } }).Bun;
  return typeof BunGlobal?.RedisClient === "function";
}

/**
 * Open a live {@link RedisCommandPort}.
 *
 * Primary under Bun: native Bun.RedisClient.
 * Fallback: ioredis (enableOfflineQueue: false), then node-redis.
 */
export async function createLivePort(
  preferred?: "bun" | "ioredis" | "node-redis",
): Promise<LivePortHandle> {
  const url = getRedisUrl();
  if (!url) {
    throw new Error(
      "createLivePort requires PAYMENTS_SDK_REDIS_URL, REDIS_URL, or VALKEY_URL",
    );
  }

  type BindingName = "bun" | "ioredis" | "node-redis";
  const all: BindingName[] = ["bun", "ioredis", "node-redis"];
  const order: BindingName[] = preferred
    ? [preferred, ...all.filter((b) => b !== preferred)]
    : hasBunRedisClient()
      ? all
      : ["ioredis", "node-redis"];

  const errors: string[] = [];

  for (const binding of order) {
    try {
      if (binding === "bun") {
        if (!hasBunRedisClient()) {
          errors.push("bun: RedisClient unavailable");
          continue;
        }
        const BunGlobal = (
          globalThis as {
            Bun: { RedisClient: new (url: string) => { send: (c: string, a: string[]) => Promise<unknown>; close?: () => void } };
          }
        ).Bun;
        const client = new BunGlobal.RedisClient(url);
        // Warm connection
        await client.send("PING", []);
        return {
          binding: "bun",
          port: {
            async send(command, args) {
              return client.send(command, args as string[]);
            },
          },
          close: async () => {
            try {
              client.close?.();
            } catch {
              /* ignore */
            }
          },
        };
      }

      if (binding === "ioredis") {
        const Redis = (await import("ioredis")).default;
        const client = new Redis(url, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: true,
        });
        await client.connect();
        return {
          binding: "ioredis",
          port: {
            async send(command, args) {
              return client.call(command, ...args);
            },
          },
          close: async () => {
            client.disconnect();
          },
        };
      }

      // node-redis
      const { createClient } = await import("redis");
      const client = createClient({
        url,
        disableOfflineQueue: true,
      });
      await client.connect();
      return {
        binding: "node-redis",
        port: {
          async send(command, args) {
            return client.sendCommand([command, ...args]);
          },
        },
        close: async () => {
          await client.quit();
        },
      };
    } catch (err) {
      errors.push(
        `${binding}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(`Unable to open live Redis port: ${errors.join("; ")}`);
}

/**
 * Parse redis_version from INFO server. Returns null when unavailable.
 */
export async function readRedisServerVersion(
  port: RedisCommandPort,
): Promise<string | null> {
  try {
    const raw = await port.send("INFO", ["server"]);
    const text = typeof raw === "string" ? raw : String(raw ?? "");
    const m = text.match(/redis_version:([0-9]+\.[0-9]+(?:\.[0-9]+)?)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Semver-ish compare: true when version >= major.minor.patch (patch optional). */
export function isRedisVersionAtLeast(
  version: string,
  major: number,
  minor = 0,
  patch = 0,
): boolean {
  const parts = version.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}
