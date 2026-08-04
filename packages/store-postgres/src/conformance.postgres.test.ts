/**
 * Live PostgreSQL store conformance — skip when no URL configured.
 *
 * Env (prefer first):
 *   PAYMENTS_SDK_PG_URL
 *   DATABASE_URL
 *
 * Primary binding: postgres-js (full three-suite run).
 * Secondary: pg binding runs the same suite when live (A3 multi-binding).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
  type StoreConformanceReport,
} from "@paykernel/testkit";
import type { PostgresExecutor } from "./executor";
import {
  createPostgresIdempotencyStore,
  createPostgresWebhookInboxStore,
  createPostgresReconciliationStore,
} from "./index";
import { migratePostgresAdapter } from "./migrate";
import { createPostgresJsPostgresExecutor } from "./drivers/postgres-js";
import { createPgPostgresExecutor } from "./drivers/pg";
import {
  createNodePgPoolConfig,
  dropFoundationTablesSql,
  hasLivePostgres,
  PG_URL,
  uniqueTablePrefix,
} from "./test-utils/pg-env";

const live = hasLivePostgres();

type BindingSetup = {
  name: string;
  createExecutor: () => Promise<{
    executor: PostgresExecutor;
    cleanup: () => Promise<void>;
  }>;
};

async function runAllSuites(
  bindingName: string,
  executor: PostgresExecutor,
  prefix: string,
): Promise<{
  idempotency: StoreConformanceReport;
  webhook: StoreConformanceReport;
  recon: StoreConformanceReport;
}> {
  await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });

  const idempotency = await runIdempotencyStoreConformanceSuite({
    name: `${bindingName}-idempotency`,
    createStore: async ({ clock }) =>
      createPostgresIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });

  const webhook = await runWebhookInboxStoreConformanceSuite({
    name: `${bindingName}-webhook`,
    createStore: async ({ clock }) =>
      createPostgresWebhookInboxStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });

  const recon = await runReconciliationStoreConformanceSuite({
    name: `${bindingName}-recon`,
    createStore: async ({ clock }) =>
      createPostgresReconciliationStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });

  return { idempotency, webhook, recon };
}

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

const postgresJsBinding: BindingSetup = {
  name: "postgres-js",
  createExecutor: async () => {
    const postgres = await import("postgres");
    const sql = postgres.default(PG_URL!, { max: 4 });
    const executor = createPostgresJsPostgresExecutor(sql);
    return {
      executor,
      cleanup: async () => {
        await sql.end({ timeout: 5 });
      },
    };
  },
};

const pgBinding: BindingSetup = {
  name: "pg",
  createExecutor: async () => {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool(createNodePgPoolConfig({ max: 4 }));
    const executor = createPgPostgresExecutor(pool);
    return {
      executor,
      cleanup: async () => {
        await pool.end();
      },
    };
  },
};

async function withBinding(
  binding: BindingSetup,
  fn: (executor: PostgresExecutor, prefix: string) => Promise<void>,
): Promise<void> {
  const { executor, cleanup } = await binding.createExecutor();
  const prefix = uniqueTablePrefix(binding.name.slice(0, 3));
  try {
    await fn(executor, prefix);
  } finally {
    try {
      await executor.execute(dropFoundationTablesSql(prefix));
    } catch {
      /* ignore cleanup */
    }
    await cleanup();
  }
}

describe.skipIf(!live)("postgres conformance (postgres-js primary)", () => {
  it("idempotency store conformance", async () => {
    await withBinding(postgresJsBinding, async (executor, prefix) => {
      await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
      const report = await runIdempotencyStoreConformanceSuite({
        name: "postgres-js-idempotency",
        createStore: async ({ clock }) =>
          createPostgresIdempotencyStore({
            executor,
            clock,
            namespace: { tablePrefix: prefix },
          }),
        createClock: () => createFakeClock(),
      });
      assertSuiteOk(report);
    });
  }, 120_000);

  it("webhook inbox store conformance", async () => {
    await withBinding(postgresJsBinding, async (executor, prefix) => {
      await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
      const report = await runWebhookInboxStoreConformanceSuite({
        name: "postgres-js-webhook",
        createStore: async ({ clock }) =>
          createPostgresWebhookInboxStore({
            executor,
            clock,
            namespace: { tablePrefix: prefix },
          }),
        createClock: () => createFakeClock(),
      });
      assertSuiteOk(report);
    });
  }, 120_000);

  it("reconciliation store conformance", async () => {
    await withBinding(postgresJsBinding, async (executor, prefix) => {
      await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
      const report = await runReconciliationStoreConformanceSuite({
        name: "postgres-js-recon",
        createStore: async ({ clock }) =>
          createPostgresReconciliationStore({
            executor,
            clock,
            namespace: { tablePrefix: prefix },
          }),
        createClock: () => createFakeClock(),
      });
      assertSuiteOk(report);
    });
  }, 120_000);
});

describe.skipIf(!live)("postgres conformance (pg binding A3)", () => {
  it("all three suites via node-postgres Pool", async () => {
    await withBinding(pgBinding, async (executor, prefix) => {
      const reports = await runAllSuites("pg", executor, prefix);
      assertSuiteOk(reports.idempotency);
      assertSuiteOk(reports.webhook);
      assertSuiteOk(reports.recon);
    });
  }, 180_000);
});

describe.skipIf(live)("postgres conformance skipped without URL", () => {
  it("documents skip pattern (PAYMENTS_SDK_PG_URL | DATABASE_URL)", () => {
    expect(PG_URL).toBeFalsy();
  });
});
