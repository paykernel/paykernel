/**
 * Public API surface — runtime regression tests for @paykernel/testkit.
 *
 * Freezes constructability and export presence of symbols re-exported from
 * the package root (`./index`). No network calls.
 */
import { describe, it, expect } from "bun:test";
import * as testkit from "./index";

describe("public API runtime surface", () => {
  describe("namespace export presence", () => {
    it("re-exports every documented runtime symbol from the package root", () => {
      const runtimeExports: Array<[string, unknown]> = [
        // Mock gateway
        ["mockGateway", testkit.mockGateway],
        ["majorToMinor", testkit.majorToMinor],
        ["minorToMajor", testkit.minorToMajor],
        ["defaultPaymentResult", testkit.defaultPaymentResult],
        ["defaultRefundResult", testkit.defaultRefundResult],
        [
          "paymentStatusToOperationOutcome",
          testkit.paymentStatusToOperationOutcome,
        ],
        ["computeMockWebhookSignature", testkit.computeMockWebhookSignature],
        ["signMockWebhook", testkit.signMockWebhook],
        ["signWebhook", testkit.signWebhook],
        ["createMockWebhookPayload", testkit.createMockWebhookPayload],
        ["generateWebhookEvent", testkit.generateWebhookEvent],
        ["withDuplicateWebhook", testkit.withDuplicateWebhook],
        ["generateDuplicateWebhooks", testkit.generateDuplicateWebhooks],
        ["outOfOrderWebhooks", testkit.outOfOrderWebhooks],
        ["generateOutOfOrderWebhooks", testkit.generateOutOfOrderWebhooks],
        ["mockPayloadToWebhookEvent", testkit.mockPayloadToWebhookEvent],
        ["DEFAULT_MOCK_WEBHOOK_SECRET", testkit.DEFAULT_MOCK_WEBHOOK_SECRET],
        // Gateway conformance
        ["runGatewayConformanceSuite", testkit.runGatewayConformanceSuite],
        ["GATEWAY_CONFORMANCE_CASES", testkit.GATEWAY_CONFORMANCE_CASES],
        ["runBuiltinGatewayConformance", testkit.runBuiltinGatewayConformance],
        ["BUILTIN_GATEWAY_NAMES", testkit.BUILTIN_GATEWAY_NAMES],
        ["BUILTIN_TEST_CREDENTIALS", testkit.BUILTIN_TEST_CREDENTIALS],
        // Store errors (§9.4 taxonomy)
        ["STORE_ERROR_CODES", testkit.STORE_ERROR_CODES],
        ["StoreError", testkit.StoreError],
        ["StoreConflictError", testkit.StoreConflictError],
        ["StoreLeaseLostError", testkit.StoreLeaseLostError],
        ["StoreUnavailableError", testkit.StoreUnavailableError],
        ["StoreTimeoutError", testkit.StoreTimeoutError],
        ["StoreSerializationFailureError", testkit.StoreSerializationFailureError],
        ["StoreInvalidSchemaError", testkit.StoreInvalidSchemaError],
        ["StoreUnsupportedFeatureError", testkit.StoreUnsupportedFeatureError],
        ["StoreCorruptedRecordError", testkit.StoreCorruptedRecordError],
        ["StorePayloadHashConflictError", testkit.StorePayloadHashConflictError],
        ["isStoreLeaseLostError", testkit.isStoreLeaseLostError],
        // Storage conformance
        [
          "runIdempotencyStoreConformanceSuite",
          testkit.runIdempotencyStoreConformanceSuite,
        ],
        [
          "runWebhookInboxStoreConformanceSuite",
          testkit.runWebhookInboxStoreConformanceSuite,
        ],
        [
          "runReconciliationStoreConformanceSuite",
          testkit.runReconciliationStoreConformanceSuite,
        ],
        // Memory stores + clock (NON-PRODUCTION / NON-DISTRIBUTED)
        ["NON_PRODUCTION", testkit.NON_PRODUCTION],
        ["NON_DISTRIBUTED", testkit.NON_DISTRIBUTED],
        ["MEMORY_STORE_WARNING", testkit.MEMORY_STORE_WARNING],
        ["createMemoryIdempotencyStore", testkit.createMemoryIdempotencyStore],
        [
          "createMemoryWebhookInboxStore",
          testkit.createMemoryWebhookInboxStore,
        ],
        [
          "createMemoryReconciliationStore",
          testkit.createMemoryReconciliationStore,
        ],
        ["createMemoryStores", testkit.createMemoryStores],
        ["createFakeClock", testkit.createFakeClock],
        ["createSystemClock", testkit.createSystemClock],
        ["buildStoreConformanceReport", testkit.buildStoreConformanceReport],
        // Storage adapter manifest (§9.5)
        [
          "MEMORY_STORAGE_ADAPTER_MANIFEST",
          testkit.MEMORY_STORAGE_ADAPTER_MANIFEST,
        ],
        [
          "assertStorageAdapterManifest",
          testkit.assertStorageAdapterManifest,
        ],
        [
          "getMemoryStorageAdapterManifest",
          testkit.getMemoryStorageAdapterManifest,
        ],
        [
          "isProductionSafeCoordination",
          testkit.isProductionSafeCoordination,
        ],
        ["isStrongClaimAdapter", testkit.isStrongClaimAdapter],
        // Fixture safety
        ["sanitizeFixture", testkit.sanitizeFixture],
        ["assertFixtureSafe", testkit.assertFixtureSafe],
        ["redactSecretsFromFixture", testkit.redactSecretsFromFixture],
        ["findFixtureSafetyIssues", testkit.findFixtureSafetyIssues],
        ["findSecretLeaks", testkit.findSecretLeaks],
        ["REDACTED", testkit.REDACTED],
        ["SECRET_PATTERNS", testkit.SECRET_PATTERNS],
        ["FIXTURE_SCHEMA_VERSION", testkit.FIXTURE_SCHEMA_VERSION],
        ["isFixtureEnvelope", testkit.isFixtureEnvelope],
        ["assertFixtureSchemaVersion", testkit.assertFixtureSchemaVersion],
      ];

      for (const [name, value] of runtimeExports) {
        expect(value, `missing or undefined export: ${name}`).toBeDefined();
      }

      // stepDelayMs is an internal latency helper (outcomes → mock applyLatency only).
      // Must not reappear on the package root as a soft-dead public export.
      expect(
        Object.prototype.hasOwnProperty.call(testkit, "stepDelayMs"),
        "stepDelayMs must not be re-exported from the package root",
      ).toBe(false);
    });

    it("exports fixture safety as callable functions and constants", () => {
      expect(typeof testkit.sanitizeFixture).toBe("function");
      expect(typeof testkit.assertFixtureSafe).toBe("function");
      expect(typeof testkit.redactSecretsFromFixture).toBe("function");
      expect(typeof testkit.findSecretLeaks).toBe("function");
      expect(typeof testkit.findFixtureSafetyIssues).toBe("function");
      expect(typeof testkit.FIXTURE_SCHEMA_VERSION).toBe("number");
      expect(testkit.FIXTURE_SCHEMA_VERSION).toBe(1);
      expect(testkit.REDACTED).toBe("[REDACTED]");
      expect(Array.isArray(testkit.SECRET_PATTERNS)).toBe(true);
    });

    it("exports mockGateway and conformance runners as functions", () => {
      expect(typeof testkit.mockGateway).toBe("function");
      expect(typeof testkit.runGatewayConformanceSuite).toBe("function");
      expect(typeof testkit.runBuiltinGatewayConformance).toBe("function");
      expect(Array.isArray(testkit.GATEWAY_CONFORMANCE_CASES)).toBe(true);
      expect(testkit.GATEWAY_CONFORMANCE_CASES).toContain("amount_conversion");
      expect(testkit.GATEWAY_CONFORMANCE_CASES).toContain("capabilities_parity");
      expect(Array.isArray(testkit.BUILTIN_GATEWAY_NAMES)).toBe(true);
      expect(testkit.BUILTIN_GATEWAY_NAMES).toContain("stripe");
      expect(typeof testkit.runIdempotencyStoreConformanceSuite).toBe(
        "function",
      );
      expect(typeof testkit.runWebhookInboxStoreConformanceSuite).toBe(
        "function",
      );
      expect(typeof testkit.runReconciliationStoreConformanceSuite).toBe(
        "function",
      );
    });

    it("exports NON-PRODUCTION memory store factories as functions", () => {
      expect(testkit.NON_PRODUCTION).toBe(true);
      expect(testkit.NON_DISTRIBUTED).toBe(true);
      expect(typeof testkit.MEMORY_STORE_WARNING).toBe("string");
      expect(testkit.MEMORY_STORE_WARNING).toContain("NON-PRODUCTION");
      expect(typeof testkit.createMemoryStores).toBe("function");
      expect(typeof testkit.createFakeClock).toBe("function");
      expect(typeof testkit.buildStoreConformanceReport).toBe("function");
    });

    it("exports §9.5 StorageAdapterManifest symbols from the package root", () => {
      // Behavioral coverage of these helpers lives in adapter-manifest.test.ts
      expect(testkit.MEMORY_STORAGE_ADAPTER_MANIFEST.name).toBe("memory");
      expect(typeof testkit.assertStorageAdapterManifest).toBe("function");
      expect(typeof testkit.getMemoryStorageAdapterManifest).toBe("function");
      expect(typeof testkit.isProductionSafeCoordination).toBe("function");
      expect(typeof testkit.isStrongClaimAdapter).toBe("function");
      expect(typeof testkit.isStoreLeaseLostError).toBe("function");
    });
  });
});
