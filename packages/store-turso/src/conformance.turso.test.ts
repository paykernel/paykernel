/**
 * Store conformance — libsql :memory:/file: (when available) + env-gated live Turso.
 */
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
import type { TursoExecutor } from "./executor";
import {
  hasLiveTurso,
  isRemoteTursoUrl,
  TURSO_AUTH_TOKEN,
  TURSO_DATABASE_URL,
  uniqueTablePrefix,
} from "./test-utils/turso-env";

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

describe("turso conformance (libsql :memory: skip-clean)", () => {
  it("passes all three store suites", async () => {
    let openOk = false;
    try {
      const { createClient } = await import("@libsql/client");
      const client = createClient({ url: ":memory:" });
      openOk = true;
      const { createLibsqlExecutor } = await import("./drivers/libsql");
      const executor = createLibsqlExecutor(client);
      try {
        await runAllSuites("libsql-memory", executor, "cm_");
      } finally {
        client.close();
      }
    } catch (err) {
      if (openOk) throw err;
      return;
    }
  });
});

describe("turso conformance (libsql file: skip-clean)", () => {
  it("passes all three suites on file DB", async () => {
    let openOk = false;
    let dir: string | undefined;
    try {
      const { createClient } = await import("@libsql/client");
      dir = mkdtempSync(join(tmpdir(), "payments-turso-"));
      const path = join(dir, "conformance.db");
      const client = createClient({ url: `file:${path}` });
      openOk = true;
      const { createLibsqlExecutor, createLibsqlStores } = await import(
        "./drivers/libsql"
      );
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
    } catch (err) {
      if (openOk) throw err;
      return;
    } finally {
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });
});

describe("turso conformance (live remote skip-clean)", () => {
  // Remote round-trips + three full suites exceed bun's default 5s per-test timeout.
  it(
    "passes all three suites when TURSO_/LIBSQL_ URL is set",
    async () => {
      if (!hasLiveTurso() || !isRemoteTursoUrl()) {
        return;
      }
      let openOk = false;
      try {
        const { createClient } = await import("@libsql/client");
        const config: { url: string; authToken?: string } = {
          url: TURSO_DATABASE_URL!,
        };
        if (TURSO_AUTH_TOKEN) config.authToken = TURSO_AUTH_TOKEN;
        const client = createClient(config);
        openOk = true;
        const { createLibsqlExecutor } = await import("./drivers/libsql");
        const executor = createLibsqlExecutor(client);
        const prefix = uniqueTablePrefix("lv");
        try {
          await runAllSuites("libsql-live", executor, prefix);
        } finally {
          client.close();
        }
      } catch (err) {
        if (openOk) throw err;
        return;
      }
    },
    { timeout: 180_000 },
  );
});
