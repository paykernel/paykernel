/**
 * Store conformance against mock D1 (bun:sqlite). Live binding skip-clean.
 *
 * 16.6 matrix items 1–3 + 10: three testkit suites + clean skip without env.
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
  createD1IdempotencyStore,
  createD1WebhookInboxStore,
  createD1ReconciliationStore,
  createD1PaymentStores,
  createD1Executor,
  migrateD1Adapter,
} from "./index";
import type { D1Executor } from "./executor";
import { createMockD1 } from "./test-utils/mock-d1";
import {
  hasD1BindingRuntime,
  hasLiveD1,
  uniqueTablePrefix,
} from "./test-utils/d1-env";

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
  executor: D1Executor,
  prefix: string,
): Promise<void> {
  await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });

  const idempotency = await runIdempotencyStoreConformanceSuite({
    name: `${name}-idempotency`,
    createStore: async ({ clock }) =>
      createD1IdempotencyStore({
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
      createD1WebhookInboxStore({
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
      createD1ReconciliationStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      }),
    createClock: () => createFakeClock(),
  });
  assertSuiteOk(recon);
}

describe("d1 conformance (mock D1 / bun:sqlite)", () => {
  it("passes all three store suites", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db);
      const prefix = uniqueTablePrefix("cm");
      // Smoke: createD1PaymentStores does not migrate
      const bundle = createD1PaymentStores({
        db: handle.db,
        namespace: { tablePrefix: prefix },
      });
      expect(bundle.manifest.coordinationScope).toBe("multi-host");
      await runAllSuites("mock-d1", executor, prefix);
    } finally {
      handle.close();
    }
  });
});

describe("d1 live probes skip-clean without Workers/REST env", () => {
  it("hasD1BindingRuntime and hasLiveD1 are false in plain bun test (no crash)", () => {
    // Live binding needs miniflare/Workers harness; REST probes need CF env.
    // Neither is required for mock conformance or createD1PaymentStores({ db }).
    // This suite documents skip-clean gates — do not throw when unset.
    if (process.env.PAYMENTS_SDK_D1_BINDING_AVAILABLE === "1") {
      expect(hasD1BindingRuntime()).toBe(true);
    } else {
      expect(hasD1BindingRuntime()).toBe(false);
    }
    // hasLiveD1 depends on process env; when credentials exist this still must not throw.
    expect(typeof hasLiveD1()).toBe("boolean");
  });
});
