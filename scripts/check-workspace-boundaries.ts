#!/usr/bin/env bun
/**
 * check-workspace-boundaries.ts
 *
 * Phase 1.2 — enforce monorepo package dependency / import boundaries
 * (roadmap §5.1). See docs/workspace-boundaries.md.
 *
 * Usage:
 *   bun run scripts/check-workspace-boundaries.ts
 *   bun run check:boundaries
 *
 * Exit 0 when clean (including single-package packages/core layout).
 * Exit 1 on any violation with human-readable diagnostics.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Package name of the portable SDK core. */
const CORE_PACKAGE_NAME = "@paykernel/core";

/** Forbidden dependency name patterns for core. */
const CORE_FORBIDDEN_NAME_RE = /^@paykernel\/(store|provider|gateway)-/;

/** Path fragments that core must not depend on via file:/workspace paths. */
const CORE_FORBIDDEN_PATH_FRAGMENTS = [
  `${sep}packages${sep}adapter-`,
  `${sep}packages${sep}store-`,
  `${sep}packages${sep}gateway-`,
  `${sep}packages${sep}provider-`,
  "/packages/adapter-",
  "/packages/store-",
  "/packages/gateway-",
  "/packages/provider-",
  "packages/adapter-",
  "packages/store-",
  "packages/gateway-",
  "packages/provider-",
];

/**
 * node:/bun:/cloudflare: allowlist for portable production sources.
 * Phase 8: empty — pure portable HMAC/SHA + Web APIs only. No node:crypto /
 * node:buffer in production portable packages (tests may still use node:*).
 */
const PORTABLE_ALLOWLISTED_BUILTINS = new Set<string>([]);

/**
 * Explicitly banned bare Node builtin names in portable production source
 * (in addition to any non-allowlisted node:/bun:/cloudflare: protocol).
 */
const PORTABLE_BANNED_BARE_BUILTINS = new Set([
  "fs",
  "fs/promises",
  "path",
  "child_process",
  "net",
  "http",
  "https",
  "http2",
  "cluster",
  "worker_threads",
  "dgram",
  "dns",
  "os",
  "tls",
  "zlib",
  "stream",
  "readline",
  "v8",
  "vm",
  "module",
  "perf_hooks",
  "async_hooks",
  "inspector",
  "trace_events",
]);

/** Optional peer drivers that adapter root entries must not statically import. */
const ADAPTER_OPTIONAL_DRIVERS = new Set([
  "pg",
  "postgres",
  "drizzle-orm",
  "ioredis",
  "redis",
  "@upstash/redis",
  "better-sqlite3",
  "bun:sqlite",
  "bun:sql",
  "bun:redis",
  "node:sqlite",
  "mysql2",
  "sqlite3",
  "@libsql/client",
  "@tursodatabase/serverless",
  // D1 adapter uses structural D1DatabaseLike types — never static-import Workers protocol.
  "cloudflare:workers",
]);

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PackageManifest = {
  name?: string;
  private?: boolean;
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  paymentsSdk?: {
    runtime?: string;
    portable?: boolean;
  };
};

export type WorkspacePackage = {
  dir: string;
  relDir: string;
  manifest: PackageManifest;
  name: string;
};

export type Violation = {
  rule: string;
  message: string;
  package?: string;
  file?: string;
};

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------

export function isTestFile(filePath: string): boolean {
  const base = filePath.replace(/\\/g, "/");
  // Matches *.test.ts, *.types.test.ts, *.spec.tsx, etc.
  return /\.(test|spec)\.(ts|tsx|js|mjs|jsx)$/.test(base);
}

function isProductionSourceFile(filePath: string): boolean {
  const base = filePath.replace(/\\/g, "/");
  if (isTestFile(base)) return false;
  return (
    base.endsWith(".ts") ||
    base.endsWith(".tsx") ||
    base.endsWith(".js") ||
    base.endsWith(".mjs") ||
    base.endsWith(".jsx")
  );
}

function listDirSafe(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") {
      continue;
    }
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(full, out);
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

// ---------------------------------------------------------------------------
// Package discovery
// ---------------------------------------------------------------------------

/**
 * Discover workspace packages under packages/* and optional internal/*.
 * Works when only packages/core exists.
 */
