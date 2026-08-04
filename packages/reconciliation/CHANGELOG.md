# @paykernel/reconciliation

## Unreleased

### Patch Changes

- Docs: SQL adapter `listDue` poll recovery and active-lease `markManualReview` fencing documented for crash recovery after lease expiry.

- **N5 / moneyEquals:** amounts now compare via currency-scale minor units (`toMinorUnits` bigint) instead of raw decimal-string equality, so `"10"` and `"10.00"` (same currency) no longer false-drift to `manual_review`. Currency codes remain case-sensitive. Unparseable / excess-precision amounts stay unequal unless the amount strings are identical.
- **R5/R6 / crash recovery (docs + tests):** document that durable adapters must soft-release or re-index expired `claimed` jobs inside `listDue` so `claimDue` / `processDue` rediscover abandoned work after worker crash. Package scheduler tests cover schedule → claim → lease expiry → rediscovery via `listDue` on the memory store. See `docs/crash-boundaries.md` (listDue recovery contract).

## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
