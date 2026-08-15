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

  it("libSQL matrix + guide do not claim a flat distributed yes", () => {
    const libsql = ADAPTER_SELECTION_MATRIX.find(
      (r) => r.rowId === "turso-libsql",
    );
    expect(libsql).toBeDefined();
    expect(libsql!.distributed).not.toBe("yes");
    expect(libsql!.distributed).toBe("yes-remote-local-file-single-host");
    expect(libsql!.importantLimitation).toMatch(/remote multi-host/i);
    expect(libsql!.importantLimitation).toMatch(
      /local file: is single-host testing only/i,
    );
    expect(guide).toMatch(
      /Yes\*{0,2}\s+remote multi-host;\s+local `file:` is single-host testing only/i,
    );
  });

  it("turso-serverless limitation names store-sqlite, not adapter-sqlite", () => {
    const serverless = ADAPTER_SELECTION_MATRIX.find(
      (r) => r.rowId === "turso-serverless",
    );
    expect(serverless).toBeDefined();
    expect(serverless!.importantLimitation).not.toMatch(/adapter-sqlite/);
    expect(serverless!.importantLimitation).toMatch(
      /store-sqlite|@paykernel\/store-sqlite/,
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

type MermaidEdge = { from: string; via: string; to: string };

function stripMermaidMarkup(s: string): string {
  return s.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
}

function extractMermaidBlock(guide: string): string {
  const m = guide.match(/```mermaid\n([\s\S]*?)```/);
  if (!m) throw new Error("docs/adapter-selection.md is missing a mermaid block");
  return m[1]!;
}

function extractNumberedQa(guide: string): string {
  const m = guide.match(
    /### 3\.2 Numbered questions[\s\S]*?(?=\n---\n|\n## 4\))/,
  );
  if (!m) throw new Error("docs/adapter-selection.md is missing §3.2 numbered Q&A");
  return m[0]!;
}

function parseMermaidGraph(src: string): {
  nodes: Map<string, string>;
  edges: MermaidEdge[];
} {
  const nodes = new Map<string, string>();
  const edges: MermaidEdge[] = [];
  const nodeRe =
    /(\w+)(?:\["([^"]+)"\]|\{([^}]+)\}|\(\[([^\]]+)\]\))/g;
  const edgeRe = /(\w+)\s*(?:-->|-.->)(?:\|([^|]+)\|)?\s*(\w+)/g;

  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("flowchart") || line.startsWith("%%")) {
      continue;
    }
    for (const m of line.matchAll(nodeRe)) {
      nodes.set(m[1]!, stripMermaidMarkup(m[2] ?? m[3] ?? m[4] ?? ""));
    }
    for (const m of line.matchAll(edgeRe)) {
      edges.push({
        from: m[1]!,
        via: stripMermaidMarkup(m[2] ?? ""),
        to: m[3]!,
      });
    }
  }
  return { nodes, edges };
}

function reachableFrom(
  edges: MermaidEdge[],
  start: string,
  skip?: (edge: MermaidEdge) => boolean,
): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of edges) {
      if (edge.from !== id) continue;
      if (skip?.(edge)) continue;
      stack.push(edge.to);
    }
  }
  return seen;
}

