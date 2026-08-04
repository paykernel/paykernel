/**
 * Public API surface — freezes runtime export names for @paykernel/store-contracts.
 */
import { describe, it, expect } from "bun:test";
import * as contracts from "./index";

describe("public API runtime surface", () => {
  it("re-exports every documented runtime symbol from the package root", () => {
    const runtimeExports: Array<[string, unknown]> = [
      ["STORE_ERROR_CODES", contracts.STORE_ERROR_CODES],
      ["StoreError", contracts.StoreError],
      ["StoreConflictError", contracts.StoreConflictError],
      ["StoreLeaseLostError", contracts.StoreLeaseLostError],
      ["StoreUnavailableError", contracts.StoreUnavailableError],
      ["StoreTimeoutError", contracts.StoreTimeoutError],
      ["StoreSerializationFailureError", contracts.StoreSerializationFailureError],
      ["StoreInvalidSchemaError", contracts.StoreInvalidSchemaError],
      ["StoreUnsupportedFeatureError", contracts.StoreUnsupportedFeatureError],
      ["StoreCorruptedRecordError", contracts.StoreCorruptedRecordError],
      ["StorePayloadHashConflictError", contracts.StorePayloadHashConflictError],
      ["isStoreLeaseLostError", contracts.isStoreLeaseLostError],
      ["MEMORY_STORAGE_ADAPTER_MANIFEST", contracts.MEMORY_STORAGE_ADAPTER_MANIFEST],
      ["assertStorageAdapterManifest", contracts.assertStorageAdapterManifest],
      ["getMemoryStorageAdapterManifest", contracts.getMemoryStorageAdapterManifest],
      ["isProductionSafeCoordination", contracts.isProductionSafeCoordination],
      ["isStrongClaimAdapter", contracts.isStrongClaimAdapter],
    ];

    for (const [name, value] of runtimeExports) {
      expect(value, `missing export: ${name}`).toBeDefined();
    }
  });

  it("StoreLeaseLostError is constructible with code lease_lost", () => {
    const err = new contracts.StoreLeaseLostError("stale");
    expect(err.code).toBe("lease_lost");
    expect(err.retryable).toBe(false);
    expect(contracts.isStoreLeaseLostError(err)).toBe(true);
  });

  it("assertStorageAdapterManifest accepts MEMORY_STORAGE_ADAPTER_MANIFEST", () => {
    expect(() =>
      contracts.assertStorageAdapterManifest(contracts.MEMORY_STORAGE_ADAPTER_MANIFEST),
    ).not.toThrow();
    expect(contracts.getMemoryStorageAdapterManifest()).toBe(
      contracts.MEMORY_STORAGE_ADAPTER_MANIFEST,
    );
  });

  it("has zero production workspace dependencies (portable contracts)", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(pkg.name).toBe("@paykernel/store-contracts");
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.paymentsSdk?.portable).toBe(true);
    expect(pkg.private).not.toBe(true);
  });
});
