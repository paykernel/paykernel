/**
 * Shared helpers for live / local D1 tests (wrangler / miniflare).
 *
 * Env (prefer first):
 *   PAYMENTS_SDK_D1_DATABASE_ID + CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
 *   D1_DATABASE_ID + CF_ACCOUNT_ID + CF_API_TOKEN
 *
 * Binding harness flag (optional):
 *   PAYMENTS_SDK_D1_BINDING_AVAILABLE=1  — custom miniflare/Workers test runner
 *                                         injects a real D1 binding
 *
 * When unset, live suites skip cleanly so CI without Workers/D1 stays green.
 * Mock D1 (bun:sqlite) paths do not require env.
 * Normal Worker operation uses binding only — REST account tokens are NOT required.
 *
 * Local secrets (test-only): `packages/store-d1/.env` is loaded
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
loadEnvFile(join(process.cwd(), "packages/store-d1/.env"));
loadEnvFile(join(process.cwd(), ".env"));

const D1_DATABASE_ID =
  process.env.PAYMENTS_SDK_D1_DATABASE_ID ??
  process.env.D1_DATABASE_ID ??
  undefined;

const CF_ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID ??
  process.env.CF_ACCOUNT_ID ??
  undefined;

const CF_API_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN ??
  process.env.CF_API_TOKEN ??
  undefined;

/** True when env looks sufficient for a live remote D1 REST path (not required for normal operation). */
export function hasLiveD1(): boolean {
  return (
    typeof D1_DATABASE_ID === "string" &&
    D1_DATABASE_ID.length > 0 &&
    typeof CF_ACCOUNT_ID === "string" &&
    CF_ACCOUNT_ID.length > 0 &&
    typeof CF_API_TOKEN === "string" &&
    CF_API_TOKEN.length > 0
  );
}

/**
 * Live D1 binding tests require a Workers/miniflare runtime — not available
 * in plain bun test. Always returns false for skip-clean unit/conformance path.
 * Override with PAYMENTS_SDK_D1_BINDING_AVAILABLE=1 only in custom harnesses.
 */
export function hasD1BindingRuntime(): boolean {
  return process.env.PAYMENTS_SDK_D1_BINDING_AVAILABLE === "1";
}

/** Unique tablePrefix per test run to avoid collisions on shared DBs. */
export function uniqueTablePrefix(label = "d"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const safeLabel = label.replace(/[^A-Za-z0-9_]/g, "").slice(0, 8) || "d";
  return `${safeLabel}${Date.now().toString(36)}${rand}_`;
}
