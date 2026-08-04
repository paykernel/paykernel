# @paykernel/reconciliation

## Unreleased

### Patch Changes

- **N5 / moneyEquals:** amounts now compare via currency-scale minor units (`toMinorUnits` bigint) instead of raw decimal-string equality, so `"10"` and `"10.00"` (same currency) no longer false-drift to `manual_review`. Currency codes remain case-sensitive. Unparseable / excess-precision amounts stay unequal unless the amount strings are identical.

## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
