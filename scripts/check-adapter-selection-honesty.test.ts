/**
 * Phase 18 live honesty cross-check:
 * frozen selection matrix cells vs each production adapter’s StorageAdapterManifest.
 *
 * Runs at monorepo root so adapter packages may be imported (testkit must not
 * depend on adapters). Keep assertions high-signal: coordinationScope, durability,
 * claims, readAfterWrite, staleReadsPossible, redis optional, no multi-region.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Relative imports: root package.json does not list workspace deps; bun resolves
// adapter package names only from packages that depend on them.
import { POSTGRES_STORAGE_ADAPTER_MANIFEST } from "../packages/store-postgres/src/manifest";
import { REDIS_STORAGE_ADAPTER_MANIFEST } from "../packages/store-redis/src/manifest";
import { SQLITE_STORAGE_ADAPTER_MANIFEST } from "../packages/store-sqlite/src/manifest";
import { TURSO_STORAGE_ADAPTER_MANIFEST } from "../packages/store-turso/src/manifest";
import { D1_STORAGE_ADAPTER_MANIFEST } from "../packages/store-d1/src/manifest";
import { DO_STORAGE_ADAPTER_MANIFEST } from "../packages/store-durable-objects/src/manifest";
import {
  ADAPTER_SELECTION_MATRIX,
  PRODUCTION_MANIFEST_NAMES,
  durableAuditFromDurability,
  type AdapterSelectionMatrixRow,
} from "../packages/testkit/src/storage/adapter-selection-matrix";
import {
  MEMORY_STORAGE_ADAPTER_MANIFEST,
  assertStorageAdapterManifest,
  type StorageAdapterManifest,
} from "../packages/testkit/src/storage/adapter-manifest";

const LIVE_MANIFESTS: Record<string, StorageAdapterManifest> = {
  postgres: POSTGRES_STORAGE_ADAPTER_MANIFEST,
  redis: REDIS_STORAGE_ADAPTER_MANIFEST,
  sqlite: SQLITE_STORAGE_ADAPTER_MANIFEST,
  turso: TURSO_STORAGE_ADAPTER_MANIFEST,
  "cloudflare-d1": D1_STORAGE_ADAPTER_MANIFEST,
  "cloudflare-do": DO_STORAGE_ADAPTER_MANIFEST,
  memory: MEMORY_STORAGE_ADAPTER_MANIFEST,
};

function rowsForManifest(name: string): AdapterSelectionMatrixRow[] {
  return ADAPTER_SELECTION_MATRIX.filter((r) => r.manifestName === name);
}

describe("live manifests exist and validate", () => {
  it("covers every production manifest name + memory", () => {
    for (const name of PRODUCTION_MANIFEST_NAMES) {
      expect(LIVE_MANIFESTS[name]).toBeDefined();
      assertStorageAdapterManifest(LIVE_MANIFESTS[name]);
    }
    assertStorageAdapterManifest(MEMORY_STORAGE_ADAPTER_MANIFEST);
  });

  it("no live production manifest declares multi-region", () => {
    for (const name of PRODUCTION_MANIFEST_NAMES) {
      expect(LIVE_MANIFESTS[name]!.coordinationScope).not.toBe("multi-region");
    }
  });
});

describe("matrix rows match live manifest fields", () => {
  for (const manifestName of [...PRODUCTION_MANIFEST_NAMES, "memory"] as const) {
    it(`${manifestName}: coordinationScope / durability / claims / RAW / stale`, () => {
      const live = LIVE_MANIFESTS[manifestName]!;
      const rows = rowsForManifest(manifestName);
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.coordinationScope).toBe(live.coordinationScope);
        expect(row.durability).toBe(live.durability);
        expect(row.durableAudit).toBe(
          durableAuditFromDurability(live.durability),
        );
        expect(row.readAfterWrite).toBe(live.consistency.readAfterWrite);
        expect(row.staleReadsPossible).toBe(live.consistency.staleReadsPossible);
        expect(live.consistency.claims).toBe("strong");
        expect(row.atomicClaim).toBe(true);
        expect(live.name).toBe(manifestName);
      }
    });
  }
});

describe("specific honesty cells vs live manifests", () => {
  it("sqlite is single-host durable strong (never multi-host in matrix)", () => {
    const m = SQLITE_STORAGE_ADAPTER_MANIFEST;
    expect(m.coordinationScope).toBe("single-host");
    expect(m.durability).toBe("durable");
    for (const row of rowsForManifest("sqlite")) {
      expect(row.isLocalSqlite).toBe(true);
      expect(row.distributed).toBe("no");
      expect(row.coordinationScope).toBe("single-host");
    }
  });

  it("redis is multi-host configuration-dependent and optional", () => {
    const m = REDIS_STORAGE_ADAPTER_MANIFEST;
    expect(m.coordinationScope).toBe("multi-host");
    expect(m.durability).toBe("configuration-dependent");
    for (const row of rowsForManifest("redis")) {
      expect(row.redisOptional).toBe(true);
      expect(row.durableAudit).toBe("configuration-dependent");
    }
  });

  it("postgres is multi-host durable strong", () => {
    const m = POSTGRES_STORAGE_ADAPTER_MANIFEST;
    expect(m.coordinationScope).toBe("multi-host");
    expect(m.durability).toBe("durable");
    expect(m.consistency.staleReadsPossible).toBe(false);
  });

  it("turso is multi-host durable (not local sqlite)", () => {
    const m = TURSO_STORAGE_ADAPTER_MANIFEST;
    expect(m.coordinationScope).toBe("multi-host");
    expect(m.durability).toBe("durable");
    for (const row of rowsForManifest("turso")) {
      expect(row.isLocalSqlite).toBe(false);
    }
  });

  it("d1 is multi-host durable with session RAW + staleReadsPossible", () => {
    const m = D1_STORAGE_ADAPTER_MANIFEST;
    expect(m.coordinationScope).toBe("multi-host");
    expect(m.durability).toBe("durable");
    expect(m.consistency.readAfterWrite).toBe("session");
    expect(m.consistency.staleReadsPossible).toBe(true);
  });

  it("do is multi-host durable partitioned in matrix (manifest multi-host)", () => {
    const m = DO_STORAGE_ADAPTER_MANIFEST;
    expect(m.coordinationScope).toBe("multi-host");
    expect(m.durability).toBe("durable");
    expect(m.consistency.readAfterWrite).toBe("strong");
    expect(m.consistency.staleReadsPossible).toBe(false);
    const rows = rowsForManifest("cloudflare-do");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partitioned).toBe(true);
    expect(rows[0]!.distributed).toBe("yes-partitioned");
  });

  it("memory is single-process ephemeral NON-PRODUCTION", () => {
    const m = MEMORY_STORAGE_ADAPTER_MANIFEST;
    expect(m.coordinationScope).toBe("single-process");
    expect(m.durability).toBe("ephemeral");
    const rows = rowsForManifest("memory");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.productionRecommended).toBe(false);
    expect(rows[0]!.isMemory).toBe(true);
  });
});

describe("docs/adapter-capability-matrix.json stays in sync with TS matrix", () => {
  it("JSON rows match ADAPTER_SELECTION_MATRIX rowIds and key honesty fields", () => {
    const jsonPath = join(
      import.meta.dir,
      "..",
      "docs",
      "adapter-capability-matrix.json",
    );
    const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      redisRequired: boolean;
      noMultiRegionAdapters: boolean;
      rows: AdapterSelectionMatrixRow[];
    };

    expect(doc.redisRequired).toBe(false);
    expect(doc.noMultiRegionAdapters).toBe(true);
    expect(doc.rows.map((r) => r.rowId)).toEqual(
      ADAPTER_SELECTION_MATRIX.map((r) => r.rowId),
    );

    for (let i = 0; i < ADAPTER_SELECTION_MATRIX.length; i++) {
      const ts = ADAPTER_SELECTION_MATRIX[i]!;
      const js = doc.rows[i]!;
      expect(js.manifestName).toBe(ts.manifestName);
      expect(js.coordinationScope).toBe(ts.coordinationScope);
      expect(js.durability).toBe(ts.durability);
      expect(js.durableAudit).toBe(ts.durableAudit);
      expect(js.distributed).toBe(ts.distributed);
      expect(js.partitioned).toBe(ts.partitioned);
      expect(js.redisOptional).toBe(ts.redisOptional);
      expect(js.isLocalSqlite).toBe(ts.isLocalSqlite);
      expect(js.isMemory).toBe(ts.isMemory);
      expect(js.readAfterWrite).toBe(ts.readAfterWrite);
      expect(js.staleReadsPossible).toBe(ts.staleReadsPossible);
      expect(js.atomicClaim).toBe(ts.atomicClaim);
      expect(js.productionRecommended).toBe(ts.productionRecommended);
    }
  });
});

/**
 * Residual prose-drift guard: high-signal honesty phrases + package labels in
 * the human guide. Does not re-check matrix↔manifest cells (covered above) and
 * does not parse full markdown tables cell-by-cell.
 */
