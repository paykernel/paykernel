#!/usr/bin/env bun
/**
 * Astro prerender bundles `satteri`, so Node's createRequire runs from
 * dist/.prerender/chunks and cannot see bun's isolated @bruits/satteri-*
 * optional bindings. Point NODE_PATH at satteri's isolated node_modules.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

function packageRoot(fromFile: string): string {
  let dir = dirname(fromFile);
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No package.json above ${fromFile}`);
    }
    dir = parent;
  }
}

function satteriIsolatedNodeModules(): string | undefined {
  const nimbusPkg = join(
    process.cwd(),
    "node_modules/@cloudflare/nimbus-docs/package.json",
  );
  if (!existsSync(nimbusPkg)) return undefined;
  try {
    const require = createRequire(realpathSync(nimbusPkg));
    const entry = realpathSync(require.resolve("satteri"));
    return dirname(packageRoot(entry));
  } catch {
    return undefined;
  }
}

const isolated = satteriIsolatedNodeModules();
const env = { ...process.env };
if (isolated) {
  env.NODE_PATH = env.NODE_PATH
    ? `${isolated}${delimiter}${env.NODE_PATH}`
    : isolated;
}

const args = process.argv.slice(2);
const result = spawnSync("astro", args.length > 0 ? args : ["build"], {
  stdio: "inherit",
  env,
});

process.exit(result.status ?? 1);
