/**
 * Unit tests for Phase 8.4/8.5 runtime portability checker.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyPortableSpecifier,
  extractImportSpecifiers,
  isTestFile,
  scanCoreDist,
  scanCoreSrc,
  scanFile,
} from "./check-runtime-portability";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "runtime-port-"));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe("isTestFile", () => {
  it.each([
    ["src/client.test.ts", true],
    ["src/public-api.types.test.ts", true],
    ["src/client.ts", false],
    ["dist/index.js", false],
  ] as const)("%s → %s", (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });
});

describe("extractImportSpecifiers", () => {
  it("extracts static and dynamic imports", () => {
    const source = `
      import { a } from "node:crypto";
      import { b } from "./local";
      const x = await import("zod");
      import "side-effect";
    `;
    const specs = extractImportSpecifiers(source);
    expect(specs).toEqual(
      expect.arrayContaining(["node:crypto", "./local", "zod", "side-effect"]),
    );
  });
});

describe("classifyPortableSpecifier", () => {
  it.each([
    ["./x", true],
    ["../runtime", true],
    ["zod", true],
  ] as const)("allows %s", (spec, ok) => {
    expect(classifyPortableSpecifier(spec).ok).toBe(ok);
  });

  it.each([
    ["node:crypto", false],
    ["node:buffer", false],
    ["node:fs", false],
    ["bun:sqlite", false],
    ["crypto", false],
    ["buffer", false],
    ["fs", false],
  ] as const)("rejects %s", (spec, ok) => {
    expect(classifyPortableSpecifier(spec).ok).toBe(ok);
  });
});

describe("scanFile", () => {
  it("flags node:crypto imports", () => {
    const root = createTempRoot();
    const file = join(root, "bad.ts");
    writeFileSync(file, `import { createHmac } from "node:crypto";\n`);
    const v = scanFile(file, root);
    expect(v.length).toBe(1);
    expect(v[0]!.specifier).toBe("node:crypto");
  });

  it("allows pure relative imports", () => {
    const root = createTempRoot();
    const file = join(root, "ok.ts");
    writeFileSync(file, `import { hmacSha256Hex } from "./crypto-portable";\n`);
    expect(scanFile(file, root)).toEqual([]);
  });
});

describe("scanCoreSrc (live monorepo)", () => {
  it("packages/core production sources have no banned node: imports", () => {
    const root = join(import.meta.dir, "..");
    const violations = scanCoreSrc(root);
    expect(violations).toEqual([]);
  });
});

describe("scanCoreDist fixture", () => {
  it("flags node: in dist js when present", () => {
    const root = createTempRoot();
    const dist = join(root, "packages", "core", "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      join(dist, "index.js"),
      `import { createHash } from "node:crypto";\nexport {};\n`,
    );
    const result = scanCoreDist(root);
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.violations.some((v) => v.specifier === "node:crypto")).toBe(
        true,
      );
    }
  });
});

describe("scanCoreDist (live monorepo, when built)", () => {
  it("packages/core/dist has no banned node: imports when present", () => {
    const root = join(import.meta.dir, "..");
    const result = scanCoreDist(root);
    if (result.skipped) {
      // Build may not have run in an isolated unit-test path; src scan still gates.
      expect(result.reason).toMatch(/missing|build/i);
      return;
    }
    expect(result.violations).toEqual([]);
  });
});
