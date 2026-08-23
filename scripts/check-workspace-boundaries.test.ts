/**
 * Behavior tests for the workspace boundary checker (Phase 1.2).
 * Uses in-memory package fixtures and temp dirs; does not mutate packages/core.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildWorkspaceDepGraph,
  checkAdapterRootEntry,
  checkCoreDependencies,
  checkGatewayPackageDependencies,
  checkInternalPrivate,
  checkPhase10DependencyMatrix,
  checkPortableSourceImports,
  classifyPortableImport,
  discoverWorkspacePackages,
  extractImportSpecifiers,
  findCycles,
  isAdapterPackageName,
  isGatewayPackageName,
  isInternalPackagePath,
  isPortablePackage,
  isTestFile,
  runChecks,
  type WorkspacePackage,
} from "./check-workspace-boundaries";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "ws-boundaries-"));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of temp fixtures
    }
  }
});

function makePackage(
  partial: Partial<WorkspacePackage> & {
    name: string;
    relDir: string;
    dir?: string;
  },
): WorkspacePackage {
  return {
    dir: partial.dir ?? `/virtual/${partial.relDir}`,
    relDir: partial.relDir,
    name: partial.name,
    manifest: partial.manifest ?? { name: partial.name },
  };
}

describe("path classification helpers", () => {
  it.each([
    ["src/client.test.ts", true],
    ["src/public-api.types.test.ts", true],
    ["src/hooks/hooks.manager.spec.ts", true],
    ["src/client.ts", false],
    ["src/index.d.ts", false],
  ] as const)("isTestFile(%s) → %s", (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });

  it.each([
    ["@paykernel/store-sqlite", true],
    ["@paykernel/core", false],
    ["@paykernel/webhooks", false],
  ] as const)("isAdapterPackageName(%s) → %s", (name, expected) => {
    expect(isAdapterPackageName(name)).toBe(expected);
  });

  it.each([
    ["@paykernel/gateway-tap", true],
    ["@paykernel/gateway-myfatoorah", true],
    ["@paykernel/core", false],
    ["@paykernel/store-sqlite", false],
  ] as const)("isGatewayPackageName(%s) → %s", (name, expected) => {
    expect(isGatewayPackageName(name)).toBe(expected);
  });

  it.each([
    ["internal/sql-store", true],
    ["packages/internal/foo", true],
    ["packages/core", false],
  ] as const)("isInternalPackagePath(%s) → %s", (relDir, expected) => {
    expect(isInternalPackagePath(relDir)).toBe(expected);
  });
});

describe("extractImportSpecifiers", () => {
  it("extracts static, type, side-effect, and dynamic import targets", () => {
    const source = `
      import { a } from "node:crypto";
      import type { B } from "./local";
      export { C } from "zod";
      import "side-effect";
      const x = await import("bun:sqlite");
    `;
    const specs = extractImportSpecifiers(source);
    expect(specs).toEqual(
      expect.arrayContaining(["node:crypto", "./local", "zod", "side-effect", "bun:sqlite"]),
    );
  });
});

describe("classifyPortableImport", () => {
  it.each([
    ["./x", true],
    ["../types", true],
    ["zod", true],
  ] as const)("allows portable specifier %s", (spec, ok) => {
    expect(classifyPortableImport(spec).ok).toBe(ok);
  });

  it.each([
    ["node:crypto", false],
    ["node:buffer", false],
    ["node:fs", false],
    ["bun:sqlite", false],
    ["cloudflare:workers", false],
    ["fs", false],
    ["path", false],
    ["bun:test", false],
  ] as const)("rejects non-portable specifier %s", (spec, ok) => {
    expect(classifyPortableImport(spec).ok).toBe(ok);
  });
});

describe("checkCoreDependencies", () => {
  it("rejects adapter package dependencies declared on core", () => {
    const core = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: {
          "@paykernel/store-postgres": "workspace:*",
        },
      },
    });
    const violations = checkCoreDependencies(core);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe("a/core-no-adapters");
  });

  it("rejects path-style adapter dependencies on core", () => {
    const core = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: {
          localAdapter: "file:../store-postgres",
        },
      },
    });
    const violations = checkCoreDependencies(core);
    expect(violations.some((v) => v.rule === "a/core-no-adapters")).toBe(true);
  });

  it("allows non-adapter dependencies such as zod on core", () => {
    const core = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { zod: "3.25.76" },
      },
    });
    expect(checkCoreDependencies(core)).toEqual([]);
  });

  it("rejects core → webhooks, reconciliation, observability, routing, and testkit dependencies", () => {
    const withWebhooks = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { "@paykernel/webhooks": "workspace:*" },
      },
    });
    const withReconciliation = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { "@paykernel/reconciliation": "workspace:*" },
      },
    });
    const withObservability = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { "@paykernel/opentelemetry": "workspace:*" },
      },
    });
    const withRouting = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { "@paykernel/routing": "workspace:*" },
      },
    });
    const withTestkit = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        devDependencies: { "@paykernel/testkit": "workspace:*" },
      },
    });
    expect(
      checkCoreDependencies(withWebhooks).some((v) => v.rule === "a/core-no-webhooks-testkit"),
    ).toBe(true);
    expect(
      checkCoreDependencies(withReconciliation).some(
        (v) => v.rule === "a/core-no-webhooks-testkit",
      ),
    ).toBe(true);
    expect(
      checkCoreDependencies(withObservability).some(
        (v) => v.rule === "a/core-no-webhooks-testkit",
      ),
    ).toBe(true);
    expect(
      checkCoreDependencies(withRouting).some((v) => v.rule === "a/core-no-webhooks-testkit"),
    ).toBe(true);
    expect(
      checkCoreDependencies(withTestkit).some((v) => v.rule === "a/core-no-webhooks-testkit"),
    ).toBe(true);
  });

  it("rejects core → sql-store dependencies (Phase 11)", () => {
    const withSqlStore = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { "@paykernel/internal-sql-store": "workspace:*" },
      },
    });
    const withPath = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { "sql-store": "file:../../internal/sql-store" },
      },
    });
    expect(checkCoreDependencies(withSqlStore).some((v) => v.rule === "a/core-no-sql-store")).toBe(
      true,
    );
    expect(checkCoreDependencies(withPath).some((v) => v.rule === "a/core-no-sql-store")).toBe(
      true,
    );
  });

  it("rejects core → @opentelemetry/* dependencies (Phase 20)", () => {
    const withOtelApi = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        dependencies: { "@opentelemetry/api": "^1.9.0" },
      },
    });
    const withOtelSdk = makePackage({
      name: "@paykernel/core",
      relDir: "packages/core",
      manifest: {
        name: "@paykernel/core",
        peerDependencies: { "@opentelemetry/sdk-trace-base": "^1.0.0" },
      },
    });
    expect(
      checkCoreDependencies(withOtelApi).some((v) => v.rule === "a/core-no-opentelemetry"),
    ).toBe(true);
    expect(
      checkCoreDependencies(withOtelSdk).some((v) => v.rule === "a/core-no-opentelemetry"),
    ).toBe(true);
  });
});

describe("checkPhase10DependencyMatrix", () => {
  it("rejects webhooks → testkit", () => {
    const webhooks = makePackage({
      name: "@paykernel/webhooks",
      relDir: "packages/webhooks",
      manifest: {
        name: "@paykernel/webhooks",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/testkit": "workspace:*",
        },
      },
    });
    const violations = checkPhase10DependencyMatrix(webhooks);
    expect(violations.some((v) => v.rule === "a/webhooks-no-testkit")).toBe(true);
  });

  it("rejects webhooks → redis clients", () => {
    const webhooks = makePackage({
      name: "@paykernel/webhooks",
      relDir: "packages/webhooks",
      manifest: {
        name: "@paykernel/webhooks",
        dependencies: { ioredis: "^5.0.0" },
      },
    });
    expect(
      checkPhase10DependencyMatrix(webhooks).some((v) => v.rule === "a/webhooks-no-redis"),
    ).toBe(true);
  });

  it("allows webhooks → core only", () => {
    const webhooks = makePackage({
      name: "@paykernel/webhooks",
      relDir: "packages/webhooks",
      manifest: {
        name: "@paykernel/webhooks",
        dependencies: { "@paykernel/core": "workspace:*" },
      },
    });
    expect(checkPhase10DependencyMatrix(webhooks)).toEqual([]);
  });

  it("allows testkit → core + webhooks + reconciliation", () => {
    const testkit = makePackage({
      name: "@paykernel/testkit",
      relDir: "packages/testkit",
      manifest: {
        name: "@paykernel/testkit",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/webhooks": "workspace:*",
          "@paykernel/reconciliation": "workspace:*",
        },
      },
    });
    expect(checkPhase10DependencyMatrix(testkit)).toEqual([]);
  });

  it("rejects webhooks → reconciliation (Phase 19 independence)", () => {
    const webhooks = makePackage({
      name: "@paykernel/webhooks",
      relDir: "packages/webhooks",
      manifest: {
        name: "@paykernel/webhooks",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/reconciliation": "workspace:*",
        },
      },
    });
    expect(
      checkPhase10DependencyMatrix(webhooks).some(
        (v) => v.rule === "a/webhooks-no-reconciliation",
      ),
    ).toBe(true);
  });

  it("allows reconciliation → core only (Phase 19)", () => {
    const recon = makePackage({
      name: "@paykernel/reconciliation",
      relDir: "packages/reconciliation",
      manifest: {
        name: "@paykernel/reconciliation",
        dependencies: { "@paykernel/core": "workspace:*" },
      },
    });
    expect(checkPhase10DependencyMatrix(recon)).toEqual([]);
  });

  it("rejects reconciliation → testkit / webhooks / adapters / redis / sql-store (Phase 19)", () => {
    const base = {
      name: "@paykernel/reconciliation",
      relDir: "packages/reconciliation",
    } as const;

    const toTestkit = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/testkit": "workspace:*" },
      },
    });
    const toWebhooks = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/webhooks": "workspace:*" },
      },
    });
    const toAdapter = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/store-postgres": "workspace:*" },
      },
    });
    const toRedis = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { ioredis: "^5.0.0" },
      },
    });
    const toSqlStore = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: {
          "@paykernel/internal-sql-store": "workspace:*",
        },
      },
    });

    expect(
      checkPhase10DependencyMatrix(toTestkit).some(
        (v) => v.rule === "a/reconciliation-no-testkit",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toWebhooks).some(
        (v) => v.rule === "a/reconciliation-no-webhooks",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toAdapter).some(
        (v) => v.rule === "a/reconciliation-no-adapters",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toRedis).some(
        (v) => v.rule === "a/reconciliation-no-redis",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toSqlStore).some(
        (v) => v.rule === "a/reconciliation-no-sql-store",
      ),
    ).toBe(true);
  });

  it("allows observability → core only (Phase 20)", () => {
    const obs = makePackage({
      name: "@paykernel/opentelemetry",
      relDir: "packages/observability",
      manifest: {
        name: "@paykernel/opentelemetry",
        dependencies: { "@paykernel/core": "workspace:*" },
        peerDependencies: { "@opentelemetry/api": ">=1.0.0" },
        peerDependenciesMeta: {
          "@opentelemetry/api": { optional: true },
        },
        paymentsSdk: { portable: true },
      },
    });
    expect(checkPhase10DependencyMatrix(obs)).toEqual([]);
    expect(isPortablePackage(obs)).toBe(true);
  });

  it("rejects observability → testkit / webhooks / reconciliation / adapters / redis / sql-store (Phase 20)", () => {
    const base = {
      name: "@paykernel/opentelemetry",
      relDir: "packages/observability",
    } as const;

    const toTestkit = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/testkit": "workspace:*" },
      },
    });
    const toWebhooks = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/webhooks": "workspace:*" },
      },
    });
    const toRecon = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/reconciliation": "workspace:*" },
      },
    });
    const toAdapter = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/store-postgres": "workspace:*" },
      },
    });
    const toRedis = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { ioredis: "^5.0.0" },
      },
    });
    const toSqlStore = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: {
          "@paykernel/internal-sql-store": "workspace:*",
        },
      },
    });

    expect(
      checkPhase10DependencyMatrix(toTestkit).some(
        (v) => v.rule === "a/observability-no-testkit",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toWebhooks).some(
        (v) => v.rule === "a/observability-no-webhooks",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toRecon).some(
        (v) => v.rule === "a/observability-no-reconciliation",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toAdapter).some(
        (v) => v.rule === "a/observability-no-adapters",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toRedis).some((v) => v.rule === "a/observability-no-redis"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toSqlStore).some(
        (v) => v.rule === "a/observability-no-sql-store",
      ),
    ).toBe(true);
  });

  it("rejects webhooks / reconciliation → observability (Phase 20 app composition)", () => {
    const webhooks = makePackage({
      name: "@paykernel/webhooks",
      relDir: "packages/webhooks",
      manifest: {
        name: "@paykernel/webhooks",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/opentelemetry": "workspace:*",
        },
      },
    });
    const recon = makePackage({
      name: "@paykernel/reconciliation",
      relDir: "packages/reconciliation",
      manifest: {
        name: "@paykernel/reconciliation",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/opentelemetry": "workspace:*",
        },
      },
    });
    expect(
      checkPhase10DependencyMatrix(webhooks).some(
        (v) => v.rule === "a/webhooks-no-observability",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(recon).some(
        (v) => v.rule === "a/reconciliation-no-observability",
      ),
    ).toBe(true);
  });

  it("allows routing → core only (Phase 21)", () => {
    const routing = makePackage({
      name: "@paykernel/routing",
      relDir: "packages/routing",
      manifest: {
        name: "@paykernel/routing",
        dependencies: { "@paykernel/core": "workspace:*" },
        paymentsSdk: { portable: true },
      },
    });
    expect(checkPhase10DependencyMatrix(routing)).toEqual([]);
    expect(isPortablePackage(routing)).toBe(true);
  });

  it("rejects routing → testkit / webhooks / reconciliation / observability / adapters / redis / sql-store (Phase 21)", () => {
    const base = {
      name: "@paykernel/routing",
      relDir: "packages/routing",
    } as const;

    const toTestkit = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/testkit": "workspace:*" },
      },
    });
    const toWebhooks = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/webhooks": "workspace:*" },
      },
    });
    const toRecon = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/reconciliation": "workspace:*" },
      },
    });
    const toObs = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/opentelemetry": "workspace:*" },
      },
    });
    const toAdapter = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { "@paykernel/store-postgres": "workspace:*" },
      },
    });
    const toRedis = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: { ioredis: "^5.0.0" },
      },
    });
    const toSqlStore = makePackage({
      ...base,
      manifest: {
        name: base.name,
        dependencies: {
          "@paykernel/internal-sql-store": "workspace:*",
        },
      },
    });

    expect(
      checkPhase10DependencyMatrix(toTestkit).some((v) => v.rule === "a/routing-no-testkit"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toWebhooks).some((v) => v.rule === "a/routing-no-webhooks"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toRecon).some(
        (v) => v.rule === "a/routing-no-reconciliation",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toObs).some((v) => v.rule === "a/routing-no-observability"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toAdapter).some((v) => v.rule === "a/routing-no-adapters"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toRedis).some((v) => v.rule === "a/routing-no-redis"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(toSqlStore).some((v) => v.rule === "a/routing-no-sql-store"),
    ).toBe(true);
  });

  it("rejects webhooks / reconciliation → routing (Phase 21 app composition)", () => {
    const webhooks = makePackage({
      name: "@paykernel/webhooks",
      relDir: "packages/webhooks",
      manifest: {
        name: "@paykernel/webhooks",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/routing": "workspace:*",
        },
      },
    });
    const recon = makePackage({
      name: "@paykernel/reconciliation",
      relDir: "packages/reconciliation",
      manifest: {
        name: "@paykernel/reconciliation",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/routing": "workspace:*",
        },
      },
    });
    expect(
      checkPhase10DependencyMatrix(webhooks).some((v) => v.rule === "a/webhooks-no-routing"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(recon).some((v) => v.rule === "a/reconciliation-no-routing"),
    ).toBe(true);
  });

  it("rejects webhooks → sql-store (Phase 11)", () => {
    const webhooks = makePackage({
      name: "@paykernel/webhooks",
      relDir: "packages/webhooks",
      manifest: {
        name: "@paykernel/webhooks",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/internal-sql-store": "workspace:*",
        },
      },
    });
    expect(
      checkPhase10DependencyMatrix(webhooks).some((v) => v.rule === "a/webhooks-no-sql-store"),
    ).toBe(true);
  });

  it("rejects sql-store → core or webhooks or reconciliation (Phase 11 / 19)", () => {
    const withCore = makePackage({
      name: "@paykernel/internal-sql-store",
      relDir: "internal/sql-store",
      manifest: {
        name: "@paykernel/internal-sql-store",
        private: true,
        dependencies: { "@paykernel/core": "workspace:*" },
      },
    });
    const withWebhooks = makePackage({
      name: "@paykernel/internal-sql-store",
      relDir: "internal/sql-store",
      manifest: {
        name: "@paykernel/internal-sql-store",
        private: true,
        dependencies: { "@paykernel/webhooks": "workspace:*" },
      },
    });
    const withRecon = makePackage({
      name: "@paykernel/internal-sql-store",
      relDir: "internal/sql-store",
      manifest: {
        name: "@paykernel/internal-sql-store",
        private: true,
        dependencies: { "@paykernel/reconciliation": "workspace:*" },
      },
    });
    expect(
      checkPhase10DependencyMatrix(withCore).some((v) => v.rule === "a/sql-store-no-core-webhooks"),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(withWebhooks).some(
        (v) => v.rule === "a/sql-store-no-core-webhooks",
      ),
    ).toBe(true);
    expect(
      checkPhase10DependencyMatrix(withRecon).some(
        (v) => v.rule === "a/sql-store-no-core-webhooks",
      ),
    ).toBe(true);
  });
});

describe("checkInternalPrivate", () => {
  it("requires private:true for packages under internal/", () => {
    const publishableInternal = makePackage({
      name: "@paykernel/internal-sql",
      relDir: "internal/sql-store",
      manifest: { name: "@paykernel/internal-sql", private: false },
    });
    expect(checkInternalPrivate(publishableInternal)[0]!.rule).toBe("e/internal-private");
  });

  it("accepts private:true for internal packages", () => {
    const privateInternal = makePackage({
      name: "@paykernel/internal-sql",
      relDir: "internal/sql-store",
      manifest: { name: "@paykernel/internal-sql", private: true },
    });
    expect(checkInternalPrivate(privateInternal)).toEqual([]);
  });
});

describe("workspace dependency cycles", () => {
  it("reports a cycle when A depends on B and B depends on A", () => {
    const packages: WorkspacePackage[] = [
      makePackage({
        name: "pkg-a",
        relDir: "packages/a",
        manifest: {
          name: "pkg-a",
          dependencies: { "pkg-b": "workspace:*" },
        },
      }),
      makePackage({
        name: "pkg-b",
        relDir: "packages/b",
        manifest: {
          name: "pkg-b",
          dependencies: { "pkg-a": "workspace:*" },
        },
      }),
    ];
    const cycles = findCycles(buildWorkspaceDepGraph(packages));
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("reports no cycles for a one-way A → B dependency", () => {
    const packages: WorkspacePackage[] = [
      makePackage({
        name: "pkg-a",
        relDir: "packages/a",
        manifest: { name: "pkg-a", dependencies: { "pkg-b": "workspace:*" } },
      }),
      makePackage({
        name: "pkg-b",
        relDir: "packages/b",
        manifest: { name: "pkg-b" },
      }),
    ];
    expect(findCycles(buildWorkspaceDepGraph(packages))).toEqual([]);
  });

  it("links packages connected only by file: path versions", () => {
    const packages: WorkspacePackage[] = [
      makePackage({
        name: "pkg-a",
        relDir: "packages/a",
        manifest: {
          name: "pkg-a",
          dependencies: { localB: "file:../b" },
        },
      }),
      makePackage({
        name: "pkg-b",
        relDir: "packages/b",
        manifest: { name: "pkg-b" },
      }),
    ];
    const edges = buildWorkspaceDepGraph(packages).get("pkg-a");
    expect([...edges!]).toContain("pkg-b");
  });
});

describe("on-disk fixture packages", () => {
  it("flags node:fs in portable production source but ignores test files", () => {
    const root = createTempRoot();
    const packageDir = join(root, "packages", "core");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@paykernel/core", version: "0.0.0" }),
    );
    writeFileSync(
      join(packageDir, "src", "bad.ts"),
      `import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n`,
    );
    writeFileSync(
      join(packageDir, "src", "ok.test.ts"),
      `import { describe } from "bun:test";\nimport { readFileSync } from "node:fs";\n`,
    );

    const packages = discoverWorkspacePackages(root);
    expect(packages).toHaveLength(1);
    const violations = checkPortableSourceImports(packages[0]!, root);
    expect(violations.some((v) => v.rule === "b/portable-imports")).toBe(true);
    expect(violations.every((v) => !v.file?.includes("ok.test.ts"))).toBe(true);
  });

  it("flags optional peer drivers imported from an adapter root entry", () => {
    const root = createTempRoot();
    const packageDir = join(root, "packages", "store-sqlite");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@paykernel/store-sqlite",
        version: "0.0.0",
        main: "./src/index.ts",
        exports: { ".": "./src/index.ts" },
      }),
    );
    writeFileSync(
      join(packageDir, "src", "index.ts"),
      `import { Database } from "bun:sqlite";\nexport const db = Database;\n`,
    );

    const packages = discoverWorkspacePackages(root);
    const adapter = packages.find((p) => p.name.includes("store-sqlite"))!;
    expect(isPortablePackage(adapter)).toBe(false);
    const violations = checkAdapterRootEntry(adapter, root);
    expect(violations.some((v) => v.rule === "c/adapter-root-drivers")).toBe(true);
  });

  it("flags postgres.js and drizzle-orm on adapter root (Phase 12 optional drivers)", () => {
    const root = createTempRoot();
    const packageDir = join(root, "packages", "store-postgres");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@paykernel/store-postgres",
        version: "0.0.0",
        main: "./src/index.ts",
        exports: { ".": "./src/index.ts" },
      }),
    );
    writeFileSync(
      join(packageDir, "src", "index.ts"),
      `import postgres from "postgres";\nimport { pgTable } from "drizzle-orm/pg-core";\nexport const sql = postgres;\nexport { pgTable };\n`,
    );

    const packages = discoverWorkspacePackages(root);
    const adapter = packages.find((p) => p.name.includes("store-postgres"))!;
    const violations = checkAdapterRootEntry(adapter, root);
    expect(violations.some((v) => v.message.includes('"postgres"'))).toBe(true);
    // drizzle-orm/pg-core is a subpath; root package name is still checked as bare "drizzle-orm"
    // only when imported as "drizzle-orm". Document that bare optional drivers are banned:
    writeFileSync(
      join(packageDir, "src", "index.ts"),
      `import { sql } from "drizzle-orm";\nexport { sql };\n`,
    );
    const violations2 = checkAdapterRootEntry(adapter, root);
    expect(violations2.some((v) => v.message.includes('"drizzle-orm"'))).toBe(true);
  });

  it("flags redis / @upstash/redis on adapter root (Phase 13 optional drivers)", () => {
    const root = createTempRoot();
    const packageDir = join(root, "packages", "store-redis");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@paykernel/store-redis",
        version: "0.0.0",
        main: "./src/index.ts",
        exports: { ".": "./src/index.ts" },
      }),
    );
    writeFileSync(
      join(packageDir, "src", "index.ts"),
      `import Redis from "ioredis";\nimport { createClient } from "redis";\nexport { Redis, createClient };\n`,
    );

    const packages = discoverWorkspacePackages(root);
    const adapter = packages.find((p) => p.name.includes("store-redis"))!;
    const violations = checkAdapterRootEntry(adapter, root);
    expect(violations.some((v) => v.message.includes('"ioredis"'))).toBe(true);
    expect(violations.some((v) => v.message.includes('"redis"'))).toBe(true);

    writeFileSync(
      join(packageDir, "src", "index.ts"),
      `import { Redis } from "@upstash/redis";\nexport { Redis };\n`,
    );
    const violations2 = checkAdapterRootEntry(adapter, root);
    expect(violations2.some((v) => v.message.includes('"@upstash/redis"'))).toBe(
      true,
    );
  });

  it("accepts a pure-portable core fixture with no boundary violations", () => {
    const root = createTempRoot();
    const packageDir = join(root, "packages", "core");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@paykernel/core",
        version: "0.0.0",
        dependencies: { zod: "3.25.76" },
      }),
    );
    writeFileSync(
      join(packageDir, "src", "index.ts"),
      `export function hmacSha256Hex(_k: string, _m: string): string { return "00"; }\n`,
    );

    const packages = discoverWorkspacePackages(root);
    expect(runChecks(packages, root)).toEqual([]);
  });

  it("rejects node:crypto in portable production core source (Phase 8)", () => {
    const root = createTempRoot();
    const packageDir = join(root, "packages", "core");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@paykernel/core",
        version: "0.0.0",
        dependencies: { zod: "3.25.76" },
      }),
    );
    writeFileSync(
      join(packageDir, "src", "index.ts"),
      `import { createHmac } from "node:crypto";\nexport { createHmac };\n`,
    );

    const packages = discoverWorkspacePackages(root);
    const violations = runChecks(packages, root);
    expect(violations.some((v) => v.rule === "b/portable-imports")).toBe(true);
  });
});

describe("Phase 23 gateway packages", () => {
  it("treats @paykernel/gateway-* with paymentsSdk.portable:true as portable", () => {
    const pkg = makePackage({
      name: "@paykernel/gateway-tap",
      relDir: "packages/gateway-tap",
      manifest: {
        name: "@paykernel/gateway-tap",
        paymentsSdk: { portable: true },
      },
    });
    expect(isPortablePackage(pkg)).toBe(true);
  });

  it("does not treat unmarked @paykernel/gateway-* as portable", () => {
    const pkg = makePackage({
      name: "@paykernel/gateway-other",
      relDir: "packages/gateway-other",
      manifest: { name: "@paykernel/gateway-other" },
    });
    expect(isPortablePackage(pkg)).toBe(false);
  });

  it("allows core runtime dep and testkit in devDependencies", () => {
    const pkg = makePackage({
      name: "@paykernel/gateway-tap",
      relDir: "packages/gateway-tap",
      manifest: {
        name: "@paykernel/gateway-tap",
        paymentsSdk: { portable: true },
        dependencies: { "@paykernel/core": "workspace:*" },
        devDependencies: { "@paykernel/testkit": "workspace:*" },
      },
    });
    expect(checkGatewayPackageDependencies(pkg)).toEqual([]);
  });

  it("rejects testkit in runtime dependencies", () => {
    const pkg = makePackage({
      name: "@paykernel/gateway-tap",
      relDir: "packages/gateway-tap",
      manifest: {
        name: "@paykernel/gateway-tap",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/testkit": "workspace:*",
        },
      },
    });
    const violations = checkGatewayPackageDependencies(pkg);
    expect(violations.some((v) => v.rule === "a/gateway-no-runtime-testkit")).toBe(
      true,
    );
  });

  it("rejects webhooks / store / sibling gateway runtime deps", () => {
    const pkg = makePackage({
      name: "@paykernel/gateway-tap",
      relDir: "packages/gateway-tap",
      manifest: {
        name: "@paykernel/gateway-tap",
        dependencies: {
          "@paykernel/core": "workspace:*",
          "@paykernel/webhooks": "workspace:*",
          "@paykernel/store-sqlite": "workspace:*",
          "@paykernel/gateway-other": "workspace:*",
        },
      },
    });
    const violations = checkGatewayPackageDependencies(pkg);
    expect(violations.filter((v) => v.rule === "a/gateway-core-only").length).toBe(
      3,
    );
  });
});

describe("live monorepo packages", () => {
  it("discovers core, webhooks, reconciliation, observability, routing, testkit, sql-store, adapters and passes the full boundary suite", () => {
    const root = join(import.meta.dir, "..");
    const packages = discoverWorkspacePackages(root);
    const names = new Set(packages.map((p) => p.name));
    expect(names.has("@paykernel/core")).toBe(true);
    expect(names.has("@paykernel/webhooks")).toBe(true);
    expect(names.has("@paykernel/reconciliation")).toBe(true);
    expect(names.has("@paykernel/opentelemetry")).toBe(true);
    expect(names.has("@paykernel/routing")).toBe(true);
    expect(names.has("@paykernel/gateway-tap")).toBe(true);
    expect(names.has("@paykernel/gateway-myfatoorah")).toBe(true);
    expect(names.has("@paykernel/testkit")).toBe(true);
    expect(names.has("@paykernel/internal-sql-store")).toBe(true);
    expect(names.has("@paykernel/store-postgres")).toBe(true);
    expect(names.has("@paykernel/store-redis")).toBe(true);
    const observability = packages.find((p) => p.name === "@paykernel/opentelemetry")!;
    expect(isPortablePackage(observability)).toBe(true);
    const routing = packages.find((p) => p.name === "@paykernel/routing")!;
    expect(isPortablePackage(routing)).toBe(true);
    const tap = packages.find((p) => p.name === "@paykernel/gateway-tap")!;
    expect(isPortablePackage(tap)).toBe(true);
    const myfatoorah = packages.find(
      (p) => p.name === "@paykernel/gateway-myfatoorah",
    )!;
    expect(isPortablePackage(myfatoorah)).toBe(true);
    expect(runChecks(packages, root)).toEqual([]);
  });
});
