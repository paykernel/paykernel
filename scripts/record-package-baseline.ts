#!/usr/bin/env bun
/**
 * record-package-baseline.ts
 *
 * Phase 0 package contents baseline recorder.
 * Records packages/core/dist/index.js size + sha256, walks package.json `files`,
 * and captures `npm pack --dry-run` output when npm is available.
 *
 * Prerequisites:
 *   - packages/core/dist/index.js should exist (run `bun run build` first). This
 *     script will refuse to invent a missing bundle; it does not auto-build to
 *     avoid surprising rebuild side effects during baseline freezes.
 *
 * Usage:
 *   bun run scripts/record-package-baseline.ts
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const CORE = join(ROOT, "packages", "core");
const PACKAGE_JSON = join(CORE, "package.json");
const DIST_INDEX_JS = join(CORE, "dist", "index.js");
const OUT_FILE = join(CORE, "docs", "baseline", "package-contents.md");
const COMMAND = "bun run scripts/record-package-baseline.ts";

function fail(message: string): never {
  console.error(`[record-package-baseline] ${message}`);
  process.exit(1);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function walkFiles(absPath: string, root: string): string[] {
  const out: string[] = [];
  if (!existsSync(absPath)) return out;
  const st = statSync(absPath);
  if (st.isFile()) {
    out.push(relative(root, absPath).split("\\").join("/"));
    return out;
  }
  if (!st.isDirectory()) return out;
  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    // Skip common non-publish noise if present under listed dirs
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    out.push(...walkFiles(join(absPath, entry.name), root));
  }
  return out;
}

/**
 * Simulate npm package file set from package.json `files` + always-included
 * package.json (npm always includes package.json; README/LICENSE if listed or default).
 * We walk only paths listed in `files` plus package.json itself.
 */
function simulatePackageFiles(
  root: string,
  filesField: string[],
): { path: string; bytes: number }[] {
  const collected = new Set<string>();
  // package.json is always included in the tarball
  collected.add("package.json");

  for (const pattern of filesField) {
    // package.json `files` entries are literal paths (dirs or files), not globs,
    // for this package: dist, docs, README.md, LICENSE
    const abs = join(root, pattern);
    for (const rel of walkFiles(abs, root)) {
      collected.add(rel);
    }
  }

  const rows = [...collected]
    .sort((a, b) => a.localeCompare(b))
    .map((rel) => {
      const abs = join(root, rel);
      if (!existsSync(abs)) {
        return { path: rel, bytes: 0 };
      }
      const st = statSync(abs);
      return { path: rel, bytes: st.isFile() ? st.size : 0 };
    })
    .filter((r) => r.bytes > 0 || r.path === "package.json");

  return rows;
}

function tryNpmPackDryRun(root: string): {
  available: boolean;
  raw: string;
  fileLines: string[];
  summary: Record<string, string>;
} {
  const which = spawnSync("npm", ["--version"], {
    encoding: "utf8",
    cwd: root,
  });
  if (which.status !== 0) {
    return {
      available: false,
      raw: "(npm not available)",
      fileLines: [],
      summary: {},
    };
  }

  const result = spawnSync("npm", ["pack", "--dry-run"], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, npm_config_loglevel: "notice" },
  });

  // npm pack --dry-run writes notices to stderr
  const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    return {
      available: true,
      raw: raw || `(npm pack --dry-run failed with status ${result.status})`,
      fileLines: [],
      summary: {},
    };
  }

  const fileLines: string[] = [];
  const summary: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    // File entries: "npm notice <size> <path>" (e.g. "npm notice 220.1kB dist/index.js")
    const contentMatch = /^npm notice\s+([\d.]+[kKmMgG]?B)\s+(\S.+)$/.exec(
      line,
    );
    if (contentMatch) {
      fileLines.push(`${contentMatch[1]}\t${contentMatch[2]}`);
      continue;
    }

    // Meta: "npm notice name: @paykernel/core"
    const metaMatch = /^npm notice\s+([a-zA-Z][a-zA-Z\s]*):\s*(.+)$/.exec(line);
    if (metaMatch) {
      summary[metaMatch[1]!.trim()] = metaMatch[2]!.trim();
    }
  }

  // Prefer sorted file list by path for determinism
  fileLines.sort((a, b) => {
    const pa = a.split("\t")[1] ?? a;
    const pb = b.split("\t")[1] ?? b;
    return pa.localeCompare(pb);
  });

  return { available: true, raw, fileLines, summary };
}

