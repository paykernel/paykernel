# @paykernel/testkit

## Unreleased

### Patch Changes

- Reconciliation conformance: `listDue` rediscovers abandoned expired claims (poll recovery).

- **Recon listDue recovery (R5/R6):** `runReconciliationStoreConformanceSuite` now requires that after claim-abandon and lease expiry, `listDue` soft-releases/re-indexes the job (poll-path rediscovery). Memory store regression test locks soft-release inside `listDue`. Key-addressed reclaim alone is no longer sufficient for the suite.

## 0.1.0-next.0

### Patch Changes

- Re-export lease-aware store contracts and adapter manifests from `@paykernel/store-contracts` (production adapters no longer hard-depend on full testkit at runtime).

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
