# Status mapping

| Tap | PaymentStatus | outcome (typical) |
| --- | --- | --- |
| INITIATED | pending | requires_action |
| AUTHORIZED | authorized | succeeded (hold, not paid) |
| CAPTURED | paid | succeeded |
| VOID / CANCELLED / ABANDONED | cancelled | failed |
| DECLINED | failed | declined |
| FAILED / RESTRICTED / TIMEDOUT / UNKNOWN | failed | failed |

Provider `TIMEDOUT` is a definite Tap object status. SDK transport timeout after POST is `indeterminate`.

Refund objects: `REFUNDED` → completed / `refunded`; `PENDING` / `IN PROGRESS` → pending / `refund_pending`.
