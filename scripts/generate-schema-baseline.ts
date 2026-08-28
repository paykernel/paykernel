#!/usr/bin/env bun
/**
 * generate-schema-baseline.ts
 *
 * Phase 25 persisted schema baseline generator.
 * Reads sql-foundation constants and emits
 * packages/sql-foundation/docs/baseline/schema.inventory.json
 * with no timestamps.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const OUT_FILE = join(ROOT, "packages", "sql-foundation", "docs", "baseline", "schema.inventory.json");

function main(): void {
  const schemaFamily: string = SCHEMA_FAMILY ?? "payments-storage";
  const currentVersion: number = CURRENT_SCHEMA_VERSION;

  const migrations: Array<{ version: number; checksum: string | undefined }> = (MIGRATIONS as Array<{ version: number; checksum?: string }>)
    .map((m) => ({ version: m.version, checksum: m.checksum }))
    .sort((a, b) => a.version - b.version);

  const logicalTables: string[] = [...(ALL_LOGICAL_TABLES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  function sortedColumnValues(obj: Record<string, string>): string[] {
    return Object.values(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  const idempotencyColumns: string[] = sortedColumnValues(IDEMPOTENCY_COLUMNS as unknown as Record<string, string>);
  const webhookInboxColumns: string[] = sortedColumnValues(WEBHOOK_INBOX_COLUMNS as unknown as Record<string, string>);
  const reconciliationColumns: string[] = sortedColumnValues(RECONCILIATION_COLUMNS as unknown as Record<string, string>);

  const idempotencyStatuses: string[] = [...(IDEMPOTENCY_STATUSES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const webhookInboxStatuses: string[] = [...(WEBHOOK_INBOX_STATUSES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const reconciliationStatuses: string[] = [...(RECONCILIATION_STATUSES as string[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

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
    throw new Error("Missing FOUNDATION_SQL_* / LIST_INDEX_SQL_* exports and could not build fallback");
  }

  const inventory = {
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

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(inventory, null, 2) + "\n", "utf8");
  console.log(`[generate-schema-baseline] Wrote ${relative(ROOT, OUT_FILE)}`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