describe("docs/adapter-selection.md decision tree — Workers / fail-closed", () => {
  const guidePath = join(
    import.meta.dir,
    "..",
    "docs",
    "adapter-selection.md",
  );
  const guide = readFileSync(guidePath, "utf8");
  const mermaid = extractMermaidBlock(guide);
  const qa = extractNumberedQa(guide);
  const graph = parseMermaidGraph(mermaid);

  it("after Q1 no-postgres, Workers Yes path is D1 or DO — never store-sqlite or Turso", () => {
    const q1 = [...graph.nodes.entries()].find(([, label]) =>
      /Existing PostgreSQL/i.test(label),
    );
    expect(q1).toBeDefined();
    const q1No = graph.edges.find(
      (e) => e.from === q1![0] && /^No$/i.test(e.via),
    );
    expect(q1No).toBeDefined();

    const workersId = q1No!.to;
    const workersLabel = graph.nodes.get(workersId) ?? "";
    expect(workersLabel).toMatch(/Cloudflare Workers/i);
    // Must not hide DO (or greenfield D1) behind "already on D1".
    expect(workersLabel).not.toMatch(/already on D1/i);

    const workersYes = graph.edges.find(
      (e) => e.from === workersId && /^Yes$/i.test(e.via),
    );
    expect(workersYes).toBeDefined();

    const yesReachable = reachableFrom(graph.edges, workersYes!.to);
    yesReachable.add(workersYes!.to);
    const yesLabels = [...yesReachable].map(
      (id) => graph.nodes.get(id) ?? id,
    );
    const yesBlob = yesLabels.join("\n");

    expect(yesBlob).toMatch(/store-d1/i);
    expect(yesBlob).toMatch(/store-durable-objects/i);
    expect(yesBlob).not.toMatch(/store-sqlite/i);
    expect(yesBlob).not.toMatch(/store-turso/i);
  });

  it("Workers Yes path can still reach DO when already on D1 (per-key not hidden)", () => {
    const q1 = [...graph.nodes.entries()].find(([, label]) =>
      /Existing PostgreSQL/i.test(label),
    );
    const q1No = graph.edges.find(
      (e) => e.from === q1![0] && /^No$/i.test(e.via),
    );
    const workersYes = graph.edges.find(
      (e) => e.from === q1No!.to && /^Yes$/i.test(e.via),
    );
    const yesReachable = reachableFrom(graph.edges, workersYes!.to);
    yesReachable.add(workersYes!.to);

    const doNode = [...yesReachable].find((id) =>
      /store-durable-objects/i.test(graph.nodes.get(id) ?? ""),
    );
    expect(doNode).toBeDefined();
    expect(graph.nodes.get(doNode!) ?? "").toMatch(/never global/i);

    const pathLabels = [...yesReachable]
      .map((id) => graph.nodes.get(id) ?? "")
      .concat(graph.edges.filter((e) => yesReachable.has(e.from)).map((e) => e.via))
      .join(" ");
    expect(pathLabels).toMatch(/per-key|per-partition/i);
    expect(pathLabels).toMatch(/already on D1/i);
  });

  it("fail-closed STOP covers multi-isolate + only local file", () => {
    const stop = [...graph.nodes.entries()].find(
      ([id, label]) => id === "STOP" || /FAIL-CLOSED/i.test(label),
    );
    expect(stop).toBeDefined();
    const incoming = graph.edges.filter((e) => e.to === stop![0]);
    const context = [stop![1], ...incoming.map((e) => e.via)].join(" ");
    expect(context).toMatch(/multi-isolate/i);
    expect(context).toMatch(/local file|local SQLite/i);
    expect(qa).toMatch(/multi-isolate/i);
    expect(qa).toMatch(/FAIL-CLOSED/i);
  });

  it("numbered Q&A: Workers get D1 or DO, never store-sqlite; greenfield default is D1", () => {
    const q2 = qa.match(
      /2\.\s+\*\*Cloudflare Workers[\s\S]*?(?=\n\d+\.\s|\n\*\*Fail-closed)/,
    );
    expect(q2).toBeTruthy();
    const block = q2![0];
    expect(block).toMatch(/@paykernel\/store-d1/);
    expect(block).toMatch(/@paykernel\/store-durable-objects/);
    expect(block).toMatch(/Worker-native/i);
    expect(block).toMatch(/never.*store-sqlite|not.*@paykernel\/store-sqlite/i);
    expect(block).not.toMatch(/@paykernel\/store-turso/);
    expect(block).toMatch(
      /already (?:on|use|using) D1|including if you already/i,
    );
    expect(block).toMatch(/Never.*global Durable Object|never global/i);
  });
});
