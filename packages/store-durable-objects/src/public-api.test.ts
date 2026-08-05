/**
 * Public API freeze + root must not import local sqlite drivers or cloudflare:workers.
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
  "createDoPaymentStores",
  "createDoPaymentStoresFromStorage",
  "createDoIdempotencyStore",
  "createDoWebhookInboxStore",
  "createDoReconciliationStore",
  "createDoStores",
  "createDoStoresFromStorage",
  "createDoIdempotencyStoreFromNamespace",
  "createDoWebhookInboxStoreFromNamespace",
  "createDoReconciliationStoreFromNamespace",
  "createDoExecutor",
  "migrateDoAdapter",
  "ensureDoSchema",
  "verifyDoAdapterSchema",
  "DO_STORAGE_ADAPTER_MANIFEST",
  "getDoStorageAdapterManifest",
  "resolveDoShardName",
  "resolveDoDiscoveryPartitions",
  "enumerateDoPartitionShardNames",
  "resolveDoHashLayoutId",
  "resolveDoHashLayoutMetaShardName",
  "assertDoHashPartitionLayoutStable",
  "hashStringToUint32",
  "getDoStub",
  "assertDoShardingStrategy",
  "RECOMMENDED_HASH_PARTITIONS",
  "DO_HASH_LAYOUT_META_SUFFIX",
  "ensureDoHashPartitionLayout",
  "toSqlStoreExecutor",
  "isDoExecutor",
  "isDoStorageLike",
  "createSystemClock",
  "clockNowIso",
  "clockAddMsIso",
  "mapDriverError",
  "withMappedErrors",
  "withMappedTransaction",
  "isLikelyDriverFailure",
  "StoreError",
  "StoreLeaseLostError",
  "StoreUnavailableError",
  "StoreTimeoutError",
  "StoreSerializationFailureError",
  "StoreInvalidSchemaError",
  "StoreCorruptedRecordError",
  "StoreUnsupportedFeatureError",
  "PaymentsStoreObject",
  "createAlarmScheduler",
  "ensureAlarmQueueSchema",
] as const;

const FORBIDDEN_ROOT_DRIVERS = [
  "bun:sqlite",
  "better-sqlite3",
  "node:sqlite",
  "@libsql/client",
  "@tursodatabase/serverless",
  "cloudflare:workers",
] as const;

const SRC_ROOT = join(import.meta.dir);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "test-utils" || name.endsWith(".test.ts")) continue;
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

  it("manifest asserts multi-host durable strong RAW + sharding honesty", () => {
    assertStorageAdapterManifest(api.DO_STORAGE_ADAPTER_MANIFEST);
    expect(api.DO_STORAGE_ADAPTER_MANIFEST.name).toBe("cloudflare-do");
    expect(api.DO_STORAGE_ADAPTER_MANIFEST.coordinationScope).toBe("multi-host");
    expect(api.DO_STORAGE_ADAPTER_MANIFEST.durability).toBe("durable");
    expect(api.DO_STORAGE_ADAPTER_MANIFEST.consistency.claims).toBe("strong");
    expect(api.DO_STORAGE_ADAPTER_MANIFEST.consistency.readAfterWrite).toBe(
      "strong",
    );
    expect(api.DO_STORAGE_ADAPTER_MANIFEST.consistency.staleReadsPossible).toBe(
      false,
    );
    expect(api.DO_STORAGE_ADAPTER_MANIFEST.supportsTransactions).toBe(true);
    expect(isProductionSafeCoordination(api.DO_STORAGE_ADAPTER_MANIFEST)).toBe(
      true,
    );
    expect(isStrongClaimAdapter(api.DO_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(api.getDoStorageAdapterManifest()).toBe(
      api.DO_STORAGE_ADAPTER_MANIFEST,
    );

    const notes = api.DO_STORAGE_ADAPTER_MANIFEST.notes?.join(" ") ?? "";
    expect(notes.toLowerCase()).toContain("new_sqlite_classes");
    expect(notes.toLowerCase()).toContain("not packages/store-d1");
    expect(notes.toLowerCase()).toContain("not adapter-sqlite");
    expect(notes.toLowerCase()).toContain("not adapter-turso");
    expect(notes.toLowerCase()).toContain("never route all payment work");
    expect(notes.toLowerCase()).toContain("global durable object");
    expect(notes.toLowerCase()).toContain("sharding");
    expect(notes.toLowerCase()).toContain("hot-key");
    expect(notes.toLowerCase()).toContain("transactionsync");
    expect(notes.toLowerCase()).toContain("at-least-once");
    expect(notes.toLowerCase()).toContain("2026-08-03");
    expect(notes.toLowerCase()).toContain("never auto-migrate");
    expect(notes.toLowerCase()).toContain("worker-client");
    expect(notes.toLowerCase()).toContain("cross-object");
    expect(notes.toLowerCase()).toContain("runintransaction");
  });

  it("root production graph has no local-sqlite / cloudflare:workers imports", () => {
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

  it("package.json is cloudflare-only and has single root export", () => {
    const pkg = JSON.parse(
      readFileSync(join(SRC_ROOT, "../package.json"), "utf8"),
    ) as {
      exports: Record<string, unknown>;
      paymentsSdk: { portable: boolean; runtime: string };
      private?: boolean;
    };
    expect(pkg.exports["."]).toBeDefined();
    expect(Object.keys(pkg.exports)).toEqual(["."]);
    expect(pkg.paymentsSdk.portable).toBe(false);
    expect(pkg.paymentsSdk.runtime).toBe("cloudflare-only");
    expect(pkg.private).toBeUndefined();
  });

  it("createDoPaymentStores does not require REST credentials and requires sharding", () => {
    const src = readFileSync(join(SRC_ROOT, "client.ts"), "utf8");
    expect(src).toContain("createDoPaymentStores");
    expect(src).toContain("options.namespace");
    expect(src).toContain("sharding");
    expect(src.toLowerCase()).not.toContain("api_token");
    expect(src.toLowerCase()).not.toContain("accountid");
  });

  it("rejects missing sharding / global strategy", () => {
    expect(() =>
      api.createDoPaymentStores({
        namespace: {
          idFromName: (n) => ({ toString: () => n }),
          get: () => ({}),
        },
        // @ts-expect-error intentional
        sharding: undefined,
      }),
    ).toThrow();

    expect(() =>
      api.assertDoShardingStrategy({ kind: "global" }),
    ).toThrow(/global/);
  });

  it("production source does not import D1-only APIs as required path", () => {
    const files = walkTs(SRC_ROOT);
    const importRe =
      /(?:(?:import|export)[\s\w*{}$,\n]*?from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Honesty notes may mention adapter-cloudflare-d1 by name; forbid imports/APIs.
      expect(src.includes("createD1PaymentStores"), file).toBe(false);
      expect(src.includes("createD1IdempotencyStore"), file).toBe(false);
      expect(src.includes("D1DatabaseLike"), file).toBe(false);
      importRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const spec = m[1]!;
        expect(
          spec.includes("adapter-cloudflare-d1"),
          `${file} imports ${spec}`,
        ).toBe(false);
      }
    }
  });
});

describe("namespace validation", () => {
  it("rejects invalid tablePrefix on factory", () => {
    const executor = {
      query() {
        return [];
      },
      run() {
        return { changes: 0 };
      },
      transaction<T>(fn: () => T) {
        return fn();
      },
    };
    expect(() =>
      api.createDoIdempotencyStore({
        executor,
        namespace: { tablePrefix: "bad-prefix;drop" },
      }),
    ).toThrow();
  });
});
