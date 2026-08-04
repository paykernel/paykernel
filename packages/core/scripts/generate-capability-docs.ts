#!/usr/bin/env bun
/**
 * generate-capability-docs.ts
 *
 * Phase 3 capability matrix generator.
 * Reads built-in gateway capability claims from source and writes
 * packages/core/docs/gateway-capabilities.md.
 *
 * Source of truth: packages/core/src/gateways/builtin-capabilities.ts
 * (via generateGatewayCapabilitiesMarkdown + BUILTIN_GATEWAY_MANIFESTS).
 *
 * Usage:
 *   bun run packages/core/scripts/generate-capability-docs.ts
 *   # or from monorepo / core package:
 *   bun run docs:capabilities
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_GATEWAY_MANIFESTS } from "../src/gateways/builtin-capabilities";
import { generateGatewayCapabilitiesMarkdown } from "../src/gateways/capabilities-docs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CORE_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const OUT_FILE = join(CORE_ROOT, "docs", "gateway-capabilities.md");

function main(): void {
  const markdown = generateGatewayCapabilitiesMarkdown(BUILTIN_GATEWAY_MANIFESTS);
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, markdown, "utf8");
  console.log(
    `[generate-capability-docs] wrote ${OUT_FILE} (${BUILTIN_GATEWAY_MANIFESTS.length} providers, ${markdown.length} bytes)`,
  );
}

main();
