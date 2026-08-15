/**
 * Honesty guards for the Phase 18 frozen selection matrix.
 *
 * These tests do **not** import adapter packages (testkit must stay portable and
 * free of adapter deps). Live manifest cross-checks run at the monorepo root:
 * `scripts/check-adapter-selection-honesty.test.ts`.
 */
import { describe, expect, it } from "bun:test";
import {
  ADAPTER_SELECTION_MATRIX,
  PRODUCTION_ADAPTER_PACKAGE_NAMES,
  PRODUCTION_MANIFEST_NAMES,
  ROADMAP_PRODUCTION_MATRIX_ROW_IDS,
  durableAuditFromDurability,
  forbidsMultiHostMarketing,
  type AdapterSelectionMatrixRow,
} from "./adapter-selection-matrix";
import { MEMORY_STORAGE_ADAPTER_MANIFEST } from "./adapter-manifest";

function byId(id: string): AdapterSelectionMatrixRow {
  const row = ADAPTER_SELECTION_MATRIX.find((r) => r.rowId === id);
  if (!row) throw new Error(`missing matrix row: ${id}`);
  return row;
}

describe("ADAPTER_SELECTION_MATRIX coverage", () => {
  it("includes every roadmap Initial Matrix production row", () => {
    const ids = new Set(ADAPTER_SELECTION_MATRIX.map((r) => r.rowId));
    for (const id of ROADMAP_PRODUCTION_MATRIX_ROW_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("includes unique production adapter packages (six)", () => {
    const pkgs = new Set(
      ADAPTER_SELECTION_MATRIX.filter((r) => !r.isMemory).map((r) => r.packageName),
    );
    expect([...pkgs].sort()).toEqual([...PRODUCTION_ADAPTER_PACKAGE_NAMES].sort());
    expect(pkgs.size).toBe(6);
  });

  it("covers every production manifest name exactly once in the set", () => {
    // Multiple rows may share a package (sqlite×3, redis×2, turso×2);
    // manifest names collapse to one per package.
    const names = new Set(
      ADAPTER_SELECTION_MATRIX.filter((r) => !r.isMemory).map((r) => r.manifestName),
    );
    expect([...names].sort()).toEqual([...PRODUCTION_MANIFEST_NAMES].sort());
    expect(names.size).toBe(PRODUCTION_MANIFEST_NAMES.length);
  });

  it("has unique rowIds", () => {
    const ids = ADAPTER_SELECTION_MATRIX.map((r) => r.rowId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes memory NON-PRODUCTION row", () => {
    const mem = byId("memory");
    expect(mem.isMemory).toBe(true);
    expect(mem.productionRecommended).toBe(false);
    expect(mem.coordinationScope).toBe("single-process");
    expect(mem.durability).toBe("ephemeral");
    expect(mem.durableAudit).toBe("no");
    expect(mem.distributed).toBe("no");
    expect(mem.importantLimitation).toMatch(/NON-PRODUCTION/i);
  });
});

describe("ADAPTER_SELECTION_MATRIX honesty — local SQLite", () => {
  it("never claims multi-host / multi-region for local sqlite rows", () => {
    const sqliteRows = ADAPTER_SELECTION_MATRIX.filter((r) => r.isLocalSqlite);
    expect(sqliteRows.length).toBe(3);
    for (const row of sqliteRows) {
      expect(row.manifestName).toBe("sqlite");
      expect(row.packageName).toBe("@paykernel/store-sqlite");
      expect(row.coordinationScope).toBe("single-host");
      expect(row.distributed).toBe("no");
      expect(row.partitioned).toBe(false);
      expect(forbidsMultiHostMarketing(row)).toBe(true);
      // Fail closed: durableAudit may be yes (file-backed) but never multi-host.
      expect(row.durability).toBe("durable");
    }
  });
});

describe("ADAPTER_SELECTION_MATRIX honesty — Redis optional", () => {
  it("marks Redis/Upstash rows as optional (never required)", () => {
    const redisRows = ADAPTER_SELECTION_MATRIX.filter(
      (r) => r.manifestName === "redis",
    );
    expect(redisRows.length).toBe(2);
    for (const row of redisRows) {
      expect(row.redisOptional).toBe(true);
      expect(row.packageName).toBe("@paykernel/store-redis");
      expect(row.durability).toBe("configuration-dependent");
      expect(row.durableAudit).toBe("configuration-dependent");
      expect(row.coordinationScope).toBe("multi-host");
    }
    // Bun Cluster caveat only on native redis row, not Upstash.
    expect(byId("redis-native").distributed).toBe(
      "yes-except-bun-cluster-sentinel",
    );
    expect(byId("redis-upstash").distributed).toBe("yes");
    expect(byId("redis-upstash").subpath).toBe("upstash");
  });

  it("does not mark any non-redis production adapter as redis-required", () => {
    for (const row of ADAPTER_SELECTION_MATRIX) {
      if (row.manifestName === "redis") {
        expect(row.redisOptional).toBe(true);
      } else {
        // redisOptional is a property of redis rows; others stay false.
        expect(row.redisOptional).toBe(false);
      }
    }
  });
});

describe("ADAPTER_SELECTION_MATRIX honesty — D1 / DO / Turso / multi-region", () => {
  it("D1 declares session RAW and possible stale reads", () => {
    const d1 = byId("cloudflare-d1");
    expect(d1.coordinationScope).toBe("multi-host");
    expect(d1.readAfterWrite).toBe("session");
    expect(d1.staleReadsPossible).toBe(true);
    expect(d1.partitioned).toBe(false);
    expect(d1.distributed).toBe("yes");
  });

  it("DO is multi-host partitioned — never global / multi-region", () => {
    const dO = byId("cloudflare-do");
    expect(dO.coordinationScope).toBe("multi-host");
    expect(dO.partitioned).toBe(true);
    expect(dO.distributed).toBe("yes-partitioned");
    expect(dO.importantLimitation).toMatch(/sharding|global DO/i);
  });

  it("Turso serverless is multi-host remote (not local sqlite)", () => {
    const row = byId("turso-serverless");
    expect(row.manifestName).toBe("turso");
    expect(row.isLocalSqlite).toBe(false);
    expect(row.coordinationScope).toBe("multi-host");
    expect(row.distributed).toBe("yes");
    expect(row.importantLimitation).toMatch(/no \/sync/i);
    expect(row.importantLimitation).not.toMatch(/adapter-sqlite/);
    expect(row.importantLimitation).toMatch(
      /store-sqlite|@paykernel\/store-sqlite/,
    );
  });

  it("libSQL does not claim flat distributed yes (file: is single-host testing only)", () => {
    const row = byId("turso-libsql");
    expect(row.manifestName).toBe("turso");
    expect(row.isLocalSqlite).toBe(false);
    expect(row.coordinationScope).toBe("multi-host");
    // Binding also opens file:; a flat "yes" would overclaim local-file deployments.
    expect(row.distributed).not.toBe("yes");
    expect(row.distributed).toBe("yes-remote-local-file-single-host");
    expect(row.importantLimitation).toMatch(/remote multi-host/i);
    expect(row.importantLimitation).toMatch(
      /local file: is single-host testing only/i,
    );
    expect(row.importantLimitation).toMatch(/no \/sync/i);
  });

  it("never invents multi-region coordinationScope", () => {
    for (const row of ADAPTER_SELECTION_MATRIX) {
      expect(row.coordinationScope).not.toBe("multi-region");
    }
  });
});

describe("ADAPTER_SELECTION_MATRIX honesty — durableAudit mapping + atomic claims", () => {
  it("durableAudit matches durability helper for every row", () => {
    for (const row of ADAPTER_SELECTION_MATRIX) {
      expect(row.durableAudit).toBe(durableAuditFromDurability(row.durability));
    }
  });

  it("all rows declare atomicClaim (strong claims model)", () => {
    for (const row of ADAPTER_SELECTION_MATRIX) {
      expect(row.atomicClaim).toBe(true);
    }
  });

  it("memory row agrees with MEMORY_STORAGE_ADAPTER_MANIFEST fields", () => {
    const mem = byId("memory");
    const m = MEMORY_STORAGE_ADAPTER_MANIFEST;
    expect(mem.manifestName).toBe(m.name);
    expect(mem.coordinationScope).toBe(m.coordinationScope);
    expect(mem.durability).toBe(m.durability);
    expect(mem.readAfterWrite).toBe(m.consistency.readAfterWrite);
    expect(mem.staleReadsPossible).toBe(m.consistency.staleReadsPossible);
    expect(m.consistency.claims).toBe("strong");
  });
});
