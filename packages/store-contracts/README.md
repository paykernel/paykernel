# @paykernel/store-contracts

Portable **lease-aware store contracts**, **StoreError** taxonomy, and
**storage adapter manifests** for PayKernel production adapters and conformance.

> **Portable.** Zero runtime workspace dependencies. No mock gateway and no
> NON_PRODUCTION memory store factories — those stay in
> [`@paykernel/testkit`](../testkit) (which re-exports this package for
> backward compatibility).

## Install

```bash
bun add @paykernel/store-contracts
# or: npm install @paykernel/store-contracts
```

## What this package is

| Surface | Contents |
| --- | --- |
| Contracts | `IdempotencyStore`, `WebhookInboxStore`, `ReconciliationStore` (+ input/result types) |
| Errors | `StoreError` hierarchy (`StoreLeaseLostError`, `StoreUnavailableError`, …) |
| Manifests | `StorageAdapterManifest`, `assertStorageAdapterManifest`, helpers |

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

- Testkit re-exports (BC + conformance + memory factories): [`@paykernel/testkit`](../testkit)
- Shared SQL foundation for relational adapters: [`@paykernel/sql-foundation`](../sql-foundation)
