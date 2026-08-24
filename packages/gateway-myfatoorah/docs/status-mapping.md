# Status mapping

Unknown provider values fail closed to `failed`.

## Invoice (`Invoice.Status` / `InvoiceStatus`)

| MyFatoorah               | Payment status |
| ------------------------ | -------------- |
| `PAID` / `Paid`          | `paid`         |
| `PENDING`                | `pending`      |
| `CANCELED` / `CANCELLED` | `cancelled`    |
| anything else            | `failed`       |

## Transaction (`Transaction.Status` / `TransactionStatus`)

| MyFatoorah                                   | Evidence                                                        |
| -------------------------------------------- | --------------------------------------------------------------- |
| `SUCCESS` / `SUCCSS` (official V2 typo)      | success                                                         |
| `FAILED`                                     | failed                                                          |
| `CANCELED` / `CANCELLED`                     | cancelled                                                       |
| `AUTHORIZE`                                  | authorized (webhook-only; the adapter never creates authorizes) |
| `INPROGRESS` / `IN PROGRESS` / `IN_PROGRESS` | pending                                                         |
| anything else                                | unknown                                                         |

## Refund (`Refund.Status` / `RefundStatus`)

| MyFatoorah               | Refund status | Payment-domain   |
| ------------------------ | ------------- | ---------------- |
| `REFUNDED`               | `completed`   | `refunded`       |
| `PENDING`                | `pending`     | `refund_pending` |
| `CANCELED` / `CANCELLED` | `failed`      | `refund_failed`  |
| anything else            | `failed`      | `refund_failed`  |

## Webhook payment status

`Invoice.Status=PAID` is authoritative → `paid` regardless of `Transaction.Status` (KNET can emit duplicate webhooks with auxiliary statuses; success is final and must not be un-fulfilled). A pending invoice stays `pending` even when the latest transaction failed (the customer can retry the same invoice). Legacy `PAID` + non-success → `paid` (not `failed`).
