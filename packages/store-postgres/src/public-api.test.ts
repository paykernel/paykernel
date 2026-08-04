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
  "createPostgresIdempotencyStore",
  "createPostgresWebhookInboxStore",
  "createPostgresReconciliationStore",
  "createPostgresStores",
  "migratePostgresAdapter",
  "verifyPostgresAdapterSchema",
  "POSTGRES_STORAGE_ADAPTER_MANIFEST",
  "getPostgresStorageAdapterManifest",
  "toSqlStoreExecutor",
  "isPostgresExecutor",
  "createSystemClock",
  "clockNowIso",
  "clockAddMsIso",
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
  "pg",
  "postgres",
  "drizzle-orm",
  "bun:sql",
  "bun:sqlite",
] as const;

const SRC_ROOT = join(import.meta.dir);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "drivers" || name.endsWith(".test.ts")) continue;
    // Subpath entry files re-export drivers — exclude them from root graph check
    if (
      name === "pg.ts" ||
      name === "postgres-js.ts" ||
      name === "bun-sql.ts" ||
      name === "drizzle.ts"
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

  it("manifest asserts and is production-safe multi-host durable", () => {
    assertStorageAdapterManifest(api.POSTGRES_STORAGE_ADAPTER_MANIFEST);
    expect(api.POSTGRES_STORAGE_ADAPTER_MANIFEST.name).toBe("postgres");
    expect(api.POSTGRES_STORAGE_ADAPTER_MANIFEST.coordinationScope).toBe("multi-host");
    expect(api.POSTGRES_STORAGE_ADAPTER_MANIFEST.durability).toBe("durable");
    expect(api.POSTGRES_STORAGE_ADAPTER_MANIFEST.consistency.claims).toBe("strong");
    expect(isProductionSafeCoordination(api.POSTGRES_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(isStrongClaimAdapter(api.POSTGRES_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(api.getPostgresStorageAdapterManifest()).toBe(api.POSTGRES_STORAGE_ADAPTER_MANIFEST);
  });

  it("root production graph has no optional driver imports", () => {
    // Walk from index.ts relative imports only (production sources excluding drivers/)
    const files = walkTs(SRC_ROOT);
    // Always include index.ts and transitive relative modules under stores/, etc.
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
  it("rejects invalid tablePrefix on factory", () => {
    const executor = {
      async query() {
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    };
    expect(() =>
      api.createPostgresIdempotencyStore({
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
        return { rowCount: 0 };
      },
    };
    expect(() =>
      api.createPostgresWebhookInboxStore({
        executor,
        namespace: { sqlSchema: "x;--" },
      }),
    ).toThrow();
  });
});