function main(): void {
  if (!existsSync(PACKAGE_JSON)) fail(`Missing ${PACKAGE_JSON}`);
  if (!existsSync(DIST_INDEX_JS)) {
    fail(
      `Missing ${DIST_INDEX_JS}. Run \`bun run build\` before recording the package baseline.`,
    );
  }

  const pkg = readJson(PACKAGE_JSON);
  const name = String(pkg.name ?? "unknown");
  const version = String(pkg.version ?? "unknown");
  const filesField = Array.isArray(pkg.files)
    ? (pkg.files as string[])
    : [];

  const bundleBuf = readFileSync(DIST_INDEX_JS);
  const bundleBytes = bundleBuf.byteLength;
  const bundleSha = createHash("sha256").update(bundleBuf).digest("hex");

  const simulated = simulatePackageFiles(CORE, filesField);
  const simulatedTotal = simulated.reduce((acc, r) => acc + r.bytes, 0);

  const npmPack = tryNpmPackDryRun(CORE);
  const generatedAt = new Date().toISOString();

  const lines: string[] = [];
  lines.push("# Package Contents Baseline");
  lines.push("");
  lines.push(
    "> **Phase 0 freeze artifact.** Records the published file set and primary bundle fingerprint.",
  );
  lines.push(
    "> Do not hand-edit inventory tables; regenerate with the command below.",
  );
  lines.push("");
  lines.push("## Generation metadata");
  lines.push("");
  lines.push(`- **Generated at (UTC)**: ${generatedAt}`);
  lines.push(`- **Command**: \`${COMMAND}\``);
  lines.push(`- **Package**: \`${name}@${version}\``);
  lines.push("");
  lines.push("## Entry points (from package.json)");
  lines.push("");
  lines.push(`- **main**: \`${String(pkg.main ?? "(unset)")}\``);
  lines.push(`- **types**: \`${String(pkg.types ?? "(unset)")}\``);
  lines.push(`- **type**: \`${String(pkg.type ?? "(unset)")}\``);
  lines.push("- **exports**:");
  lines.push("```json");
  lines.push(JSON.stringify(pkg.exports ?? null, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`- **files** field:`);
  lines.push("```json");
  lines.push(JSON.stringify(filesField, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Primary bundle fingerprint");
  lines.push("");
  lines.push("| Path | Bytes | Human | SHA-256 |");
  lines.push("| --- | ---: | --- | --- |");
  lines.push(
    `| \`dist/index.js\` | ${bundleBytes} | ${formatBytes(bundleBytes)} | \`${bundleSha}\` |`,
  );
  lines.push("");
  lines.push(
    "Use this hash to detect unintended bundle changes between Phase 0 freezes.",
  );
  lines.push("");
  lines.push("## Simulated package files (from `files` field)");
  lines.push("");
  lines.push(
    "Walk of paths listed in `package.json#files`, plus always-included `package.json`. Sorted by path.",
  );
  lines.push("");
  lines.push("| Path | Bytes |");
  lines.push("| --- | ---: |");
  for (const row of simulated) {
    lines.push(`| \`${row.path}\` | ${row.bytes} |`);
  }
  lines.push("");
  lines.push(
    `**Count**: ${simulated.length} files · **Total bytes**: ${simulatedTotal} (${formatBytes(simulatedTotal)})`,
  );
  lines.push("");
  lines.push("## npm pack --dry-run");
  lines.push("");
  if (!npmPack.available) {
    lines.push(
      "_npm was not available in PATH when this baseline was recorded. Install npm or re-run on a machine with npm to capture the official pack list._",
    );
  } else if (npmPack.fileLines.length === 0) {
    lines.push("_Could not parse file list from npm pack --dry-run output._");
    lines.push("");
    lines.push("```");
    lines.push(npmPack.raw);
    lines.push("```");
  } else {
    if (Object.keys(npmPack.summary).length > 0) {
      lines.push("### Tarball summary");
      lines.push("");
      lines.push("| Field | Value |");
      lines.push("| --- | --- |");
      const preferredOrder = [
        "name",
        "version",
        "filename",
        "package size",
        "unpacked size",
        "shasum",
        "integrity",
        "total files",
      ];
      const seen = new Set<string>();
      for (const key of preferredOrder) {
        if (key in npmPack.summary) {
          lines.push(`| ${key} | \`${npmPack.summary[key]}\` |`);
          seen.add(key);
        }
      }
      for (const [key, value] of Object.entries(npmPack.summary).sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        if (seen.has(key)) continue;
        lines.push(`| ${key} | \`${value}\` |`);
      }
      lines.push("");
    }
    lines.push("### Tarball file list (sorted by path)");
    lines.push("");
    lines.push("| Size (npm) | Path |");
    lines.push("| --- | --- |");
    for (const row of npmPack.fileLines) {
      const [size, path] = row.split("\t");
      lines.push(`| ${size} | \`${path}\` |`);
    }
    lines.push("");
    lines.push(`**Count**: ${npmPack.fileLines.length} files`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- This baseline freezes **what is published**, not payment business logic.",
  );
  lines.push(
    "- `docs/baseline/*` generated by Phase 0 will appear in the pack once committed (because `docs` is in `files`).",
  );
  lines.push(
    "- Do not add CommonJS dual-publish or change `exports` solely to satisfy packaging tools without treating it as a public contract change.",
  );
  lines.push(
    "- Secrets must never appear in fixtures, pack contents, or this document.",
  );
  lines.push("");

  writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
  console.log(`[record-package-baseline] Wrote ${relative(ROOT, OUT_FILE)}`);
  console.log(
    `[record-package-baseline] dist/index.js=${bundleBytes}B sha256=${bundleSha.slice(0, 12)}… simulated=${simulated.length} npmPackFiles=${npmPack.fileLines.length}`,
  );
}

main();
