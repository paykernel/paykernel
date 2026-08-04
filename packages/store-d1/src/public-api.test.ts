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
  "createD1PaymentStores",
  "createD1IdempotencyStore",
  "createD1WebhookInboxStore",
  "createD1ReconciliationStore",
  "createD1Stores",
  "createD1IdempotencyStoreFromBinding",
  "createD1WebhookInboxStoreFromBinding",
  "createD1ReconciliationStoreFromBinding",
  "createD1Executor",
  "migrateD1Adapter",
  "verifyD1AdapterSchema",
  "D1_STORAGE_ADAPTER_MANIFEST",
  "getD1StorageAdapterManifest",
  "toSqlStoreExecutor",
  "isD1Executor",
  "isD1DatabaseLike",
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
  "D1_SESSION_FIRST_PRIMARY",
  "D1_SESSION_FIRST_UNCONSTRAINED",
  "supportsD1Sessions",
  "withD1Session",
  "createSessionScopedExecutor",
  "scopeExecutorSession",
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

  it("manifest asserts multi-host durable strong claims and sessions honesty", () => {
    assertStorageAdapterManifest(api.D1_STORAGE_ADAPTER_MANIFEST);
    expect(api.D1_STORAGE_ADAPTER_MANIFEST.name).toBe("cloudflare-d1");
    expect(api.D1_STORAGE_ADAPTER_MANIFEST.coordinationScope).toBe("multi-host");
    expect(api.D1_STORAGE_ADAPTER_MANIFEST.durability).toBe("durable");
    expect(api.D1_STORAGE_ADAPTER_MANIFEST.consistency.claims).toBe("strong");
    expect(api.D1_STORAGE_ADAPTER_MANIFEST.consistency.readAfterWrite).toBe(
      "session",
    );
    expect(api.D1_STORAGE_ADAPTER_MANIFEST.consistency.staleReadsPossible).toBe(
      true,
    );
    expect(api.D1_STORAGE_ADAPTER_MANIFEST.supportsTransactions).toBe(true);
    expect(isProductionSafeCoordination(api.D1_STORAGE_ADAPTER_MANIFEST)).toBe(
      true,
    );
    expect(isStrongClaimAdapter(api.D1_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(api.getD1StorageAdapterManifest()).toBe(
      api.D1_STORAGE_ADAPTER_MANIFEST,
    );

    const notes = api.D1_STORAGE_ADAPTER_MANIFEST.notes?.join(" ") ?? "";
    expect(notes.toLowerCase()).toContain("not the same as packages/store-sqlite");
    expect(notes.toLowerCase()).toContain("not the same as packages/store-turso");
    expect(notes.toLowerCase()).toContain("workers");
    expect(notes.toLowerCase()).toContain("session");
    expect(notes.toLowerCase()).toContain("batch");
    expect(notes.toLowerCase()).toContain("2026-08-03");
    expect(notes.toLowerCase()).toContain("never auto-migrate");
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

  it("createD1PaymentStores does not require REST credentials", () => {
    // Structural: factory only needs { db } — no account/token fields.
    const src = readFileSync(join(SRC_ROOT, "d1-binding.ts"), "utf8");
    expect(src).toContain("createD1PaymentStores");
    expect(src).toContain("options.db");
    expect(src.toLowerCase()).not.toContain("api_token");
    expect(src.toLowerCase()).not.toContain("accountid");
  });
});

describe("namespace validation", () => {
  it("rejects invalid tablePrefix on factory", () => {
    const executor = {
      async query() {
        return [];
      },
      async execute() {
        return { changes: 0 };
      },
    };
    expect(() =>
      api.createD1IdempotencyStore({
        executor,
        namespace: { tablePrefix: "bad-prefix;drop" },
      }),
    ).toThrow();
  });

  it("rejects invalid sqlSchema", () => {
    const executor = {
      async query() {
        return [];
      },
      async execute() {
        return { changes: 0 };
      },
    };
    expect(() =>
      api.createD1WebhookInboxStore({
        executor,
        namespace: { sqlSchema: "x;--" },
      }),
    ).toThrow();
  });
});
