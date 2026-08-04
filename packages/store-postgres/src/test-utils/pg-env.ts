/**
 * Shared helpers for live PostgreSQL tests.
 *
 * Connection env (prefer first):
 *   PAYMENTS_SDK_PG_URL
 *   DATABASE_URL
 *
 * Local secrets (test-only): `packages/store-postgres/.env` is loaded automatically
 * when present (gitignored). See `.env.example`. Process env always wins over file.
 *
 * When unset, integration/conformance suites skip cleanly so CI without PG stays green.
 *
 * Managed providers (Supabase pooler, etc.):
 * - Prefer session-mode pooler when direct `db.*.supabase.co:5432` is IPv6-only.
 * - node-postgres may need `ssl: { rejectUnauthorized: false }` for intermediate chains
 *   when URL has `sslmode=require` (pg maps require→verify-full in recent versions).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Load KEY=VALUE from a dotenv-style file into process.env (does not override). */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined && process.env[key] !== "") continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Package root .env (src/test-utils → ../..)
loadEnvFile(join(import.meta.dir, "../../.env"));
// Monorepo root .env when tests are run from repo root
loadEnvFile(join(process.cwd(), "packages/store-postgres/.env"));
loadEnvFile(join(process.cwd(), ".env"));

export const PG_URL =
  process.env.PAYMENTS_SDK_PG_URL ?? process.env.DATABASE_URL ?? undefined;

export function hasLivePostgres(): boolean {
  return typeof PG_URL === "string" && PG_URL.length > 0;
}

/** Unique tablePrefix per test run to avoid collisions on shared DBs. */
export function uniqueTablePrefix(label = "t"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  // Identifier-safe: letters/digits/underscore only (namespace validator).
  const safeLabel = label.replace(/[^A-Za-z0-9_]/g, "").slice(0, 8) || "t";
  return `${safeLabel}${Date.now().toString(36)}${rand}_`;
}

export const FOUNDATION_LOGICAL_TABLES = [
  "payment_idempotency",
  "payment_webhook_inbox",
  "payment_reconciliation_jobs",
  "payment_storage_migrations",
] as const;

export function dropFoundationTablesSql(tablePrefix: string): string {
  const names = FOUNDATION_LOGICAL_TABLES.map((t) => `"${tablePrefix}${t}"`).join(", ");
  return `DROP TABLE IF EXISTS ${names} CASCADE`;
}

/**
 * Pool config for node-postgres against the live URL.
 * Handles Supabase / sslmode=require cert chains used in integration tests.
 *
 * Important: recent `pg` treats URL `sslmode=require` as verify-full and ignores a
 * softer `ssl` object if the URL still contains sslmode. We strip sslmode from the
 * connection string when applying test-only `rejectUnauthorized: false`.
 */
export function createNodePgPoolConfig(options?: {
  max?: number;
  connectionString?: string;
}): {
  connectionString: string;
  max: number;
  ssl?: boolean | { rejectUnauthorized: boolean };
} {
  const raw = options?.connectionString ?? PG_URL;
  if (!raw) {
    throw new Error("createNodePgPoolConfig requires PAYMENTS_SDK_PG_URL or DATABASE_URL");
  }
  const max = options?.max ?? 4;
  try {
    const u = new URL(raw);
    const mode = (u.searchParams.get("sslmode") ?? "").toLowerCase();
    const host = u.hostname.toLowerCase();
    const managed =
      host.includes("supabase.co") ||
      host.includes("pooler.supabase.com") ||
      host.includes("neon.tech") ||
      host.includes("amazonaws.com");
    const wantSoftSsl =
      mode === "require" ||
      mode === "prefer" ||
      mode === "verify-ca" ||
      mode === "verify-full" ||
      managed ||
      process.env.PAYMENTS_SDK_PG_SSL_NO_VERIFY === "1";

    if (wantSoftSsl) {
      // Remove sslmode so pg does not force verify-full over our ssl option.
      u.searchParams.delete("sslmode");
      u.searchParams.delete("ssl");
      // Also strip bare `?sslmode=require` style if left empty query.
      let connectionString = u.toString();
      if (connectionString.endsWith("?")) {
        connectionString = connectionString.slice(0, -1);
      }
      return {
        connectionString,
        max,
        // Test-only: accept provider intermediate certs. Production should pin CA.
        ssl: { rejectUnauthorized: false },
      };
    }
  } catch {
    /* invalid URL — pool will fail later with a clear driver error */
  }
  return { connectionString: raw, max };
}
