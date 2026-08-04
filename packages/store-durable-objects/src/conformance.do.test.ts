/**
 * Store conformance against mock DO SQL (bun:sqlite). Live skip-clean.
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  runWebhookInboxStoreConformanceSuite,
  runReconciliationStoreConformanceSuite,
  type StoreConformanceReport,
} from "@paykernel/testkit";
import {
  createDoIdempotencyStore,
  createDoWebhookInboxStore,
  createDoReconciliationStore,
  createDoPaymentStoresFromStorage,
  createDoExecutor,
  migrateDoAdapter,
} from "./index";
import type { DoExecutor } from "./sql-executor";
import { createMockDoSql } from "./test-utils/mock-do-sql";
import {
  hasDoBindingRuntime,
  hasLiveDo,
  uniqueTablePrefix,
} from "./test-utils/do-env";

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
  executor: DoExecutor,
  prefix: string,
): Promise<void> {
  await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });

  const idempotency = await runIdempotencyStoreConformanceSuite({
    name: `${name}-idempotency`,
    createStore: async ({ clock }) =>
      createDoIdempotencyStore({
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
      createDoWebhookInboxStore({
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
      createDoReconciliationStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(recon);
}

describe("do conformance (mock DO SQL / bun:sqlite)", () => {
  it("passes all three store suites", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("cm");
      // Smoke: createDoPaymentStoresFromStorage does not migrate
      const bundle = createDoPaymentStoresFromStorage({
        storage: handle.storage,
        tableNamespace: { tablePrefix: prefix },
      });
      expect(bundle.manifest.coordinationScope).toBe("multi-host");
      expect(bundle.manifest.name).toBe("cloudflare-do");
      await runAllSuites("mock-do", executor, prefix);
    } finally {
      handle.close();
    }
  });

  it("clean-skips live DO when env not set", () => {
    if (hasLiveDo() || hasDoBindingRuntime()) {
      // Live path would run here in future miniflare integration.
      expect(true).toBe(true);
      return;
    }
    expect(hasLiveDo()).toBe(false);
  });
});
