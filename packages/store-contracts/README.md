# @paykernel/store-contracts

Portable **lease-aware store contracts**, **StoreError** taxonomy, and
**storage adapter manifests** for PayKernel production adapters and conformance.

> **Portable.** Zero runtime workspace dependencies. No mock gateway and no
> NON_PRODUCTION memory store factories — those stay in
> [`@paykernel/testkit`](../testkit) (which re-exports this package for
> backward compatibility).

**Full contract book:** [docs/contracts.md](./docs/contracts.md)

## Install

```bash
bun add @paykernel/store-contracts
# or: npm install @paykernel/store-contracts
```

## What this package is

| Surface | Contents |
| --- | --- |
| Contracts | `IdempotencyStore`, `LeaseAwareIdempotencyStore`, `WebhookInboxStore`, `ReconciliationStore` (+ input/result types) |
| Errors | `StoreError`, `StoreConflictError`, `StoreLeaseLostError`, `StoreUnavailableError`, `StoreTimeoutError`, `StoreSerializationFailureError`, `StoreInvalidSchemaError`, `StoreUnsupportedFeatureError`, `StoreCorruptedRecordError`, `StorePayloadHashConflictError`, `isStoreLeaseLostError` |
| Manifests | `StorageAdapterManifest`, `assertStorageAdapterManifest`, `MEMORY_STORAGE_ADAPTER_MANIFEST`, `isProductionSafeCoordination`, `isStrongClaimAdapter` |

Production store adapters (`@paykernel/store-*`) depend on **this** package at
runtime — not full `@paykernel/testkit`.

## Quickstart

```ts
import {
  StoreLeaseLostError,
  assertStorageAdapterManifest,
  type IdempotencyStore,
  type StorageAdapterManifest,
} from "@paykernel/store-contracts";

declare const store: IdempotencyStore;
// …
```

## Related

- Contract book: [docs/contracts.md](./docs/contracts.md)
- Testkit re-exports (BC + conformance + memory factories): [`@paykernel/testkit`](../testkit)
- Shared SQL foundation for relational adapters: [`@paykernel/sql-foundation`](../sql-foundation)
- How to choose an adapter: [docs/adapter-selection.md](../../docs/adapter-selection.md)
