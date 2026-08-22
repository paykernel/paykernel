# Status mapping

| Tap | PaymentStatus | outcome (typical) |
| --- | --- | --- |
| INITIATED | pending | requires_action |
| IN PROGRESS / IN_PROGRESS | pending | requires_action |
| AUTHORIZED | authorized | succeeded (hold, not paid) |
| CAPTURED | paid | succeeded |
| VOID | cancelled | failed (`getPayment`); not capturable; `voidPayment` is `succeeded` + cancelled |
| CANCELLED / ABANDONED | cancelled | failed (`getPayment`) |
| DECLINED | failed | declined |
| FAILED / RESTRICTED / TIMEDOUT / UNKNOWN | failed | failed |

Charge `IN PROGRESS` / `IN_PROGRESS` is Fawry (`src_eg.fawry`): pending / `requires_action` when `transaction.url` is present — **not** `failed`. Redirect only to `transaction.url`.

Authorize `CAPTURED` is paid on `getPayment`. `capturePayment` may replay `POST /charges` with the same `idempotencyKey`. Authorize `VOID` is cancelled and must not be captured.

Leftover `transaction.url` on AUTHORIZED or CAPTURED is **not** `requires_action`.

Provider `TIMEDOUT` is a definite Tap object status. SDK transport timeout after POST is `indeterminate`. Tap API error `1151` ("Gateway timed out") is `NetworkError` (mutating → `afterProviderSubmit` / indeterminate after keyed retries), not a clean `GatewayApiError` failure. HTTP 5xx is also `NetworkError`, never a card decline (Tap decline codes `501`–`516` are charge `response.code` values, not HTTP status).

Tap error `1114` ("Please check the Authorize status") is `InvalidRequestError`. Tap error `1106` ("Customer not found") is `InvalidRequestError`, not payment `ResourceNotFoundError`.

Refund objects: `REFUNDED` → completed / `refunded`; `PENDING` / `IN PROGRESS` / `IN_PROGRESS` / `ACCEPTED` → pending / `refund_pending`.
