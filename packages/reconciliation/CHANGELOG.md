# @paykernel/reconciliation

## Unreleased

### Behavior (0.x)

- **RECON-LEASE-1 / processDue hang budget:** a handler that overruns `defaultLeaseMs` (30s) no longer livelocks. Memory `fail` accepts a matching `claimed` token after expiry so attempts can reach `maxAttempts`. If `fail` is still `lease_lost` (token wiped by `listDue`), `processDue` increments `hangOverrun` and parks at `maxAttempts`. `complete` after expiry is not converted into `fail`.
- **PERF-7:** `claimDue` / `processDue` issue listed `store.claim` calls concurrently (list is still not a fence). Handlers stay serial. `listDue` oversample when `maxInFlightByGateway` is set stays capped at 200. Keep `leaseMs` large enough for the remaining batch.
- **RECON-1 / `reconcileMany` correlation:** generator yields `{ index, target, result }` (`ReconcileManyItem`) in completion order so concurrent results (incl. identity-less `provider_not_found` / `temporarily_unavailable`) map to the correct input target. Breaking for consumers that treated yields as bare `ReconciliationResult`.
- **RECON-2 / `provider_not_found` policy:** retryable not-found always returns `do_not_create_replacement` (including terminal failed/cancelled local) — never bare `retry_later` that action-only switches could treat as safe recreate.
- **Inherited paid-like fix:** Provider status `approved` no longer drives `update_local_to_paid` (core `isPaidLikePaymentStatus` excludes buyer pre-capture approval). Only true settled `paid` upgrades local to paid.
- **Replacement-charge safety:** `shouldForbidReplacementCharge` forbids open money locals (`authorized` / `approved` / partial / `paid` / refunded / `refund_pending` / `refund_failed` / `refund_completed` / setup) and `provider_not_found` / `temporarily_unavailable` outcomes — not only `pending`/`processing`.
- **Sparse expected honesty:** indeterminate/sparse local + open incomplete provider (`authorized` / `approved` / `partially_captured` / refund lifecycle incl. `refund_completed` / `setup_completed` / …) yields `manual_review` instead of `mark_consistent(safe:true)`.
- **Identity-bound secondary keys:** wrong-payment secondary-key hits bind to `target.gatewayPaymentId` and never safe-upgrade local to paid.
- **processDue dispositions:** jobs complete only on explicit `{ disposition: "complete" }`; void/retry_later reschedule (fail-closed).
- **moneyEquals currency case:** ISO alphabetic currency codes compare case-insensitively (`usd` ≡ `USD`).

### Patch Changes

- Docs: SQL adapter `listDue` poll recovery and active-lease `markManualReview` fencing documented for crash recovery after lease expiry.
- Docs: currency case-insensitive money equality; replacement/open-provider policy rules.

- **N5 / moneyEquals:** amounts now compare via currency-scale minor units (`toMinorUnits` bigint) instead of raw decimal-string equality, so `"10"` and `"10.00"` (same currency) no longer false-drift to `manual_review`. Currency codes are case-insensitive. Unparseable / excess-precision amounts stay unequal unless the amount strings are identical.
- **R5/R6 / crash recovery (docs + tests):** document that durable adapters must soft-release or re-index expired `claimed` jobs inside `listDue` so `claimDue` / `processDue` rediscover abandoned work after worker crash. Package scheduler tests cover schedule → claim → lease expiry → rediscovery via `listDue` on the memory store. See `docs/crash-boundaries.md` (listDue recovery contract).

## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
