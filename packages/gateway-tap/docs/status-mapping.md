# Status mapping

| Tap | PaymentStatus | outcome (typical) |
| --- | --- | --- |
| INITIATED | pending | requires_action |
| IN PROGRESS / IN_PROGRESS | pending | requires_action |
| AUTHORIZED | authorized | succeeded (hold, not paid) |
| CAPTURED | paid | succeeded |
| CAPTURED (partial capture) | partially_captured | not `isPaidOutcome` |
| REFUNDED (charge object) | refunded | succeeded (`getPayment` / charge webhook — not `failed`) |
| VOID (charge object) | cancelled | failed (`getPayment` / charge webhook — not succeeded) |
| VOID (authorize object) | cancelled | succeeded (`getPayment` and `voidPayment`); not capturable |
| CANCELLED / ABANDONED | cancelled | failed (`getPayment`) |
| DECLINED | failed | declined |
| FAILED + `response.code` `501`–`516` | failed | declined |
| FAILED (other) / RESTRICTED / TIMEDOUT | failed | failed |
| UNKNOWN (Tap object status present) | failed | failed |

Missing object `status` after a **mutating** HTTP 2xx (body has `id`) is `indeterminate` (`NetworkError.afterProviderSubmit`). Do not invent Tap `UNKNOWN` and map it to `failed`.

Charge `INITIATED` / `IN PROGRESS` / `IN_PROGRESS` are pending / `requires_action` — **not** `failed`. Fawry (`src_eg.fawry`) uses `IN PROGRESS`; all pending statuses share that outcome. Redirect only to `transaction.url` when it is present.

Authorize `CAPTURED` is paid on `getPayment` when nested `charge_id` is present (`gatewayId` `chg_…`, `authorizationId` `auth_…`). Without `charge_id`, omit `amount` (do not invent captured money from the hold). `capturePayment` does **not** POST `/charges` when GET authorize is `CAPTURED`. Capture `amount` less than the authorize is `partially_captured`, not `paid` (`isPaidOutcome` is false). Capture `amount` greater than the authorize throws `InvalidRequestError`. Charge `VOID` is `failed`. Authorize `VOID` is `succeeded` + cancelled on `getPayment` (same as `voidPayment`) and must not be captured. ABANDONED / CANCELLED stay `failed`.

Invoice webhook objects parse as **non-paid** after a verified `hashstring` that uses `x_updated`. They do not throw.

Leftover `transaction.url` on AUTHORIZED or CAPTURED is **not** `requires_action`.

Provider `TIMEDOUT` is a definite Tap object status. SDK transport timeout after POST is `indeterminate`. Tap API error `1151` ("Gateway timed out") is `NetworkError` (mutating → `afterProviderSubmit` / indeterminate after keyed retries), not a clean `GatewayApiError` failure. HTTP 5xx is `NetworkError` **before** Tap JSON `1106` / other 11xx body codes (never a card decline; Tap decline codes `501`–`516` are charge `response.code` values, not HTTP status). A 5xx body that includes `1106` is not `InvalidRequestError`.

Tap error `1114` ("Please check the Authorize status") is `InvalidRequestError`. Tap error `1106` ("Customer not found") is `InvalidRequestError`, not payment `ResourceNotFoundError`. Tap errors `1126` ("Source already used") and `1149` ("Currency code is not matching") are `InvalidRequestError`, not untyped `GatewayApiError`. Remaining Tap 11xx JSON error codes (other than already-typed auth / not-found / amount) are also `InvalidRequestError`, not untyped `GatewayApiError`.

Refund objects: `REFUNDED` → completed / `refunded`; `PENDING` / `IN PROGRESS` / `IN_PROGRESS` / `ACCEPTED` → pending / `refund_pending`.