describe("docs/adapter-selection.md honesty phrases match matrix", () => {
  const guidePath = join(
    import.meta.dir,
    "..",
    "docs",
    "adapter-selection.md",
  );
  const guide = readFileSync(guidePath, "utf8");

  it("lists every matrix packageName so a removed adapter row cannot hide in docs", () => {
    const packageNames = new Set(
      ADAPTER_SELECTION_MATRIX.map((row) => row.packageName),
    );
    for (const packageName of packageNames) {
      expect(guide).toContain(packageName);
    }
  });

  it("states Redis is optional and not required infrastructure", () => {
    expect(guide).toMatch(/Redis is optional/i);
    // Guide uses markdown emphasis: "do **not** need Redis"
    expect(guide).toMatch(/do \*{0,2}not\*{0,2} need Redis/i);
    expect(guide).toMatch(/Do not add Redis only for PayKernel/i);
  });

  it("states local SQLite is single-host with fail-closed multi-host refusal", () => {
    expect(guide).toMatch(/Local SQLite is single-host only/i);
    expect(guide).toMatch(/No — single host/i);
    expect(guide).toMatch(/FAIL-CLOSED/i);
  });

  it("states D1 session read-after-write and possible stale reads", () => {
    expect(guide).toContain('readAfterWrite: "session"');
    expect(guide).toContain("staleReadsPossible: true");
  });

  it("states DO is partitioned, requires sharding, never one global object", () => {
    expect(guide).toMatch(/Yes, partitioned/i);
    expect(guide).toMatch(/never.*one global DO|Never.*global Durable Object/i);
    expect(guide).toMatch(/Requires sharding|sharding required/i);
  });

  it("states memory is NON-PRODUCTION single-process ephemeral", () => {
    expect(guide).toMatch(/NON-PRODUCTION/i);
    expect(guide).toContain("`single-process`");
    expect(guide).toContain("`ephemeral`");
  });

  it("bans inventing multi-region coordinationScope", () => {
    expect(guide).toMatch(
      /No published adapter declares `coordinationScope: "multi-region"`/i,
    );
  });

  it("bans advertising Turso /sync export", () => {
    expect(guide).toMatch(/no.*`?\/sync`? export|no.*`\.\/sync`/i);
  });

  it("documents Bun Redis Cluster and Sentinel rejection", () => {
    expect(guide).toMatch(
      /Bun.*rejects.*Cluster\/Sentinel|Bun: no Cluster\/Sentinel/i,
    );
  });

  it("cheat sheet lists each manifest family with its matrix coordinationScope", () => {
    // Matrix is the only honesty source; guide must still show that scope per family.
    const families: Array<{ manifestName: string; guideLabel: string }> = [
      { manifestName: "postgres", guideLabel: "postgres" },
      { manifestName: "redis", guideLabel: "redis" },
      { manifestName: "sqlite", guideLabel: "sqlite" },
      { manifestName: "turso", guideLabel: "turso" },
      { manifestName: "cloudflare-d1", guideLabel: "cloudflare-d1" },
      { manifestName: "cloudflare-do", guideLabel: "cloudflare-do" },
      { manifestName: "memory", guideLabel: "memory" },
    ];

    for (const { manifestName, guideLabel } of families) {
      const rows = rowsForManifest(manifestName);
      expect(rows.length).toBeGreaterThan(0);
      const scope = rows[0]!.coordinationScope;
      // Cheat-sheet / table cell shape: label … | `scope`
      const rowPattern = new RegExp(
        `${guideLabel}[^\\n]*\\|\\s*\`${scope}\``,
        "i",
      );
      expect(guide).toMatch(rowPattern);
    }
  });
});
