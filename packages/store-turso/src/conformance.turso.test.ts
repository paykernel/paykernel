/**
 * Store conformance — libsql :memory:/file: (throw if @libsql/client is installed
 * but fails to open) + describe.skipIf(!hasLiveTurso()) live remote.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
  type StoreConformanceReport,
} from "@paykernel/testkit";
import {
  createTursoIdempotencyStore,
  createTursoWebhookInboxStore,
  createTursoReconciliationStore,
  migrateTursoAdapter,
} from "./index";
import {
  createLibsqlExecutor,
  createLibsqlStores,
  type LibsqlClientLike,
} from "./drivers/libsql";
import type { TursoExecutor } from "./executor";
import {
  hasLiveTurso,
  isRemoteTursoUrl,
  TURSO_AUTH_TOKEN,
  TURSO_DATABASE_URL,
  uniqueTablePrefix,
} from "./test-utils/turso-env";

const require = createRequire(import.meta.url);

type LibsqlCreateClient = (config: {
  url: string;
  authToken?: string;
}) => LibsqlClientLike & { close: () => void };

function tryLoadLibsql():
  | { ok: true; createClient: LibsqlCreateClient }
  | { ok: false; reason: string } {
  try {
    const mod = require("@libsql/client") as {
      createClient?: LibsqlCreateClient;
    };
    if (typeof mod.createClient !== "function") {
      return { ok: false, reason: "@libsql/client has no createClient" };
    }
    return { ok: true, createClient: mod.createClient };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

const libsql = tryLoadLibsql();
const liveRemoteTurso = hasLiveTurso() && isRemoteTursoUrl();

function assertSuiteOk(report: StoreConformanceReport): void {
  expect(
    report.ok,
    JSON.stringify(
      report.results.filter((r) => !r.ok),
      null,
      2,
    ),
  ).toBe(true);
}

async function runAllSuites(
  name: string,
  executor: TursoExecutor,
  prefix: string,
): Promise<void> {
  await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });

  const idempotency = await runIdempotencyStoreConformanceSuite({
    name: `${name}-idempotency`,
    createStore: async ({ clock }) =>
      createTursoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(idempotency);

  const webhook = await runWebhookInboxStoreConformanceSuite({
    name: `${name}-webhook`,
    createStore: async ({ clock }) =>
      createTursoWebhookInboxStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(webhook);

  const recon = await runReconciliationStoreConformanceSuite({
    name: `${name}-recon`,
    createStore: async ({ clock }) =>
      createTursoReconciliationStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(recon);
}

describe.skipIf(!libsql.ok)("turso conformance (libsql :memory:)", () => {
  it("passes all three store suites", async () => {
    if (!libsql.ok) {
      throw new Error(
        `@libsql/client is a package devDependency and must open; load failed: ${libsql.reason}`,
      );
    }
    const client = libsql.createClient({ url: ":memory:" });
    const executor = createLibsqlExecutor(client);
    try {
      await runAllSuites("libsql-memory", executor, "cm_");
    } finally {
      client.close();
    }
  });
});

describe.skipIf(!libsql.ok)("turso conformance (libsql file:)", () => {
  it("passes all three suites on file DB", async () => {
    if (!libsql.ok) {
      throw new Error(
        `@libsql/client is a package devDependency and must open; load failed: ${libsql.reason}`,
      );
    }
    const dir = mkdtempSync(join(tmpdir(), "payments-turso-"));
    try {
      const path = join(dir, "conformance.db");
      const client = libsql.createClient({ url: `file:${path}` });
      const executor = createLibsqlExecutor(client);
      try {
        // Factory smoke: createLibsqlStores does not migrate by itself
        const bundle = createLibsqlStores({
          client,
          namespace: { tablePrefix: "cf_" },
        });
        expect(bundle.manifest.coordinationScope).toBe("multi-host");
        await runAllSuites("libsql-file", executor, "cf_");
      } finally {
        client.close();
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

if (!libsql.ok) {
  describe.skip(
    `turso conformance skipped (@libsql/client unavailable: ${libsql.reason})`,
    () => {
      it("requires @libsql/client to run local conformance", () => {
        expect(libsql.ok).toBe(false);
      });
    },
  );
}

describe.skipIf(!liveRemoteTurso)("turso conformance (live remote)", () => {
  // Remote round-trips + three full suites exceed bun's default 5s per-test timeout.
  it(
    "passes all three suites when TURSO_/LIBSQL_ URL is set",
    async () => {
      if (!libsql.ok) {
        throw new Error(
          `@libsql/client is a package devDependency and must open for live remote tests: ${libsql.reason}`,
        );
      }
      const config: { url: string; authToken?: string } = {
        url: TURSO_DATABASE_URL!,
      };
      if (TURSO_AUTH_TOKEN) config.authToken = TURSO_AUTH_TOKEN;
      const client = libsql.createClient(config);
      const executor = createLibsqlExecutor(client);
      const prefix = uniqueTablePrefix("lv");
      try {
        await runAllSuites("libsql-live", executor, prefix);
      } finally {
        client.close();
      }
    },
    { timeout: 180_000 },
  );
});
