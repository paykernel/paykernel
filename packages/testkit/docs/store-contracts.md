# Store contracts (pointer)

Canonical document: **[`@paykernel/store-contracts` contracts.md](../../store-contracts/docs/contracts.md)**.

This package **re-exports** the contracts and manifests for backward compatibility, and owns:

- Conformance suites (`run*StoreConformanceSuite`)
- NON_PRODUCTION memory factories (`createMemoryWebhookInboxStore`, …)

Production adapters depend on `@paykernel/store-contracts` at runtime, not full testkit.