export function discoverWorkspacePackages(root: string = ROOT): WorkspacePackage[] {
  const candidates: string[] = [];

  const packagesRoot = join(root, "packages");
  if (existsSync(packagesRoot)) {
    for (const name of listDirSafe(packagesRoot)) {
      const dir = join(packagesRoot, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      // Nested packages/internal/* if ever used
      if (name === "internal") {
        for (const inner of listDirSafe(dir)) {
          const innerDir = join(dir, inner);
          try {
            if (statSync(innerDir).isDirectory()) candidates.push(innerDir);
          } catch {
            /* skip */
          }
        }
        continue;
      }
      candidates.push(dir);
    }
  }

  const internalRoot = join(root, "internal");
  if (existsSync(internalRoot)) {
    for (const name of listDirSafe(internalRoot)) {
      const dir = join(internalRoot, name);
      try {
        if (statSync(dir).isDirectory()) candidates.push(dir);
      } catch {
        /* skip */
      }
    }
  }

  const pkgs: WorkspacePackage[] = [];
  for (const dir of candidates) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    let manifest: PackageManifest;
    try {
      manifest = readJson(pkgPath);
    } catch (err) {
      throw new Error(`Failed to parse ${pkgPath}: ${err}`);
    }
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error(`Package at ${dir} is missing a string "name" field`);
    }
    pkgs.push({
      dir,
      relDir: relative(root, dir).replace(/\\/g, "/"),
      manifest,
      name: manifest.name,
    });
  }

  return pkgs.sort((a, b) => a.relDir.localeCompare(b.relDir));
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

