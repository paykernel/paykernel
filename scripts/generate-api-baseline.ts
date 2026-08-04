#!/usr/bin/env bun
/**
 * generate-api-baseline.ts
 *
 * Phase 0 public API baseline generator.
 * Parses packages/core/src/index.ts export statements, loads the built package
 * from packages/core/dist/, and emits packages/core/docs/baseline/public-api.md
 * with a deterministic sorted inventory.
 *
 * Prerequisites:
 *   - packages/core/dist/index.js and packages/core/dist/index.d.ts must exist
 *     (run `bun run build` first)
 *
 * Usage:
 *   bun run scripts/generate-api-baseline.ts
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const CORE = join(ROOT, "packages", "core");
const SRC_INDEX = join(CORE, "src", "index.ts");
const DIST_INDEX_JS = join(CORE, "dist", "index.js");
const DIST_INDEX_DTS = join(CORE, "dist", "index.d.ts");
const PACKAGE_JSON = join(CORE, "package.json");
const OUT_FILE = join(CORE, "docs", "baseline", "public-api.md");
const COMMAND = "bun run scripts/generate-api-baseline.ts";

type ParsedExports = {
  typeOnly: string[];
  valueExports: string[];
};

function fail(message: string): never {
  console.error(`[generate-api-baseline] ${message}`);
  process.exit(1);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/**
 * Parse export statements from src/index.ts.
 * Handles:
 *   export { A, B } from "..."
 *   export type { T, U } from "..."
 *   export { type T, V } from "..."  (mixed — type keyword on member)
 * Does not invent symbols; only names appearing in export lists.
 */
