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
| `AUTHORIZE`                                  | `pending` (webhook `AUTHORIZE` is mapped to `pending` until auth/capture is implemented) |
| `INPROGRESS` / `IN PROGRESS` / `IN_PROGRESS` | pending                                                         |
| anything else                                | unknown                                                         |

## Refund (`Refund.Status` / `RefundStatus`)

| MyFatoorah               | Refund status | Payment-domain   |
| ------------------------ | ------------- | ---------------- |
| `REFUNDED`               | `completed`   | `refunded`       |
| `PENDING`                | `pending`     | `refund_pending` |
| `CANCELED` / `CANCELLED` | `failed`      | `refund_failed`  |
| anything else            | `failed`      | `refund_failed`  |

## Create `PaymentCompleted`

`POST /v3/payments` returns `PaymentCompleted: true` when the hosted session completed inline (no redirect). **`PaymentCompleted: true` alone is `paid`/`succeeded` even without nested `TransactionDetails.Invoice.Status=PAID` or `TransactionDetails.Transaction.Status=SUCCESS`** (MF-PAYMENTCOMPLETED-REDIRECT). `PaymentURL` on such a completion is the Result URL, not checkout, and is ignored. When nested statuses are present, `TransactionDetails.Invoice.Status=PAID` **or** `TransactionDetails.Transaction.Status` in `{SUCCESS,Succss}` also maps to `paid` (with `PaymentCompleted: true`); otherwise the response is `pending`/`requires_action` or `indeterminate`.

## Webhook payment status

`Invoice.Status=PAID` is authoritative → `paid` regardless of `Transaction.Status` (KNET can emit duplicate webhooks with auxiliary statuses; success is final and must not be un-fulfilled). A pending invoice stays `pending` even when the latest transaction failed **or is `AUTHORIZE`** (the customer can retry the same invoice; `AUTHORIZE` is not fulfilled as `authorized` until capture is implemented) — MF-PAYMENTCOMPLETED-REDIRECT pending case. Legacy `PAID` + non-success → `paid` (not `failed`). `getPayment` also keeps a `PENDING` invoice as `pending` regardless of transaction evidence (the invoice can be retried).

## `getPayment` invoice

`getPayment` (`POST /v2/GetPaymentStatus`) maps `InvoiceStatus=PENDING` → `pending` **regardless of the last transaction's `TransactionStatus`** (`FAILED`/`AUTHORIZE`/`INPROGRESS` all stay `pending` because the invoice is retryable). Only `PAID` + a `SUCCESS`/`SUCCSS` transaction (last success, not first) becomes `paid`.
