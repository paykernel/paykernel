/**
 * Production sources must stay portable: no node: / bun: imports.
 */
import { describe, it, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SRC = join(import.meta.dir);

async function listProdSources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await listProdSources(p)));
    } else if (
      e.isFile() &&
      e.name.endsWith(".ts") &&
      !e.name.endsWith(".test.ts")
    ) {
      files.push(p);
    }
  }
  return files;
}

describe("portability (production sources)", () => {
  it("has no node: or bun: imports in production sources", async () => {
    const files = await listProdSources(SRC);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      // Strip line + block comments so JSDoc examples do not false-positive.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (
        /from\s+["']node:/.test(code) ||
        /from\s+["']bun:/.test(code) ||
        /require\(\s*["']node:/.test(code) ||
        /require\(\s*["']bun:/.test(code)
      ) {
        offenders.push(file);
      }
      if (/\bperf_hooks\b/.test(code)) {
        offenders.push(`${file} (perf_hooks)`);
      }
      if (/from\s+["']@opentelemetry\//.test(code)) {
        offenders.push(`${file} (static otel import)`);
      }
      if (/import\s+["']@opentelemetry\//.test(code)) {
        offenders.push(`${file} (side-effect otel import)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
