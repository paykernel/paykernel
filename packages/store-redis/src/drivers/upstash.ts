/**
 * Upstash Redis binding — optional peer, isolated subpath only.
 *
 * HTTP REST transport: higher latency / serverless cold-start caveats.
 * EVAL still runs server-side Lua (atomicity preserved); use eval/evalsha when
 * available, otherwise generic command dispatch that still hits the server.
 *
 * Map timeouts/auth through shared mapDriverError at store boundaries.
 */

import type { RedisCommandPort } from "../port";
import {
  createRedisIdempotencyStore,
  createRedisWebhookInboxStore,
  createRedisReconciliationStore,
  createRedisStores,
} from "../index-stores";
import type { RedisStoreOptions, RedisStoresBundle } from "../types";
import type { StoreClock } from "../clock";
import type { KeyOptions } from "../keys";

/**
 * Minimal Upstash client surface.
 * `@upstash/redis` exposes `.eval` and generic command via call-style APIs.
 */
export type UpstashRedisLike = {
  eval(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<unknown>;
  // Generic command execution (Upstash Redis extends a command interface).
  [key: string]: unknown;
};

/**
 * Adapt `@upstash/redis` to {@link RedisCommandPort} via raw command execution.
 *
 * Uses the client's callable command methods when available (`client[cmd](...args)`),
 * and special-cases EVAL/EVALSHA so Lua remains server-side (not client-sequenced).
 */
export function createPortFromUpstash(client: UpstashRedisLike): RedisCommandPort {
  return {
    async send(command: string, args: readonly string[]): Promise<unknown> {
      const cmd = command.toLowerCase();
      if (cmd === "eval") {
        // EVAL script numkeys [key ...] [arg ...]
        const script = args[0] ?? "";
        const numKeys = Number.parseInt(args[1] ?? "0", 10) || 0;
        const keys = args.slice(2, 2 + numKeys) as string[];
        const argv = args.slice(2 + numKeys) as string[];
        return client.eval(script, keys, argv);
      }
      if (cmd === "evalsha") {
        // Upstash may not support EVALSHA the same way — fall back if present.
        const fn = client["evalsha"] as
          | ((sha: string, keys: string[], args: (string | number)[]) => Promise<unknown>)
          | undefined;
        if (typeof fn === "function") {
          const sha = args[0] ?? "";
          const numKeys = Number.parseInt(args[1] ?? "0", 10) || 0;
          const keys = args.slice(2, 2 + numKeys) as string[];
          const argv = args.slice(2 + numKeys) as string[];
          return fn.call(client, sha, keys, argv);
        }
        throw new Error("Upstash client does not support EVALSHA");
      }
      // Generic: client.command(...args) for lowercase method names
      const method = client[cmd];
      if (typeof method === "function") {
        return (method as (...a: string[]) => Promise<unknown>).apply(
          client,
          args as string[],
        );
      }
      // Fallback: some clients expose .call or pipeline-style execute
      const call = client["call"] as
        | ((...a: unknown[]) => Promise<unknown>)
        | undefined;
      if (typeof call === "function") {
        return call.call(client, command, ...args);
      }
      throw new Error(`Upstash client does not support command ${command}`);
    },
  };
}

/** Alias preferred by package docs / Phase 13 API. */
export const createUpstashCommandPort = createPortFromUpstash;

export type UpstashStoreOptions = {
  client: UpstashRedisLike;
  clock?: StoreClock;
  keys?: KeyOptions;
  retentionTtlMs?: number;
};

function toOptions(opts: UpstashStoreOptions): RedisStoreOptions {
  const base: RedisStoreOptions = {
    port: createUpstashCommandPort(opts.client),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.keys !== undefined) base.keys = opts.keys;
  if (opts.retentionTtlMs !== undefined) base.retentionTtlMs = opts.retentionTtlMs;
  return base;
}

export function createRedisIdempotencyStoreFromUpstash(opts: UpstashStoreOptions) {
  return createRedisIdempotencyStore(toOptions(opts));
}

export function createRedisWebhookInboxStoreFromUpstash(opts: UpstashStoreOptions) {
  return createRedisWebhookInboxStore(toOptions(opts));
}

export function createRedisReconciliationStoreFromUpstash(opts: UpstashStoreOptions) {
  return createRedisReconciliationStore(toOptions(opts));
}

export function createRedisStoresFromUpstash(
  opts: UpstashStoreOptions,
): RedisStoresBundle {
  return createRedisStores(toOptions(opts));
}
