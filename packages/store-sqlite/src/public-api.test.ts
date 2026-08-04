/**
 * Public API freeze + root must not import SQLite drivers.
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
  "createSqliteIdempotencyStore",
  "createSqliteWebhookInboxStore",
  "createSqliteReconciliationStore",
  "createSqliteStores",
  "migrateSqliteAdapter",
  "verifySqliteAdapterSchema",
  "SQLITE_STORAGE_ADAPTER_MANIFEST",
  "getSqliteStorageAdapterManifest",
  "toSqlStoreExecutor",
  "isSqliteExecutor",
  "createSystemClock",
  "clockNowIso",
  "clockAddMsIso",
  "applyRecommendedPragmas",
  "mapDriverError",
  "withMappedErrors",
  "StoreError",
  "StoreLeaseLostError",
  "StoreUnavailableError",
  "StoreTimeoutError",
  "StoreSerializationFailureError",
  "StoreInvalidSchemaError",
  "StoreCorruptedRecordError",
] as const;

const FORBIDDEN_ROOT_DRIVERS = [
  "bun:sqlite",
  "node:sqlite",
  "better-sqlite3",
] as const;

const SRC_ROOT = join(import.meta.dir);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "drivers" || name.endsWith(".test.ts")) continue;
    // Subpath entry files re-export drivers — exclude them from root graph check
    if (name === "bun.ts" || name === "node.ts" || name === "better-sqlite3.ts") {
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

  it("export freeze: no unexpected runtime symbols beyond the frozen list", () => {
    const expected = new Set<string>(EXPECTED_RUNTIME);
    const actual = Object.keys(api).sort();
    for (const name of actual) {
      expect(expected.has(name), `unexpected export: ${name}`).toBe(true);
    }
    // Frozen list has no duplicates
    expect(new Set(EXPECTED_RUNTIME).size).toBe(EXPECTED_RUNTIME.length);
  });

  it("manifest asserts single-host durable strong claims", () => {
    assertStorageAdapterManifest(api.SQLITE_STORAGE_ADAPTER_MANIFEST);
    expect(api.SQLITE_STORAGE_ADAPTER_MANIFEST.name).toBe("sqlite");
    expect(api.SQLITE_STORAGE_ADAPTER_MANIFEST.coordinationScope).toBe("single-host");
    expect(api.SQLITE_STORAGE_ADAPTER_MANIFEST.durability).toBe("durable");
    expect(api.SQLITE_STORAGE_ADAPTER_MANIFEST.consistency.claims).toBe("strong");
    expect(api.SQLITE_STORAGE_ADAPTER_MANIFEST.coordinationScope).not.toBe("multi-host");
    expect(api.SQLITE_STORAGE_ADAPTER_MANIFEST.coordinationScope).not.toBe("multi-region");
    expect(isProductionSafeCoordination(api.SQLITE_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(isStrongClaimAdapter(api.SQLITE_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(api.getSqliteStorageAdapterManifest()).toBe(api.SQLITE_STORAGE_ADAPTER_MANIFEST);
  });

  it("root production graph has no SQLite driver imports", () => {
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
          expect(spec === driver || spec.startsWith(`${driver}/`), `${file} imports ${spec}`).toBe(
            false,
          );
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

describe("namespace validation", () => {
  function stubExecutor() {
    return {
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
  }

  it("rejects invalid tablePrefix on factory", () => {
    expect(() =>
      api.createSqliteIdempotencyStore({
        executor: stubExecutor(),
        namespace: { tablePrefix: "bad-prefix;drop" },
      }),
    ).toThrow();
  });

  it("rejects invalid sqlSchema", () => {
    expect(() =>
      api.createSqliteWebhookInboxStore({
        executor: stubExecutor(),
        namespace: { sqlSchema: "x;--" },
      }),
    ).toThrow();
  });
});
