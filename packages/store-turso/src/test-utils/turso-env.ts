/**
 * Shared helpers for live Turso / libSQL tests.
 *
 * Connection env (prefer first):
 *   TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 *   LIBSQL_URL + LIBSQL_AUTH_TOKEN
 *   PAYMENTS_SDK_TURSO_URL + PAYMENTS_SDK_TURSO_AUTH_TOKEN
 *
 * When unset, integration/conformance suites skip cleanly so CI without
 * remote Turso stays green. Local `file:` libsql paths do not require env.
 *
 * Local secrets (test-only): `packages/store-turso/.env` is loaded
 * automatically when present (gitignored). Process env always wins over file.
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
loadEnvFile(join(process.cwd(), "packages/store-turso/.env"));
loadEnvFile(join(process.cwd(), ".env"));

export const TURSO_DATABASE_URL =
  process.env.TURSO_DATABASE_URL ??
  process.env.PAYMENTS_SDK_TURSO_URL ??
  process.env.LIBSQL_URL ??
  undefined;

export const TURSO_AUTH_TOKEN =
  process.env.TURSO_AUTH_TOKEN ??
  process.env.PAYMENTS_SDK_TURSO_AUTH_TOKEN ??
  process.env.LIBSQL_AUTH_TOKEN ??
  undefined;

export function hasLiveTurso(): boolean {
  return typeof TURSO_DATABASE_URL === "string" && TURSO_DATABASE_URL.length > 0;
}

/** True when URL looks like a remote Turso/libSQL endpoint (not file:/memory). */
export function isRemoteTursoUrl(url: string | undefined = TURSO_DATABASE_URL): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower === ":memory:" || lower.startsWith("file:")) return false;
  return (
    lower.startsWith("libsql://") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.includes("turso.io")
  );
}

/** Unique tablePrefix per test run to avoid collisions on shared DBs. */
export function uniqueTablePrefix(label = "t"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const safeLabel = label.replace(/[^A-Za-z0-9_]/g, "").slice(0, 8) || "t";
  return `${safeLabel}${Date.now().toString(36)}${rand}_`;
}


