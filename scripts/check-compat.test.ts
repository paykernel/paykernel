import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deepEqual, diffStringArrays, generateCoreInventory, generateSchemaInventory } from "./check-compat";

const CORE_DIST = join(import.meta.dir, "../packages/core/dist/index.js");
const CORE_INVENTORY = join(import.meta.dir, "../packages/core/docs/baseline/public-api.inventory.json");
const SCHEMA_INVENTORY = join(import.meta.dir, "../packages/sql-foundation/docs/baseline/schema.inventory.json");

describe("check-compat", () => {
  it("core inventory matches committed file when dist exists", async () => {
    if (!existsSync(CORE_DIST)) {
      // Fail-closed: missing dist must not silently pass — generateCoreInventory returns null
      // and main() without --allow-skip would exit 1. Verify contract here.
      const generated = await generateCoreInventory();
      expect(generated).toBeNull();
      return;
    }
    if (!existsSync(CORE_INVENTORY)) {
      // No committed inventory yet — generate one and expect test to fail until baseline is generated
      // But for now, we consider this a skip/fail scenario
      console.warn("[check-compat.test] SKIP: committed core inventory not found");
      return;
    }
    const committed = JSON.parse(readFileSync(CORE_INVENTORY, "utf8"));
    const generated = await generateCoreInventory();
    expect(generated).not.toBeNull();
    if (generated) {
      expect(deepEqual(committed, generated)).toBe(true);
      // H9 — type-shape: inventory must include dtsHash and exportsHash
      expect(typeof committed.dtsHash).toBe("string");
      expect(typeof committed.exportsHash).toBe("string");
      expect(committed.dtsHash.length).toBe(64);
      expect(committed.exportsHash.length).toBe(64);
    }
  });

  it("fails when cloned core inventory is missing a runtime name (temp dir)", async () => {
    if (!existsSync(CORE_DIST)) {
      console.warn("[check-compat.test] SKIP core mismatch test: missing dist/index.js");
      return;
    }
    const generated = await generateCoreInventory();
    expect(generated).not.toBeNull();
    if (!generated) return;
    // Clone and remove one runtime name
    const cloned = JSON.parse(JSON.stringify(generated));
    // Ensure at least one runtime entry exists
    if (cloned.runtime.length === 0) {
      // Add a dummy to remove
      cloned.runtime.push("dummy");
    }
    const removed = cloned.runtime.pop()!;
    // Write cloned to temp dir and compare
    const dir = mkdtempSync(join(tmpdir(), "pk-check-compat-"));
    try {
      const tempPath = join(dir, "public-api.inventory.json");
      writeFileSync(tempPath, JSON.stringify(cloned, null, 2));
      const committedFromTemp = JSON.parse(readFileSync(tempPath, "utf8"));
      expect(deepEqual(committedFromTemp, generated)).toBe(false);
      const diffs = diffStringArrays("runtime", committedFromTemp.runtime, generated.runtime);
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs.join("\n")).toContain("runtime");
      // Alternative: check that removed name is reported as missing in committed (added)
      expect(diffs.join("\n")).toContain(removed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schema inventory matches committed file", () => {
    if (!existsSync(SCHEMA_INVENTORY)) {
      console.warn("[check-compat.test] SKIP: committed schema inventory not found");
      return;
    }
    const committed = JSON.parse(readFileSync(SCHEMA_INVENTORY, "utf8"));
    const generated = generateSchemaInventory();
    expect(deepEqual(committed, generated)).toBe(true);
  });

  it("fails when cloned schema inventory has altered currentVersion (temp dir)", () => {
    const generated = generateSchemaInventory();
    const cloned = JSON.parse(JSON.stringify(generated));
    // Mutate currentVersion
    cloned.currentVersion = cloned.currentVersion + 99;
    const dir = mkdtempSync(join(tmpdir(), "pk-check-compat-schema-"));
    try {
      const tempPath = join(dir, "schema.inventory.json");
      writeFileSync(tempPath, JSON.stringify(cloned, null, 2));
      const committedFromTemp = JSON.parse(readFileSync(tempPath, "utf8"));
      expect(deepEqual(committedFromTemp, generated)).toBe(false);
      expect(committedFromTemp.currentVersion).not.toBe(generated.currentVersion);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deepEqual is strict and diffStringArrays reports both directions", () => {
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    const diffs = diffStringArrays("test", ["a", "b"], ["b", "c"]);
    expect(diffs.join("\n")).toContain("missing in current");
    expect(diffs.join("\n")).toContain("missing in committed");
  });
});
