# Status mapping

| Tap | PaymentStatus | outcome (typical) |
| --- | --- | --- |
| INITIATED | pending | requires_action |
| IN PROGRESS | pending | requires_action |
| AUTHORIZED | authorized | succeeded (hold, not paid) |
| CAPTURED | paid | succeeded |
| VOID / CANCELLED / ABANDONED | cancelled | failed (`getPayment`); `voidPayment` is `succeeded` + cancelled |
| DECLINED | failed | declined |
| FAILED / RESTRICTED / TIMEDOUT / UNKNOWN | failed | failed |

Charge `IN PROGRESS` is Fawry (`src_eg.fawry`): pending / `requires_action` when `transaction.url` is present — **not** `failed`. Redirect only to `transaction.url`.

Provider `TIMEDOUT` is a definite Tap object status. SDK transport timeout after POST is `indeterminate`. Tap API error `1151` ("Gateway timed out") is `NetworkError` (mutating → `afterProviderSubmit` / indeterminate after keyed retries), not a clean `GatewayApiError` failure.

Refund objects: `REFUNDED` → completed / `refunded`; `PENDING` / `IN PROGRESS` → pending / `refund_pending`.
