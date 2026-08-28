#!/usr/bin/env bun
/**
 * check-compat.ts
 *
 * Phase 25 compatibility gate — fails on undocumented public-API or persisted-schema drift.
 * Regenerates inventories in memory and deep-equals against committed JSON.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FOUNDATION_SQL_POSTGRES as FOUNDATION_SQL_POSTGRES_SRC,
  FOUNDATION_SQL_SQLITE as FOUNDATION_SQL_SQLITE_SRC,
  LIST_INDEX_SQL_POSTGRES as LIST_INDEX_SQL_POSTGRES_SRC,
  LIST_INDEX_SQL_SQLITE as LIST_INDEX_SQL_SQLITE_SRC,
  buildFoundationMigrationSql,
  buildListIndexMigrationSql,
} from "../packages/sql-foundation/src/migrations/definitions.ts";
import { CURRENT_SCHEMA_VERSION, SCHEMA_FAMILY } from "../packages/sql-foundation/src/schema/versions.ts";
import {
  ALL_LOGICAL_TABLES,
  IDEMPOTENCY_COLUMNS,
  IDEMPOTENCY_STATUSES,
  RECONCILIATION_COLUMNS,
  RECONCILIATION_STATUSES,
  WEBHOOK_INBOX_COLUMNS,
  WEBHOOK_INBOX_STATUSES,
} from "../packages/sql-foundation/src/schema/tables.ts";
import { MIGRATIONS } from "../packages/sql-foundation/src/migrations/metadata.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const CORE = join(ROOT, "packages", "core");
const SRC_INDEX = join(CORE, "src", "index.ts");
const DIST_INDEX_JS = join(CORE, "dist", "index.js");
const DIST_INDEX_DTS = join(CORE, "dist", "index.d.ts");
const PACKAGE_JSON = join(CORE, "package.json");
const CORE_INVENTORY_PATH = join(CORE, "docs", "baseline", "public-api.inventory.json");
const SCHEMA_INVENTORY_PATH = join(ROOT, "packages", "sql-foundation", "docs", "baseline", "schema.inventory.json");

type ParsedExports = {
  typeOnly: string[];
  valueExports: string[];
};

function resolveExportName(part: string): string | null {
  if (!part) return null;
  const asMatch = /^(.+?)\s+as\s+(.+)$/.exec(part);
  if (asMatch) return asMatch[2]!.trim();
  const name = part.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  return name;
}

function splitExportNames(inner: string): string[] {
  return inner
    .split(",")
    .map((s) => resolveExportName(s.trim()))
    .filter((n): n is string => Boolean(n));
}

function parseIndexExports(source: string): ParsedExports {
  const typeOnly = new Set<string>();
  const valueExports = new Set<string>();
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // H9 — forbid star exports in root barrel
  const starExportRe = /export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*["'][^"']+["']/g;
  const starHit = starExportRe.exec(stripped);
  if (starHit) {
    throw new Error(
      `Forbidden star export in src/index.ts: "${starHit[0]}" — expand to named exports (export { A, B } from "...")`,
    );
  }
  if (/export\s*\*/.test(stripped)) {
    throw new Error(
      "Forbidden star export in src/index.ts — export * is not allowed in the root barrel. Use named re-exports.",
    );
  }
  const typeExportRe = /export\s+type\s*\{([^}]+)\}(?:\s*from\s*["'][^"']+["'])?/g;
  const valueExportRe = /export\s*\{([^}]+)\}(?:\s*from\s*["'][^"']+["'])?/g;
  let match: RegExpExecArray | null;
  while ((match = typeExportRe.exec(stripped)) !== null) {
    for (const name of splitExportNames(match[1]!)) {
      typeOnly.add(name);
    }
  }
  while ((match = valueExportRe.exec(stripped)) !== null) {
    const full = match[0]!;
    if (/^export\s+type\s*\{/.test(full)) continue;
    for (const raw of match[1]!.split(",")) {
      const part = raw.trim();
      if (!part) continue;
      const typeMember = /^type\s+(.+)$/.exec(part);
      if (typeMember) {
        const name = resolveExportName(typeMember[1]!);
        if (name) typeOnly.add(name);
        continue;
      }
      const name = resolveExportName(part);
      if (name) valueExports.add(name);
    }
  }
  const declRe = /export\s+(?:async\s+)?(?:declare\s+)?(?:abstract\s+)?(class|function|const|let|var|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  while ((match = declRe.exec(stripped)) !== null) {
    const kind = match[1]!;
    const name = match[2]!;
    if (kind === "interface" || kind === "type") typeOnly.add(name);
    else valueExports.add(name);
  }
  return {
    typeOnly: [...typeOnly].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    valueExports: [...valueExports].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

function walkDtsFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walkDtsFiles(full, base));
      } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
        out.push(relative(base, full).split("\\").join("/"));
      }
    }
  } catch {
    // dir missing — return empty; caller will hash empty set
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export type CoreInventory = {
  runtime: string[];
  typeOnly: string[];
  paymentEventSchemaVersion: string;
  stablePaymentEventTypes: string[];
  dtsHash: string;
  exportsHash: string;
};

export async function generateCoreInventory(): Promise<CoreInventory | null> {
  if (!existsSync(DIST_INDEX_JS)) {
    console.warn(`[check-compat] SKIP core inventory: missing ${DIST_INDEX_JS} — run bun run build first (CI always has dist)`);
    return null;
  }
  if (!existsSync(SRC_INDEX)) {
    throw new Error(`Missing ${SRC_INDEX}`);
  }
  const source = readFileSync(SRC_INDEX, "utf8");
  const parsed = parseIndexExports(source);
  const mod = (await import(pathToFileURL(DIST_INDEX_JS).href)) as Record<string, unknown>;
  const runtimeNames = [...parsed.valueExports].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const typeOnlyNames = [...parsed.typeOnly].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const paymentEventSchemaVersion = String(mod["PAYMENT_EVENT_SCHEMA_VERSION"] ?? "1");
  const rawStable = mod["STABLE_PAYMENT_EVENT_TYPES"];
  const stablePaymentEventTypes = Array.isArray(rawStable) ? [...(rawStable as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  // H9 — type-shape gap: hash d.ts + exports map (must match generate-api-baseline.ts)
  const dtsFiles = walkDtsFiles(join(CORE, "dist"));
  const dtsHash = (() => {
    const h = createHash("sha256");
    for (const rel of dtsFiles) {
      h.update(rel);
      h.update("\0");
      try {
        h.update(readFileSync(join(CORE, "dist", rel)));
      } catch {
        h.update("__MISSING__");
      }
      h.update("\0");
    }
    return h.digest("hex");
  })();
  const exportsHash = (() => {
    try {
      const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as Record<string, unknown>;
      const normalized = {
        exports: pkg.exports ?? null,
        main: pkg.main ?? null,
        type: pkg.type ?? null,
        types: pkg.types ?? null,
      };
      return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    } catch {
      // If package.json missing, hash empty sentinel — will mismatch and fail closed
      return createHash("sha256").update("__MISSING_PACKAGE_JSON__").digest("hex");
    }
  })();
  return {
    runtime: runtimeNames,
    typeOnly: typeOnlyNames,
    paymentEventSchemaVersion,
    stablePaymentEventTypes,
    dtsHash,
    exportsHash,
  };
}

export type SchemaInventory = {
  schemaFamily: string;
  currentVersion: number;
  migrations: Array<{ version: number; checksum: string | undefined }>;
  logicalTables: string[];
  idempotencyColumns: string[];
  webhookInboxColumns: string[];
  reconciliationColumns: string[];
  idempotencyStatuses: string[];
  webhookInboxStatuses: string[];
  reconciliationStatuses: string[];
  FOUNDATION_SQL_POSTGRES: string;
  FOUNDATION_SQL_SQLITE: string;
  LIST_INDEX_SQL_POSTGRES: string;
  LIST_INDEX_SQL_SQLITE: string;
};

export function generateSchemaInventory(): SchemaInventory {
  const schemaFamily: string = SCHEMA_FAMILY ?? "payments-storage";
  const currentVersion: number = CURRENT_SCHEMA_VERSION;
  const migrations = (MIGRATIONS as Array<{ version: number; checksum?: string }>)
    .map((m) => ({ version: m.version, checksum: m.checksum }))
    .sort((a, b) => a.version - b.version);
  const logicalTables: string[] = [...(ALL_LOGICAL_TABLES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  function sortedColumnValues(obj: Record<string, string>): string[] {
    return Object.values(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  const idempotencyColumns = sortedColumnValues(IDEMPOTENCY_COLUMNS as unknown as Record<string, string>);
  const webhookInboxColumns = sortedColumnValues(WEBHOOK_INBOX_COLUMNS as unknown as Record<string, string>);
  const reconciliationColumns = sortedColumnValues(RECONCILIATION_COLUMNS as unknown as Record<string, string>);
  const idempotencyStatuses = [...(IDEMPOTENCY_STATUSES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const webhookInboxStatuses = [...(WEBHOOK_INBOX_STATUSES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const reconciliationStatuses = [...(RECONCILIATION_STATUSES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  let FOUNDATION_SQL_POSTGRES: string | undefined = FOUNDATION_SQL_POSTGRES_SRC as string | undefined;
  let FOUNDATION_SQL_SQLITE: string | undefined = FOUNDATION_SQL_SQLITE_SRC as string | undefined;
  let LIST_INDEX_SQL_POSTGRES: string | undefined = LIST_INDEX_SQL_POSTGRES_SRC as string | undefined;
  let LIST_INDEX_SQL_SQLITE: string | undefined = LIST_INDEX_SQL_SQLITE_SRC as string | undefined;
  if (!FOUNDATION_SQL_POSTGRES || !FOUNDATION_SQL_SQLITE || !LIST_INDEX_SQL_POSTGRES || !LIST_INDEX_SQL_SQLITE) {
    const defaultQualify = (logical: string) => `"${logical}"`;
    FOUNDATION_SQL_POSTGRES = FOUNDATION_SQL_POSTGRES ?? buildFoundationMigrationSql("postgres", defaultQualify);
    FOUNDATION_SQL_SQLITE = FOUNDATION_SQL_SQLITE ?? buildFoundationMigrationSql("sqlite", defaultQualify);
    LIST_INDEX_SQL_POSTGRES = LIST_INDEX_SQL_POSTGRES ?? buildListIndexMigrationSql(defaultQualify);
    LIST_INDEX_SQL_SQLITE = LIST_INDEX_SQL_SQLITE ?? buildListIndexMigrationSql(defaultQualify);
  }
  if (!FOUNDATION_SQL_POSTGRES || !FOUNDATION_SQL_SQLITE || !LIST_INDEX_SQL_POSTGRES || !LIST_INDEX_SQL_SQLITE) {
    throw new Error("Missing FOUNDATION_SQL_* / LIST_INDEX_SQL_*");
  }
  return {
    schemaFamily,
    currentVersion,
    migrations,
    logicalTables,
    idempotencyColumns,
    webhookInboxColumns,
    reconciliationColumns,
    idempotencyStatuses,
    webhookInboxStatuses,
    reconciliationStatuses,
    FOUNDATION_SQL_POSTGRES,
    FOUNDATION_SQL_SQLITE,
    LIST_INDEX_SQL_POSTGRES,
    LIST_INDEX_SQL_SQLITE,
  };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return deterministicStringify(a) === deterministicStringify(b);
}

function deterministicStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val as unknown;
  });
}

export function diffStringArrays(label: string, committed: string[], current: string[]): string[] {
  const committedSet = new Set(committed);
  const currentSet = new Set(current);
  const missingInCurrent = committed.filter((x) => !currentSet.has(x));
  const missingInCommitted = current.filter((x) => !committedSet.has(x));
  const lines: string[] = [];
  if (missingInCurrent.length > 0) lines.push(`  ${label} missing in current (removed): ${missingInCurrent.join(", ")}`);
  if (missingInCommitted.length > 0) lines.push(`  ${label} missing in committed (added): ${missingInCommitted.join(", ")}`);
  return lines;
}

async function main(): Promise<void> {
  let failed = false;
  const allowSkip = process.argv.includes("--allow-skip");

  const coreGenerated = await generateCoreInventory();
  if (coreGenerated === null) {
    if (allowSkip) {
      console.log("[check-compat] core inventory skipped (no dist) — run bun run build first (allowed via --allow-skip)");
    } else {
      console.error("[check-compat] FAIL core inventory skipped (no dist) — run bun run build first");
      failed = true;
    }
  } else {
    if (!existsSync(CORE_INVENTORY_PATH)) {
      console.error(`[check-compat] FAIL core: missing committed ${CORE_INVENTORY_PATH} — run bun run baseline:api`);
      failed = true;
    } else {
      const committedRaw = readFileSync(CORE_INVENTORY_PATH, "utf8");
      let committed: CoreInventory;
      try {
        committed = JSON.parse(committedRaw) as CoreInventory;
      } catch {
        console.error(`[check-compat] FAIL core: committed JSON is invalid`);
        failed = true;
        committed = { runtime: [], typeOnly: [], paymentEventSchemaVersion: "", stablePaymentEventTypes: [], dtsHash: "", exportsHash: "" };
      }
      if (!deepEqual(committed, coreGenerated)) {
        console.error("[check-compat] FAIL core inventory mismatch");
        const diffs: string[] = [];
        diffs.push(...diffStringArrays("runtime", committed.runtime ?? [], coreGenerated.runtime));
        diffs.push(...diffStringArrays("typeOnly", committed.typeOnly ?? [], coreGenerated.typeOnly));
        if ((committed.paymentEventSchemaVersion ?? "") !== coreGenerated.paymentEventSchemaVersion) {
          diffs.push(`  paymentEventSchemaVersion committed=${JSON.stringify(committed.paymentEventSchemaVersion)} current=${JSON.stringify(coreGenerated.paymentEventSchemaVersion)}`);
        }
        diffs.push(...diffStringArrays("stablePaymentEventTypes", committed.stablePaymentEventTypes ?? [], coreGenerated.stablePaymentEventTypes));
        if ((committed as unknown as Record<string, unknown>).dtsHash !== undefined || (coreGenerated as unknown as Record<string, unknown>).dtsHash !== undefined) {
          if ((committed.dtsHash ?? "") !== coreGenerated.dtsHash) {
            diffs.push(`  dtsHash committed=${JSON.stringify(committed.dtsHash)} current=${JSON.stringify(coreGenerated.dtsHash)}`);
          }
        }
        if ((committed as unknown as Record<string, unknown>).exportsHash !== undefined || (coreGenerated as unknown as Record<string, unknown>).exportsHash !== undefined) {
          if ((committed.exportsHash ?? "") !== coreGenerated.exportsHash) {
            diffs.push(`  exportsHash committed=${JSON.stringify(committed.exportsHash)} current=${JSON.stringify(coreGenerated.exportsHash)}`);
          }
        }
        if (diffs.length === 0) {
          diffs.push(`  (raw diff) committed=${JSON.stringify(committed)} current=${JSON.stringify(coreGenerated)}`);
        }
        for (const line of diffs) console.error(line);
        console.error(`[check-compat] Run: bun run baseline:api && bun run baseline:schema  (after bun run build) and commit`);
        failed = true;
      } else {
        console.log("[check-compat] OK core inventory");
      }
    }
  }

  const schemaGenerated = generateSchemaInventory();
  if (!existsSync(SCHEMA_INVENTORY_PATH)) {
    console.error(`[check-compat] FAIL schema: missing committed ${SCHEMA_INVENTORY_PATH} — run bun run baseline:schema`);
    failed = true;
  } else {
    const committedRaw = readFileSync(SCHEMA_INVENTORY_PATH, "utf8");
    let committed: SchemaInventory;
    try {
      committed = JSON.parse(committedRaw) as SchemaInventory;
    } catch {
      console.error(`[check-compat] FAIL schema: committed JSON is invalid`);
      failed = true;
      committed = schemaGenerated;
    }
    if (!deepEqual(committed, schemaGenerated)) {
      console.error("[check-compat] FAIL schema inventory mismatch");
      const allKeys = new Set([...Object.keys(committed as object), ...Object.keys(schemaGenerated as object)]);
      for (const key of [...allKeys].sort()) {
        const cVal = (committed as Record<string, unknown>)[key];
        const gVal = (schemaGenerated as Record<string, unknown>)[key];
        if (deterministicStringify(cVal) !== deterministicStringify(gVal)) {
          console.error(`  ${key}: committed=${deterministicStringify(cVal)} current=${deterministicStringify(gVal)}`);
          if (typeof cVal === "string" && typeof gVal === "string" && cVal.length > 200) {
            console.error(`    (SQL diff truncated; run baseline:schema to see full)`);
          }
        }
      }
      if (deterministicStringify(committed.migrations) !== deterministicStringify(schemaGenerated.migrations)) {
        console.error(`  migrations diff: committed=${deterministicStringify(committed.migrations)} current=${deterministicStringify(schemaGenerated.migrations)}`);
      }
      failed = true;
    } else {
      console.log("[check-compat] OK schema inventory");
    }
  }

  if (failed) process.exit(1);
  console.log("[check-compat] OK — all inventories match");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
