/**
 * Worker-client RPC contracts: required methods, thin (non-Proxy) stubs,
 * tableNamespace must be sent by the client (not injected by the mock).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeClock } from "@paykernel/testkit";
import {
  createDoPaymentStores,
  REQUIRED_DO_RPC_METHODS,
} from "./index";
import { createMockDoNamespace } from "./test-utils/mock-namespace";
import { uniqueTablePrefix } from "./test-utils/do-env";
import type { DoNamespaceLike, DoStubLike } from "./types";

describe("required DO RPC list", () => {
  it("smoke worker and wrangler sketch forward every required RPC", () => {
    const smoke = readFileSync(
      join(import.meta.dir, "../smoke/worker.ts"),
      "utf8",
    );
    const sketch = readFileSync(
      join(import.meta.dir, "../examples/wrangler.toml"),
      "utf8",
    );
    for (const method of REQUIRED_DO_RPC_METHODS) {
      expect(smoke, `smoke/worker.ts missing ${method}`).toContain(method);
      expect(sketch, `examples/wrangler.toml missing ${method}`).toContain(
        method,
      );
    }
  });
});

describe("P17-RPC thin wrapper (no Proxy)", () => {
  it("hash reserve fails when stub has reserveIdempotency but not bindHashPartitionLayout", async () => {
    const stub: DoStubLike = {
      reserveIdempotency: async () => ({
        kind: "acquired",
        leaseToken: "lt_thin",
        record: {
          key: "k",
          status: "reserved",
          fingerprint: "fp",
          attempts: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          generation: 1,
        },
      }),
    };
    const namespace: DoNamespaceLike = {
      idFromName: (n) => ({ toString: () => n }),
      get: () => stub,
      getByName: () => stub,
    };
    const stores = createDoPaymentStores({
      namespace,
      sharding: { kind: "hash", partitions: 2 },
    });
    await expect(
      stores.idempotency.reserve({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1_000,
      }),
    ).rejects.toThrow(/missing RPC method: bindHashPartitionLayout/);
  });
});

describe("P17-NS tableNamespace is sent by the Worker client", () => {
  it("mock without tableNamespace still prefixes tables when the client sends it", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    // Intentionally omit tableNamespace on the mock — the Worker client must send it.
    const ns = createMockDoNamespace({ clock });
    const prefix = uniqueTablePrefix("nsrpc");
    try {
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "key" },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      const r = await stores.idempotency.reserve({
        key: "ns-key",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      expect(r.kind).toBe("acquired");

      expect(ns.partitions.size).toBeGreaterThanOrEqual(1);
      const handle = [...ns.partitions.values()][0]!;
      const tables = handle.sqlite
        .query(`SELECT name AS name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>;
      const prefixed = tables.filter((t) => t.name.startsWith(prefix));
      expect(prefixed.length).toBeGreaterThan(0);

      const row = handle.sqlite
        .query(`SELECT key AS key FROM ${prefix}payment_idempotency WHERE key = ?`)
        .get("ns-key") as { key: string } | null;
      expect(row?.key).toBe("ns-key");
    } finally {
      ns.close();
    }
  });
});
