# @paykernel/reconciliation

## Unreleased

### Behavior (0.x)

- **Inherited paid-like fix:** Provider status `approved` no longer drives `update_local_to_paid` (core `isPaidLikePaymentStatus` excludes buyer pre-capture approval). Only true settled `paid` upgrades local to paid.
- **Replacement-charge safety:** `shouldForbidReplacementCharge` forbids open money locals (`authorized` / `approved` / partial / `paid` / refunded) and `provider_not_found` / `temporarily_unavailable` outcomes — not only `pending`/`processing`.
- **Sparse expected honesty:** indeterminate/sparse local + open incomplete provider (`authorized` / `approved` / `partially_captured` / …) yields `manual_review` instead of `mark_consistent(safe:true)`.
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
