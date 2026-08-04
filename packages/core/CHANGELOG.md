# @paykernel/core

## Unreleased

### Patch

- PayPal `PAYMENT.REFUND.COMPLETED` is now parsed as `status=refunded` with Phase 7 dual-write `refund.completed` (was map-only; parse threw Unsupported).
- **Paymob dual-write (amount-only refunds / auth+capture):** Phase 7 stable-type mapping prefers normalized `WebhookEvent.status` and amount-derived refund/capture signals over bare `success` / sticky `is_auth`. Amount-only `refunded_amount_cents` TRANSACTION webhooks dual-write `refund.completed` (not `payment.succeeded`). `is_auth` + `captured_amount` dual-writes `payment.succeeded` when status is `paid`/`partially_captured` (not `payment.authorized`). Failed refund/void action callbacks dual-write `payment.failed` in agreement with status. Optional `ProviderEventMapContext.amounts` minor-unit fields support amount-aware dual-write.


## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
