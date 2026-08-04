/**
 * Public API freeze + root must not import optional drivers + no ./sync export.
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
  "createTursoIdempotencyStore",
  "createTursoWebhookInboxStore",
  "createTursoReconciliationStore",
  "createTursoStores",
  "migrateTursoAdapter",
  "verifyTursoAdapterSchema",
  "TURSO_STORAGE_ADAPTER_MANIFEST",
  "getTursoStorageAdapterManifest",
  "toSqlStoreExecutor",
  "isTursoExecutor",
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
  "@tursodatabase/serverless",
  "@libsql/client",
  "drizzle-orm",
  "@tursodatabase/sync",
] as const;

const SRC_ROOT = join(import.meta.dir);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "drivers" || name.endsWith(".test.ts")) continue;
    // Subpath entry files re-export drivers — exclude them from root graph check
    if (name === "serverless.ts" || name === "libsql.ts") {
      continue;
    }
    // test-utils may load env only; still exclude driver packages there
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

  it("manifest asserts multi-host durable strong claims and honesty notes", () => {
    assertStorageAdapterManifest(api.TURSO_STORAGE_ADAPTER_MANIFEST);
    expect(api.TURSO_STORAGE_ADAPTER_MANIFEST.name).toBe("turso");
    expect(api.TURSO_STORAGE_ADAPTER_MANIFEST.coordinationScope).toBe("multi-host");
    expect(api.TURSO_STORAGE_ADAPTER_MANIFEST.durability).toBe("durable");
    expect(api.TURSO_STORAGE_ADAPTER_MANIFEST.consistency.claims).toBe("strong");
    expect(isProductionSafeCoordination(api.TURSO_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(isStrongClaimAdapter(api.TURSO_STORAGE_ADAPTER_MANIFEST)).toBe(true);
    expect(api.getTursoStorageAdapterManifest()).toBe(api.TURSO_STORAGE_ADAPTER_MANIFEST);

    const notes = api.TURSO_STORAGE_ADAPTER_MANIFEST.notes?.join(" ") ?? "";
    expect(notes.toLowerCase()).toContain("not the same as packages/store-sqlite");
    expect(notes.toLowerCase()).toContain("/sync");
    expect(notes.toLowerCase()).toContain("not advertised");
    // Must not claim untested sync as local-first
    expect(notes.toLowerCase()).not.toMatch(/true local-first sync is supported/i);
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

  it("package.json exports has no ./sync", () => {
    const pkg = JSON.parse(
      readFileSync(join(SRC_ROOT, "../package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };
    expect(pkg.exports["./sync"]).toBeUndefined();
    expect(Object.keys(pkg.exports).sort()).toEqual(
      [".", "./libsql", "./serverless"].sort(),
    );
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
      api.createTursoIdempotencyStore({
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
      api.createTursoWebhookInboxStore({
        executor,
        namespace: { sqlSchema: "x;--" },
      }),
    ).toThrow();
  });
});
