/**
 * Re-export of storage adapter manifest types/helpers from
 * `@paykernel/store-contracts` (backward-compatible testkit path).
 */
export type {
  StorageAdapterManifest,
  StorageCoordinationScope,
  StorageDurability,
  StorageReadAfterWrite,
} from "@paykernel/store-contracts";
export {
  MEMORY_STORAGE_ADAPTER_MANIFEST,
  assertStorageAdapterManifest,
  getMemoryStorageAdapterManifest,
  isProductionSafeCoordination,
  isStrongClaimAdapter,
} from "@paykernel/store-contracts";
