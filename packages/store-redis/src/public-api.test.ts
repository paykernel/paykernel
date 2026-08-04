/**
 * Public API freeze + root must not import optional drivers.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as api from "./index";
import {
  assertStorageAdapterManifest,
  isProductionSafeCoordination,
  isStrongClaimAdapter,
} from "@paykernel/testkit";

const EXPECTED_RUNTIME = [
  "createRedisIdempotencyStore",
  "createRedisWebhookInboxStore",
  "createRedisReconciliationStore",
  "createRedisStores",
  "REDIS_STORAGE_ADAPTER_MANIFEST",
  "getRedisStorageAdapterManifest",
  "createEvalHelper",
  "isRedisCommandPort",
  "createSystemClock",
  "clockNowIso",
  "clockAddMsIso",
  "mapDriverError",
  "withMappedErrors",
  "StoreError",
  "StoreLeaseLostError",
  "StoreUnavailableError",
  "StoreTimeoutError",
  "resolveKeyDesign",
  "recordKey",
  "REDIS_SCRIPT_REGISTRY",
  "parseTaggedResult",
] as const;

const FORBIDDEN_ROOT_DRIVERS = [
  "ioredis",
  "redis",
  "@upstash/redis",
  "bun:redis",
] as const;

const SRC_ROOT = join(import.meta.dir);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // drivers/* and test-utils/* are not on the portable root production graph
    if (name === "drivers" || name === "test-utils" || name.endsWith(".test.ts")) {
      continue;
    }
    // Subpath entry files re-export drivers — exclude them from root graph check
    if (
      name === "bun.ts" ||
      name === "upstash.ts" ||
      name === "ioredis.ts" ||
      name === "node-redis.ts"
    ) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("public API surface", () => {
  it("exports expected runtime symbols", () => {
    for (const name of EXPECTED_RUNTIME) {
      expect(name in api, `missing export ${name}`).toBe(true);
      const val = (api as Record<string, unknown>)[name];
      expect(val, name).toBeDefined();
    }
  });

  it("manifest asserts and is multi-host configuration-dependent", () => {
    assertStorageAdapterManifest(api.REDIS_STORAGE_ADAPTER_MANIFEST);
    expect(api.REDIS_STORAGE_ADAPTER_MANIFEST.name).toBe("redis");
    expect(api.REDIS_STORAGE_ADAPTER_MANIFEST.coordinationScope).toBe("multi-host");
    expect(api.REDIS_STORAGE_ADAPTER_MANIFEST.durability).toBe(
      "configuration-dependent",
    );
    expect(api.REDIS_STORAGE_ADAPTER_MANIFEST.consistency.claims).toBe("strong");
    expect(api.REDIS_STORAGE_ADAPTER_MANIFEST.supportsTransactions).toBe(false);
    expect(isProductionSafeCoordination(api.REDIS_STORAGE_ADAPTER_MANIFEST)).toBe(
      true,
    );
    expect(isStrongClaimAdapter(api.REDIS_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(api.getRedisStorageAdapterManifest()).toBe(
      api.REDIS_STORAGE_ADAPTER_MANIFEST,
    );
  });

  it("root production graph has no optional driver imports", () => {
    const files = walkTs(SRC_ROOT);
    const importRe =
      /(?:(?:import|export)[\s\w*{}$,\n]*?from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      importRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const spec = m[1]!;
        for (const driver of FORBIDDEN_ROOT_DRIVERS) {
          expect(
            spec === driver || spec.startsWith(`${driver}/`),
            `${file} imports ${spec}`,
          ).toBe(false);
        }
      }
    }
  });

  it("index.ts source does not mention forbidden driver bare imports", () => {
    const indexSrc = readFileSync(join(SRC_ROOT, "index.ts"), "utf8");
    for (const driver of FORBIDDEN_ROOT_DRIVERS) {
      expect(indexSrc.includes(`from "${driver}"`)).toBe(false);
      expect(indexSrc.includes(`from '${driver}'`)).toBe(false);
    }
  });
});

describe("key validation on factory", () => {
  it("rejects invalid prefix", () => {
    const port = {
      async send() {
        return null;
      },
    };
    expect(() =>
      api.createRedisIdempotencyStore({
        port,
        keys: { prefix: "bad prefix" },
      }),
    ).toThrow();
  });

  it("rejects tenant with newlines", () => {
    const port = {
      async send() {
        return null;
      },
    };
    expect(() =>
      api.createRedisWebhookInboxStore({
        port,
        keys: { tenantId: "a\nb" },
      }),
    ).toThrow();
  });
});