function parseIndexExports(source: string): ParsedExports {
  const typeOnly = new Set<string>();
  const valueExports = new Set<string>();

  // Strip block comments and line comments that would confuse simple regex parsing
  // Keep string contents simple: index.ts uses only double-quoted module paths.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // export type { A, B as C } from "..."
  // export type { A, B }
  const typeExportRe =
    /export\s+type\s*\{([^}]+)\}(?:\s*from\s*["'][^"']+["'])?/g;
  // export { A, type B, C as D } from "..."
  // export { A, B }
  const valueExportRe =
    /export\s*\{([^}]+)\}(?:\s*from\s*["'][^"']+["'])?/g;

  let match: RegExpExecArray | null;

  while ((match = typeExportRe.exec(stripped)) !== null) {
    for (const name of splitExportNames(match[1]!)) {
      typeOnly.add(name);
    }
  }

  while ((match = valueExportRe.exec(stripped)) !== null) {
    // Skip `export type { ... }` already handled above
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

  // export declare / export class / export function / export const / export enum
  // (not used by this package today, but keep for completeness)
  const declRe =
    /export\s+(?:async\s+)?(?:declare\s+)?(?:abstract\s+)?(class|function|const|let|var|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  while ((match = declRe.exec(stripped)) !== null) {
    const kind = match[1]!;
    const name = match[2]!;
    if (kind === "interface" || kind === "type") typeOnly.add(name);
    else valueExports.add(name);
  }

  return {
    typeOnly: [...typeOnly].sort((a, b) => a.localeCompare(b)),
    valueExports: [...valueExports].sort((a, b) => a.localeCompare(b)),
  };
}

function splitExportNames(inner: string): string[] {
  return inner
    .split(",")
    .map((s) => resolveExportName(s.trim()))
    .filter((n): n is string => Boolean(n));
}

function resolveExportName(part: string): string | null {
  if (!part) return null;
  // "Foo as Bar" → consumer-visible name is Bar
  const asMatch = /^(.+?)\s+as\s+(.+)$/.exec(part);
  if (asMatch) return asMatch[2]!.trim();
  const name = part.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  return name;
}

function walkDtsFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDtsFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      out.push(relative(base, full).split("\\").join("/"));
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function classifyRuntimeExport(
  name: string,
  value: unknown,
): "class" | "function" | "const" {
  if (typeof value === "function") {
    // Heuristic: class constructors have prototype methods or a non-Object name pattern
    const proto = (value as Function).prototype;
    const looksLikeClass =
      typeof proto === "object" &&
      proto !== null &&
      (Object.getOwnPropertyNames(proto).some((k) => k !== "constructor") ||
        /^[A-Z]/.test(name));
    return looksLikeClass ? "class" : "function";
  }
  return "const";
}

function formatEntryPoints(pkg: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`- **main**: \`${String(pkg.main ?? "(unset)")}\``);
  lines.push(`- **types**: \`${String(pkg.types ?? "(unset)")}\``);
  lines.push(`- **type**: \`${String(pkg.type ?? "(unset)")}\``);
  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === "object") {
    lines.push("- **exports**:");
    lines.push("```json");
    lines.push(JSON.stringify(exportsField, null, 2));
    lines.push("```");
  } else {
    lines.push(`- **exports**: \`${String(exportsField ?? "(unset)")}\``);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (!existsSync(SRC_INDEX)) fail(`Missing ${SRC_INDEX}`);
  if (!existsSync(DIST_INDEX_JS)) {
    fail(
      `Missing ${DIST_INDEX_JS}. Run \`bun run build\` before generating the API baseline.`,
    );
  }
  if (!existsSync(DIST_INDEX_DTS)) {
    fail(
      `Missing ${DIST_INDEX_DTS}. Run \`bun run build\` (includes build:types) first.`,
    );
  }
  if (!existsSync(PACKAGE_JSON)) fail(`Missing ${PACKAGE_JSON}`);

  const pkg = readJson(PACKAGE_JSON);
  const name = String(pkg.name ?? "unknown");
  const version = String(pkg.version ?? "unknown");

  const source = readFileSync(SRC_INDEX, "utf8");
  const parsed = parseIndexExports(source);

  // Load built runtime module to classify value exports (do not invent names)
  const mod = (await import(pathToFileURL(DIST_INDEX_JS).href)) as Record<
    string,
    unknown
  >;
  const runtimeKeys = Object.keys(mod).sort((a, b) => a.localeCompare(b));

  // Cross-check: every parsed value export must exist on the runtime module
  const missingAtRuntime = parsed.valueExports.filter((n) => !(n in mod));
  if (missingAtRuntime.length > 0) {
    fail(
      `Parsed value exports missing from dist runtime: ${missingAtRuntime.join(", ")}`,
    );
  }

  // Unexpected runtime keys not listed in src/index.ts (warn only; still report)
  const unexpectedRuntime = runtimeKeys.filter(
    (k) => !parsed.valueExports.includes(k),
  );

  // Type-only must not appear as runtime values (except rare dual exports — not used here)
  const typeAlsoRuntime = parsed.typeOnly.filter((n) => n in mod);

  const runtimeRows = parsed.valueExports.map((exportName) => {
    const kind = classifyRuntimeExport(exportName, mod[exportName]);
    return { name: exportName, kind };
  });

  // Sort already sorted by parse, but re-sort for safety
  runtimeRows.sort((a, b) => a.name.localeCompare(b.name));
  const typeOnlySorted = [...parsed.typeOnly].sort((a, b) =>
    a.localeCompare(b),
  );

  const dtsFiles = walkDtsFiles(join(CORE, "dist"));
  const bundleStat = statSync(DIST_INDEX_JS);
  const bundleSha = createHash("sha256")
    .update(readFileSync(DIST_INDEX_JS))
    .digest("hex");

  const generatedAt = new Date().toISOString();

  const lines: string[] = [];
  lines.push("# Public API Baseline");
  lines.push("");
  lines.push(
    "> **Phase 0 freeze artifact.** Generated from `src/index.ts` and the built `dist/` package.",
  );
  lines.push(
    "> Do not hand-edit the inventory tables; regenerate with the command below.",
  );
  lines.push("");
  lines.push("## Generation metadata");
  lines.push("");
  lines.push(`- **Generated at (UTC)**: ${generatedAt}`);
  lines.push(`- **Command**: \`${COMMAND}\``);
  lines.push(`- **Source of truth (exports)**: \`src/index.ts\``);
  lines.push(`- **Runtime module inspected**: \`dist/index.js\``);
  lines.push(`- **Declarations inspected**: \`dist/**/*.d.ts\``);
  lines.push(
    `- **Bundle**: \`dist/index.js\` — ${bundleStat.size} bytes, sha256 \`${bundleSha}\``,
  );
  lines.push("");
  lines.push("## Package");
  lines.push("");
  lines.push(`- **name**: \`${name}\``);
  lines.push(`- **version**: \`${version}\``);
  lines.push("");
  lines.push("## Entry points");
  lines.push("");
  lines.push(formatEntryPoints(pkg));
  lines.push("");
  lines.push("## Runtime exports");
  lines.push("");
  lines.push(
    "Value exports from `src/index.ts`, classified by inspecting the built ESM module.",
  );
  lines.push("");
  lines.push("| Name | Kind |");
  lines.push("| --- | --- |");
  for (const row of runtimeRows) {
    lines.push(`| \`${row.name}\` | ${row.kind} |`);
  }
  lines.push("");
  lines.push(`**Count**: ${runtimeRows.length}`);
  lines.push("");
  lines.push("## Type-only exports");
  lines.push("");
  lines.push(
    "Names from `export type { ... }` (and `type` members in value export lists) in `src/index.ts`.",
  );
  lines.push("These exist only in the TypeScript declaration surface.");
  lines.push("");
  lines.push("| Name |");
  lines.push("| --- |");
  for (const t of typeOnlySorted) {
    lines.push(`| \`${t}\` |`);
  }
  lines.push("");
  lines.push(`**Count**: ${typeOnlySorted.length}`);
  lines.push("");
  lines.push("## Cross-checks");
  lines.push("");
  lines.push(
    `- Parsed value exports present on runtime module: **${missingAtRuntime.length === 0 ? "yes" : "NO"}**`,
  );
  lines.push(
    `- Runtime keys not listed in \`src/index.ts\` value exports: ${
      unexpectedRuntime.length === 0
        ? "_none_"
        : unexpectedRuntime.map((k) => `\`${k}\``).join(", ")
    }`,
  );
  lines.push(
    `- Type-only names that also exist as runtime values: ${
      typeAlsoRuntime.length === 0
        ? "_none_"
        : typeAlsoRuntime.map((k) => `\`${k}\``).join(", ")
    }`,
  );
  lines.push(
    `- Total distinct public names (runtime + type-only): **${
      new Set([...runtimeRows.map((r) => r.name), ...typeOnlySorted]).size
    }**`,
  );
  lines.push("");
  lines.push("## Declaration output tree (`dist/**/*.d.ts`)");
  lines.push("");
  lines.push(
    "Relative paths under `dist/`, sorted. Source maps (`.d.ts.map`) are omitted.",
  );
  lines.push("");
  for (const f of dtsFiles) {
    lines.push(`- \`${f}\``);
  }
  lines.push("");
  lines.push(`**Count**: ${dtsFiles.length}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- Only symbols re-exported from `src/index.ts` are part of the supported public API.",
  );
  lines.push(
    "- Internal modules under `dist/` (e.g. `dist/utils/currency.d.ts`) may appear in the declaration tree for compiler layout; they are **not** public entry points unless re-exported from `src/index.ts`.",
  );
  lines.push(
    "- Package is **ESM-only** (`\"type\": \"module\"`, `exports[\".\"].import` only).",
  );
  lines.push(
    "- Kind classification uses runtime heuristics (class vs function vs const); see script source for rules.",
  );
  lines.push("");

  writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
  console.log(`[generate-api-baseline] Wrote ${relative(ROOT, OUT_FILE)}`);
  console.log(
    `[generate-api-baseline] runtime=${runtimeRows.length} type-only=${typeOnlySorted.length} d.ts=${dtsFiles.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