/** Match static import/export-from and dynamic import("...") / require("..."). */
const IMPORT_RE =
  /(?:(?:import|export)[\s\w*{}$,\n]*?from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

export function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    specs.push(m[1]!);
  }
  // Side-effect imports: import "foo"
  const sideEffect = /^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;
  let sm: RegExpExecArray | null;
  while ((sm = sideEffect.exec(source)) !== null) {
    specs.push(sm[1]!);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

export function isAdapterPackageName(name: string): boolean {
  return (
    /^@paykernel\/store-/.test(name) ||
    /-adapter-/.test(name) ||
    /\/payments-adapter-/.test(name)
  );
}

export function isInternalPackagePath(relDir: string): boolean {
  const n = relDir.replace(/\\/g, "/");
  return (
    n === "internal" ||
    n.startsWith("internal/") ||
    n === "packages/internal" ||
    n.startsWith("packages/internal/")
  );
}

export function isPortablePackage(pkg: WorkspacePackage): boolean {
  const runtime = pkg.manifest.paymentsSdk?.runtime;
  if (runtime === "node-only" || runtime === "cloudflare-only") {
    return false;
  }
  if (pkg.manifest.paymentsSdk?.portable === false) {
    return false;
  }
  // Core is always portable.
  if (pkg.name === CORE_PACKAGE_NAME) return true;
  // Future portable packages by name convention.
  if (
    pkg.name === "@paykernel/webhooks" ||
    pkg.name === "@paykernel/reconciliation" ||
    pkg.name === "@paykernel/opentelemetry" ||
    pkg.name === "@paykernel/routing" ||
    pkg.name === "@paykernel/testkit"
  ) {
    return true;
  }
  // Default: packages under packages/ that are not adapters/gateways are portable
  // unless marked otherwise. Adapters often need driver-specific subpaths.
  if (isAdapterPackageName(pkg.name)) return false;
  if (/^@paykernel\/(provider|gateway)-/.test(pkg.name)) return false;
  if (isInternalPackagePath(pkg.relDir)) return false;
  // Unknown future package under packages/*: treat as portable by default.
  if (pkg.relDir.startsWith("packages/")) return true;
  return false;
}

function eachDep(
  manifest: PackageManifest,
  fn: (field: string, name: string, version: string) => void,
): void {
  for (const field of DEP_FIELDS) {
    const block = manifest[field];
    if (!block || typeof block !== "object") continue;
    for (const [name, version] of Object.entries(block)) {
      fn(field, name, version);
    }
  }
}

function isForbiddenCorePathDep(version: string): boolean {
  const v = version.replace(/\\/g, "/");
  // workspace: and file: path forms
  for (const frag of CORE_FORBIDDEN_PATH_FRAGMENTS) {
    const normalized = frag.replace(/\\/g, "/");
    if (v.includes(normalized)) return true;
  }
  // Relative path deps like ../store-postgres
  if (
    (v.startsWith("file:") || v.startsWith(".") || v.startsWith("/")) &&
    (/\/adapter-/.test(v) ||
      /\/store-/.test(v) ||
      /\/gateway-/.test(v) ||
      /\/provider-/.test(v) ||
      /packages\/adapter-/.test(v) ||
      /packages\/store-/.test(v) ||
      /packages\/gateway-/.test(v) ||
      /packages\/provider-/.test(v))
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Phase 10 / 19 / 20 / 21 domain package names (workspace dependency matrix). */
const WEBHOOKS_PACKAGE_NAME = "@paykernel/webhooks";
const RECONCILIATION_PACKAGE_NAME = "@paykernel/reconciliation";
const OBSERVABILITY_PACKAGE_NAME = "@paykernel/opentelemetry";
const ROUTING_PACKAGE_NAME = "@paykernel/routing";
const TESTKIT_PACKAGE_NAME = "@paykernel/testkit";
/** Phase 11 private relational foundation. */
const SQL_STORE_PACKAGE_NAME = "@paykernel/internal-sql-store";

function isSqlStorePathDep(version: string): boolean {
  const pathVersion = version.replace(/\\/g, "/");
  return /internal\/sql-store/.test(pathVersion);
}

function isOpenTelemetryPackageName(name: string): boolean {
  return name === "@opentelemetry/api" || name.startsWith("@opentelemetry/");
}

export function checkCoreDependencies(pkg: WorkspacePackage): Violation[] {
  if (pkg.name !== CORE_PACKAGE_NAME) return [];
  const violations: Violation[] = [];

  eachDep(pkg.manifest, (field, name, version) => {
    if (CORE_FORBIDDEN_NAME_RE.test(name)) {
      violations.push({
        rule: "a/core-no-adapters",
        package: pkg.name,
        message: `core must not depend on adapter/gateway package "${name}" (${field}: "${version}"). See roadmap §5.1.`,
      });
    }
    if (isForbiddenCorePathDep(version)) {
      violations.push({
        rule: "a/core-no-adapters",
        package: pkg.name,
        message: `core must not path-depend into packages/store-*, packages/adapter-*, packages/provider-*, or packages/gateway-* (${field}: "${name}": "${version}").`,
      });
    }
    // Core isolation (Phase 10 / 19 / 20 / 21): no webhooks / reconciliation / observability / routing / testkit reverse deps.
    if (
      name === WEBHOOKS_PACKAGE_NAME ||
      name === RECONCILIATION_PACKAGE_NAME ||
      name === OBSERVABILITY_PACKAGE_NAME ||
      name === ROUTING_PACKAGE_NAME ||
      name === TESTKIT_PACKAGE_NAME
    ) {
      violations.push({
        rule: "a/core-no-webhooks-testkit",
        package: pkg.name,
        message: `core must not depend on "${name}" (${field}: "${version}"). Core isolation: no webhooks, reconciliation, observability, routing, or testkit.`,
      });
    }
    if (
      /packages\/webhooks/.test(version.replace(/\\/g, "/")) ||
      /packages\/reconciliation/.test(version.replace(/\\/g, "/")) ||
      /packages\/observability/.test(version.replace(/\\/g, "/")) ||
      /packages\/routing/.test(version.replace(/\\/g, "/")) ||
      /packages\/testkit/.test(version.replace(/\\/g, "/"))
    ) {
      violations.push({
        rule: "a/core-no-webhooks-testkit",
        package: pkg.name,
        message: `core must not path-depend into packages/webhooks, packages/reconciliation, packages/observability, packages/routing, or packages/testkit (${field}: "${name}": "${version}").`,
      });
    }
    // Phase 11: core must not depend on private sql-store foundation.
    if (name === SQL_STORE_PACKAGE_NAME || isSqlStorePathDep(version)) {
      violations.push({
        rule: "a/core-no-sql-store",
        package: pkg.name,
        message: `core must not depend on sql-store (${field}: "${name}": "${version}"). Storage adapters (Phase 12+) own that dependency.`,
      });
    }
    // Phase 20: core must never hard-depend on OpenTelemetry (optional bridge lives in observability).
    if (isOpenTelemetryPackageName(name)) {
      violations.push({
        rule: "a/core-no-opentelemetry",
        package: pkg.name,
        message: `core must not depend on OpenTelemetry package "${name}" (${field}: "${version}"). Optional OTEL bridge lives in @paykernel/opentelemetry only.`,
      });
    }
  });

  return violations;
}

/**
 * Phase 10 / 11 / 19 / 20 / 21 dependency matrix:
 * - webhooks may depend on core only among workspace packages (no testkit/recon/observability/adapters/redis/sql-store)
 * - reconciliation may depend on core only (no testkit/webhooks/observability/adapters/redis/sql-store)
 * - observability may depend on core only (no testkit/webhooks/recon/adapters/redis/sql-store)
 * - routing may depend on core only (no testkit/webhooks/recon/observability/adapters/redis/sql-store)
 * - testkit may depend on core + webhooks + reconciliation
 * - sql-store must not depend on core, webhooks, or reconciliation (private foundation)
 */
export function checkPhase10DependencyMatrix(pkg: WorkspacePackage): Violation[] {
  const violations: Violation[] = [];

  if (pkg.name === WEBHOOKS_PACKAGE_NAME) {
    eachDep(pkg.manifest, (field, name, version) => {
      if (name === TESTKIT_PACKAGE_NAME) {
        violations.push({
          rule: "a/webhooks-no-testkit",
          package: pkg.name,
          message: `webhooks must not depend on testkit (${field}: "${name}": "${version}"). Integration proofs live in testkit.`,
        });
      }
      if (name === RECONCILIATION_PACKAGE_NAME) {
        violations.push({
          rule: "a/webhooks-no-reconciliation",
          package: pkg.name,
          message: `webhooks must not depend on reconciliation (${field}: "${name}": "${version}"). Domain packages stay independent.`,
        });
      }
      if (name === OBSERVABILITY_PACKAGE_NAME) {
        violations.push({
          rule: "a/webhooks-no-observability",
          package: pkg.name,
          message: `webhooks must not depend on observability (${field}: "${name}": "${version}"). App composes telemetry sinks; domain packages stay free of hard observability deps.`,
        });
      }
      if (name === ROUTING_PACKAGE_NAME) {
        violations.push({
          rule: "a/webhooks-no-routing",
          package: pkg.name,
          message: `webhooks must not depend on routing (${field}: "${name}": "${version}"). Domain packages stay independent; app composes select-only routing.`,
        });
      }
      if (CORE_FORBIDDEN_NAME_RE.test(name) || isAdapterPackageName(name)) {
        violations.push({
          rule: "a/webhooks-no-adapters",
          package: pkg.name,
          message: `webhooks must not depend on adapter/gateway package "${name}" (${field}: "${version}").`,
        });
      }
      if (
        name === "ioredis" ||
        name === "redis" ||
        name === "@redis/client" ||
        /^@upstash\/redis$/.test(name)
      ) {
        violations.push({
          rule: "a/webhooks-no-redis",
          package: pkg.name,
          message: `webhooks must not depend on Redis client "${name}" (${field}). Storage is injected.`,
        });
      }
      // Phase 11: webhooks engine must not depend on sql-store (storage is injected).
      if (name === SQL_STORE_PACKAGE_NAME || isSqlStorePathDep(version)) {
        violations.push({
          rule: "a/webhooks-no-sql-store",
          package: pkg.name,
          message: `webhooks must not depend on sql-store (${field}: "${name}": "${version}"). Storage is injected at the app/adapter layer.`,
        });
      }
      const pathVersion = version.replace(/\\/g, "/");
      if (/packages\/testkit/.test(pathVersion)) {
        violations.push({
          rule: "a/webhooks-no-testkit",
          package: pkg.name,
          message: `webhooks must not path-depend into testkit (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/reconciliation/.test(pathVersion)) {
        violations.push({
          rule: "a/webhooks-no-reconciliation",
          package: pkg.name,
          message: `webhooks must not path-depend into reconciliation (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/observability/.test(pathVersion)) {
        violations.push({
          rule: "a/webhooks-no-observability",
          package: pkg.name,
          message: `webhooks must not path-depend into observability (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/routing/.test(pathVersion)) {
        violations.push({
          rule: "a/webhooks-no-routing",
          package: pkg.name,
          message: `webhooks must not path-depend into routing (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/(adapter|store)-/.test(pathVersion)) {
        violations.push({
          rule: "a/webhooks-no-adapters",
          package: pkg.name,
          message: `webhooks must not path-depend into adapters (${field}: "${name}": "${version}").`,
        });
      }
    });
  }

  // Phase 19: reconciliation domain package — core only; storage injected.
  if (pkg.name === RECONCILIATION_PACKAGE_NAME) {
    eachDep(pkg.manifest, (field, name, version) => {
      if (name === TESTKIT_PACKAGE_NAME) {
        violations.push({
          rule: "a/reconciliation-no-testkit",
          package: pkg.name,
          message: `reconciliation must not depend on testkit (${field}: "${name}": "${version}"). Dual-type proofs live in testkit.`,
        });
      }
      if (name === WEBHOOKS_PACKAGE_NAME) {
        violations.push({
          rule: "a/reconciliation-no-webhooks",
          package: pkg.name,
          message: `reconciliation must not depend on webhooks (${field}: "${name}": "${version}"). Domain packages stay independent.`,
        });
      }
      if (name === OBSERVABILITY_PACKAGE_NAME) {
        violations.push({
          rule: "a/reconciliation-no-observability",
          package: pkg.name,
          message: `reconciliation must not depend on observability (${field}: "${name}": "${version}"). App composes telemetry sinks; domain packages stay free of hard observability deps.`,
        });
      }
      if (name === ROUTING_PACKAGE_NAME) {
        violations.push({
          rule: "a/reconciliation-no-routing",
          package: pkg.name,
          message: `reconciliation must not depend on routing (${field}: "${name}": "${version}"). Domain packages stay independent; app composes select-only routing.`,
        });
      }
      if (CORE_FORBIDDEN_NAME_RE.test(name) || isAdapterPackageName(name)) {
        violations.push({
          rule: "a/reconciliation-no-adapters",
          package: pkg.name,
          message: `reconciliation must not depend on adapter/gateway package "${name}" (${field}: "${version}").`,
        });
      }
      if (
        name === "ioredis" ||
        name === "redis" ||
        name === "@redis/client" ||
        /^@upstash\/redis$/.test(name)
      ) {
        violations.push({
          rule: "a/reconciliation-no-redis",
          package: pkg.name,
          message: `reconciliation must not depend on Redis client "${name}" (${field}). Storage is injected; no mandatory queue.`,
        });
      }
      if (name === SQL_STORE_PACKAGE_NAME || isSqlStorePathDep(version)) {
        violations.push({
          rule: "a/reconciliation-no-sql-store",
          package: pkg.name,
          message: `reconciliation must not depend on sql-store (${field}: "${name}": "${version}"). Storage is injected at the app/adapter layer.`,
        });
      }
      const pathVersion = version.replace(/\\/g, "/");
      if (/packages\/testkit/.test(pathVersion)) {
        violations.push({
          rule: "a/reconciliation-no-testkit",
          package: pkg.name,
          message: `reconciliation must not path-depend into testkit (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/webhooks/.test(pathVersion)) {
        violations.push({
          rule: "a/reconciliation-no-webhooks",
          package: pkg.name,
          message: `reconciliation must not path-depend into webhooks (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/observability/.test(pathVersion)) {
        violations.push({
          rule: "a/reconciliation-no-observability",
          package: pkg.name,
          message: `reconciliation must not path-depend into observability (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/routing/.test(pathVersion)) {
        violations.push({
          rule: "a/reconciliation-no-routing",
          package: pkg.name,
          message: `reconciliation must not path-depend into routing (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/(adapter|store)-/.test(pathVersion)) {
        violations.push({
          rule: "a/reconciliation-no-adapters",
          package: pkg.name,
          message: `reconciliation must not path-depend into adapters (${field}: "${name}": "${version}").`,
        });
      }
    });
  }

  // Phase 20: observability package — core only; optional OTEL peer; no domain/adapter/testkit deps.
  if (pkg.name === OBSERVABILITY_PACKAGE_NAME) {
    eachDep(pkg.manifest, (field, name, version) => {
      if (name === TESTKIT_PACKAGE_NAME) {
        violations.push({
          rule: "a/observability-no-testkit",
          package: pkg.name,
          message: `observability must not depend on testkit (${field}: "${name}": "${version}").`,
        });
      }
      if (name === WEBHOOKS_PACKAGE_NAME) {
        violations.push({
          rule: "a/observability-no-webhooks",
          package: pkg.name,
          message: `observability must not depend on webhooks (${field}: "${name}": "${version}"). Domain packages stay independent; app composes.`,
        });
      }
      if (name === RECONCILIATION_PACKAGE_NAME) {
        violations.push({
          rule: "a/observability-no-reconciliation",
          package: pkg.name,
          message: `observability must not depend on reconciliation (${field}: "${name}": "${version}"). Domain packages stay independent; app composes.`,
        });
      }
      if (name === ROUTING_PACKAGE_NAME) {
        violations.push({
          rule: "a/observability-no-routing",
          package: pkg.name,
          message: `observability must not depend on routing (${field}: "${name}": "${version}"). Domain packages stay independent; app composes.`,
        });
      }
      if (CORE_FORBIDDEN_NAME_RE.test(name) || isAdapterPackageName(name)) {
        violations.push({
          rule: "a/observability-no-adapters",
          package: pkg.name,
          message: `observability must not depend on adapter/gateway package "${name}" (${field}: "${version}").`,
        });
      }
      if (
        name === "ioredis" ||
        name === "redis" ||
        name === "@redis/client" ||
        /^@upstash\/redis$/.test(name)
      ) {
        violations.push({
          rule: "a/observability-no-redis",
          package: pkg.name,
          message: `observability must not depend on Redis client "${name}" (${field}).`,
        });
      }
      if (name === SQL_STORE_PACKAGE_NAME || isSqlStorePathDep(version)) {
        violations.push({
          rule: "a/observability-no-sql-store",
          package: pkg.name,
          message: `observability must not depend on sql-store (${field}: "${name}": "${version}").`,
        });
      }
      const pathVersion = version.replace(/\\/g, "/");
      if (/packages\/testkit/.test(pathVersion)) {
        violations.push({
          rule: "a/observability-no-testkit",
          package: pkg.name,
          message: `observability must not path-depend into testkit (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/webhooks/.test(pathVersion)) {
        violations.push({
          rule: "a/observability-no-webhooks",
          package: pkg.name,
          message: `observability must not path-depend into webhooks (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/reconciliation/.test(pathVersion)) {
        violations.push({
          rule: "a/observability-no-reconciliation",
          package: pkg.name,
          message: `observability must not path-depend into reconciliation (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/routing/.test(pathVersion)) {
        violations.push({
          rule: "a/observability-no-routing",
          package: pkg.name,
          message: `observability must not path-depend into routing (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/(adapter|store)-/.test(pathVersion)) {
        violations.push({
          rule: "a/observability-no-adapters",
          package: pkg.name,
          message: `observability must not path-depend into adapters (${field}: "${name}": "${version}").`,
        });
      }
    });
  }

  // Phase 21: routing package — core only; select-only policies; no domain/adapter/testkit deps.
  if (pkg.name === ROUTING_PACKAGE_NAME) {
    eachDep(pkg.manifest, (field, name, version) => {
      if (name === TESTKIT_PACKAGE_NAME) {
        violations.push({
          rule: "a/routing-no-testkit",
          package: pkg.name,
          message: `routing must not depend on testkit (${field}: "${name}": "${version}").`,
        });
      }
      if (name === WEBHOOKS_PACKAGE_NAME) {
        violations.push({
          rule: "a/routing-no-webhooks",
          package: pkg.name,
          message: `routing must not depend on webhooks (${field}: "${name}": "${version}"). Domain packages stay independent; app composes.`,
        });
      }
      if (name === RECONCILIATION_PACKAGE_NAME) {
        violations.push({
          rule: "a/routing-no-reconciliation",
          package: pkg.name,
          message: `routing must not depend on reconciliation (${field}: "${name}": "${version}"). Domain packages stay independent; app composes.`,
        });
      }
      if (name === OBSERVABILITY_PACKAGE_NAME) {
        violations.push({
          rule: "a/routing-no-observability",
          package: pkg.name,
          message: `routing must not depend on observability (${field}: "${name}": "${version}"). App composes telemetry; routing stays free of hard observability deps.`,
        });
      }
      if (CORE_FORBIDDEN_NAME_RE.test(name) || isAdapterPackageName(name)) {
        violations.push({
          rule: "a/routing-no-adapters",
          package: pkg.name,
          message: `routing must not depend on adapter/gateway package "${name}" (${field}: "${version}").`,
        });
      }
      if (
        name === "ioredis" ||
        name === "redis" ||
        name === "@redis/client" ||
        /^@upstash\/redis$/.test(name)
      ) {
        violations.push({
          rule: "a/routing-no-redis",
          package: pkg.name,
          message: `routing must not depend on Redis client "${name}" (${field}).`,
        });
      }
      if (name === SQL_STORE_PACKAGE_NAME || isSqlStorePathDep(version)) {
        violations.push({
          rule: "a/routing-no-sql-store",
          package: pkg.name,
          message: `routing must not depend on sql-store (${field}: "${name}": "${version}").`,
        });
      }
      const pathVersion = version.replace(/\\/g, "/");
      if (/packages\/testkit/.test(pathVersion)) {
        violations.push({
          rule: "a/routing-no-testkit",
          package: pkg.name,
          message: `routing must not path-depend into testkit (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/webhooks/.test(pathVersion)) {
        violations.push({
          rule: "a/routing-no-webhooks",
          package: pkg.name,
          message: `routing must not path-depend into webhooks (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/reconciliation/.test(pathVersion)) {
        violations.push({
          rule: "a/routing-no-reconciliation",
          package: pkg.name,
          message: `routing must not path-depend into reconciliation (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/observability/.test(pathVersion)) {
        violations.push({
          rule: "a/routing-no-observability",
          package: pkg.name,
          message: `routing must not path-depend into observability (${field}: "${name}": "${version}").`,
        });
      }
      if (/packages\/(adapter|store)-/.test(pathVersion)) {
        violations.push({
          rule: "a/routing-no-adapters",
          package: pkg.name,
          message: `routing must not path-depend into adapters (${field}: "${name}": "${version}").`,
        });
      }
    });
  }

  // Phase 11: private sql-store foundation must not depend on core or domain engines.
  const isSqlStorePkg =
    pkg.name === SQL_STORE_PACKAGE_NAME || pkg.relDir.replace(/\\/g, "/") === "internal/sql-store";
  if (isSqlStorePkg) {
    eachDep(pkg.manifest, (field, name, version) => {
      if (
        name === CORE_PACKAGE_NAME ||
        name === WEBHOOKS_PACKAGE_NAME ||
        name === RECONCILIATION_PACKAGE_NAME
      ) {
        violations.push({
          rule: "a/sql-store-no-core-webhooks",
          package: pkg.name,
          message: `sql-store must not depend on "${name}" (${field}: "${version}"). Private foundation stays free of core/domain runtime deps.`,
        });
      }
      const pathVersion = version.replace(/\\/g, "/");
      if (
        /packages\/core/.test(pathVersion) ||
        /packages\/webhooks/.test(pathVersion) ||
        /packages\/reconciliation/.test(pathVersion)
      ) {
        violations.push({
          rule: "a/sql-store-no-core-webhooks",
          package: pkg.name,
          message: `sql-store must not path-depend into core, webhooks, or reconciliation (${field}: "${name}": "${version}").`,
        });
      }
    });
  }

  return violations;
}

export function classifyPortableImport(
  specifier: string,
): { ok: true } | { ok: false; reason: string } {
  // Relative / absolute package-local
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return { ok: true };
  }

  // Protocol builtins
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:") ||
    specifier.startsWith("cloudflare:")
  ) {
    if (PORTABLE_ALLOWLISTED_BUILTINS.has(specifier)) {
      return { ok: true };
    }
    // bun:test is only allowed in test files (caller filters)
    if (specifier === "bun:test") {
      return {
        ok: false,
        reason: `production portable source must not import "bun:test" (tests only)`,
      };
    }
    return {
      ok: false,
      reason: `banned runtime builtin "${specifier}" in portable production source (allowlist: ${[
        ...PORTABLE_ALLOWLISTED_BUILTINS,
      ].join(", ")})`,
    };
  }

  // Bare node builtins
  if (PORTABLE_BANNED_BARE_BUILTINS.has(specifier)) {
    return {
      ok: false,
      reason: `banned bare Node builtin "${specifier}" in portable production source`,
    };
  }

  // Package imports (zod, etc.) are fine for import-policy rule b
  return { ok: true };
}

export function checkPortableSourceImports(
  pkg: WorkspacePackage,
  root: string = ROOT,
): Violation[] {
  if (!isPortablePackage(pkg)) return [];
  const srcDir = join(pkg.dir, "src");
  if (!existsSync(srcDir)) return [];

  const violations: Violation[] = [];
  const files = walkFiles(srcDir).filter(isProductionSourceFile);

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const specs = extractImportSpecifiers(source);
    for (const spec of specs) {
      const result = classifyPortableImport(spec);
      if (!result.ok) {
        violations.push({
          rule: "b/portable-imports",
          package: pkg.name,
          file: relative(root, file).replace(/\\/g, "/"),
          message: result.reason,
        });
      }
    }
  }

  return violations;
}

function resolvePackageRootEntry(pkg: WorkspacePackage): string | null {
  const m = pkg.manifest;
  const candidates: string[] = [];

  if (m.exports && typeof m.exports === "object") {
    const exp = m.exports as Record<string, unknown>;
    const root = exp["."] ?? exp["./"];
    if (typeof root === "string") {
      candidates.push(root);
    } else if (root && typeof root === "object") {
      const cond = root as Record<string, unknown>;
      for (const key of ["import", "require", "default", "module", "node", "bun"]) {
        const v = cond[key];
        if (typeof v === "string") {
          candidates.push(v);
          break;
        }
        if (v && typeof v === "object") {
          const nested = v as Record<string, unknown>;
          for (const k2 of ["import", "default", "require"]) {
            if (typeof nested[k2] === "string") {
              candidates.push(nested[k2] as string);
              break;
            }
          }
          if (candidates.length) break;
        }
      }
    }
  }

  if (typeof m.module === "string") candidates.push(m.module);
  if (typeof m.main === "string") candidates.push(m.main);

  // Prefer source when dist missing (pre-build layout)
  const tryPaths = [...candidates, "src/index.ts", "src/index.js", "index.ts", "index.js"];

  for (const p of tryPaths) {
    const full = resolve(pkg.dir, p);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }

  // If only dist is declared but missing, try swapping dist/ → src/
  for (const p of candidates) {
    const asSrc = p
      .replace(/^\.\/dist\//, "./src/")
      .replace(/^dist\//, "src/")
      .replace(/\.js$/, ".ts");
    const full = resolve(pkg.dir, asSrc);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }

  return null;
}

function resolveRelativeImport(fromFile: string, spec: string, packageDir: string): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const base = resolve(dirname(fromFile), spec);
  const tries = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.js"),
  ];
  for (const t of tries) {
    if (!existsSync(t)) continue;
    try {
      if (!statSync(t).isFile()) continue;
    } catch {
      continue;
    }
    // Stay within package
    const rel = relative(packageDir, t);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) return null;
    return t;
  }
  return null;
}

/**
 * Walk static relative imports from adapter root entry; fail if an optional
 * peer driver is imported.
 */
export function checkAdapterRootEntry(pkg: WorkspacePackage, root: string = ROOT): Violation[] {
  if (!isAdapterPackageName(pkg.name)) return [];

  const entry = resolvePackageRootEntry(pkg);
  if (!entry) {
    // No entry yet (scaffold) — skip, do not fail empty adapters.
    return [];
  }

  const violations: Violation[] = [];
  const visited = new Set<string>();
  const queue: string[] = [entry];

  while (queue.length) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const spec of extractImportSpecifiers(source)) {
      if (ADAPTER_OPTIONAL_DRIVERS.has(spec)) {
        violations.push({
          rule: "c/adapter-root-drivers",
          package: pkg.name,
          file: relative(root, file).replace(/\\/g, "/"),
          message: `adapter root entry graph must not statically import optional peer driver "${spec}" (use optional peers + isolated subpath exports)`,
        });
        continue;
      }
      const next = resolveRelativeImport(file, spec, pkg.dir);
      if (next) queue.push(next);
    }
  }

  return violations;
}

/**
 * Build workspace dependency graph edges: name → set of workspace names.
 * Edges come from (1) dependency keys that match another workspace package name
 * (including workspace:* protocol), or (2) file:/relative path versions that
 * resolve into another package directory.
 */
export function buildWorkspaceDepGraph(packages: WorkspacePackage[]): Map<string, Set<string>> {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const graph = new Map<string, Set<string>>();
  for (const p of packages) graph.set(p.name, new Set());

  for (const pkg of packages) {
    eachDep(pkg.manifest, (_field, depName, version) => {
      // Named workspace / published-name match (covers workspace:*, catalog:, etc.)
      if (byName.has(depName)) {
        graph.get(pkg.name)!.add(depName);
        return;
      }

      // Path-only deps: file:../other, ./sibling, absolute path into packages/*
      const versionPath = version.replace(/\\/g, "/");
      const isPathVersion =
        versionPath.startsWith("file:") ||
        versionPath.startsWith(".") ||
        versionPath.startsWith("/");
      if (!isPathVersion) return;

      for (const other of packages) {
        if (other.name === pkg.name) continue;
        const otherBase = other.relDir.split("/").pop() ?? other.relDir;
        if (
          versionPath.includes(other.relDir) ||
          versionPath.endsWith(`/${otherBase}`) ||
          versionPath.includes(`packages/${otherBase}/`) ||
          versionPath.endsWith(`packages/${otherBase}`)
        ) {
          graph.get(pkg.name)!.add(other.name);
        }
      }
    });
  }

  return graph;
}

export function findCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) {
        cycles.push([...stack.slice(idx), node]);
      }
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      dfs(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }

  // Deduplicate cycles by normalized rotation
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const c of cycles) {
    const body = c.slice(0, -1);
    if (body.length === 0) continue;
    const rotations = body.map((_, i) => [...body.slice(i), ...body.slice(0, i)].join("→"));
    const key = rotations.sort()[0]!;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  return unique;
}

export function checkCircularDependencies(packages: WorkspacePackage[]): Violation[] {
  if (packages.length < 2) return [];
  const graph = buildWorkspaceDepGraph(packages);
  const cycles = findCycles(graph);
  return cycles.map((path) => ({
    rule: "d/no-cycles",
    message: `circular workspace package dependency: ${path.join(" → ")}`,
  }));
}

export function checkInternalPrivate(pkg: WorkspacePackage): Violation[] {
  if (!isInternalPackagePath(pkg.relDir)) return [];
  if (pkg.manifest.private === true) return [];
  return [
    {
      rule: "e/internal-private",
      package: pkg.name,
      message: `package under ${pkg.relDir} must set "private": true (internal/* must not be published)`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runChecks(packages: WorkspacePackage[], root: string = ROOT): Violation[] {
  const violations: Violation[] = [];
  for (const pkg of packages) {
    violations.push(...checkCoreDependencies(pkg));
    violations.push(...checkPhase10DependencyMatrix(pkg));
    violations.push(...checkPortableSourceImports(pkg, root));
    violations.push(...checkAdapterRootEntry(pkg, root));
    violations.push(...checkInternalPrivate(pkg));
  }
  violations.push(...checkCircularDependencies(packages));
  return violations;
}

function formatViolation(v: Violation, index: number): string {
  const bits = [`  ${index + 1}. [${v.rule}]`];
  if (v.package) bits.push(`package=${v.package}`);
  if (v.file) bits.push(`file=${v.file}`);
  bits.push(v.message);
  return bits.join(" ");
}

function main(): void {
  console.log("==> check workspace boundaries (Phase 1.2 / roadmap §5.1)");
  console.log(`    root: ${ROOT}`);

  let packages: WorkspacePackage[];
  try {
    packages = discoverWorkspacePackages(ROOT);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (packages.length === 0) {
    console.error("error: no workspace packages found under packages/* (expected packages/core).");
    process.exit(1);
  }

  console.log(`    packages: ${packages.map((p) => `${p.name} (${p.relDir})`).join(", ")}`);

  const violations = runChecks(packages, ROOT);

  if (violations.length === 0) {
    console.log("==> workspace boundaries OK");
    process.exit(0);
  }

  console.error(`\nerror: ${violations.length} workspace boundary violation(s):\n`);
  for (let i = 0; i < violations.length; i++) {
    console.error(formatViolation(violations[i]!, i));
  }
  console.error("\nSee docs/workspace-boundaries.md for policy and allowed exceptions.");
  process.exit(1);
}

// Only run CLI when executed directly (not when imported by unit tests).
// Bun sets import.meta.main for direct execution.
if (import.meta.main) {
  main();
}
