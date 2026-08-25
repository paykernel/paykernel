# Status mapping

Unknown provider values fail closed to `failed`.

## Invoice (`Invoice.Status` / `InvoiceStatus`)

| MyFatoorah                                        | Payment status |
| ------------------------------------------------- | -------------- |
| `PAID` / `Paid`                                   | `paid`         |
| `PENDING`                                         | `pending`      |
| `CANCELED` / `CANCELLED`                          | `cancelled`    |
| `REFUNDED`                                        | `refunded`            |
| `PARTIALLY_REFUNDED` / `PARTIALLY-REFUNDED` etc.  | `partially_refunded`  |
| anything else                                     | `failed`       |

> **Note:** `POST /v2/GetPaymentStatus` per official https://docs.myfatoorah.com/docs/get-payment-status only returns `Pending` / `Paid` / `Canceled` (plus `Expired` → `failed` via `mapMyFatoorahInvoiceStatus`). `REFUNDED` / `PARTIALLY_REFUNDED` are **never** returned by `GetPaymentStatus` (I3 — `getPayment` cannot observe refunds; invoice stays `Paid` after refund) and are observed only via `REFUND_STATUS_CHANGED` webhooks or `GetRefundStatus`. The rows above cover the shared `mapMyFatoorahInvoiceStatus` used by both `getPayment` and `myFatoorahPaymentWebhookStatus` (`src/status.ts` ↔ `src/webhook-map.ts`). `InvoiceValue` in `GetPaymentStatus` is **base currency** per https://docs.myfatoorah.com/docs/get-payment-status (not pay/display) — see `docs/money.md`; fixtures use KWD base + SAR pay to lock this drift.

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

`POST /v3/payments` returns `PaymentCompleted: true` when the hosted session completed inline (no redirect). **`PaymentCompleted: true` alone is `paid`/`succeeded` even without nested `TransactionDetails.Invoice.Status=PAID` or `TransactionDetails.Transaction.Status=SUCCESS`** (MF-PAYMENTCOMPLETED-REDIRECT). `PaymentURL` on such a completion is the Result URL, not checkout, and is ignored. Nested PAID/SUCCESS without `PaymentCompleted: true` stays hosted/`pending` (or `indeterminate` if `PaymentURL` is also missing).

## Webhook payment status

`Invoice.Status=PAID` is authoritative → `paid` regardless of `Transaction.Status` (KNET can emit duplicate webhooks with auxiliary statuses; success is final and must not be un-fulfilled). A pending invoice stays `pending` even when the latest transaction failed **or is `AUTHORIZE`** (the customer can retry the same invoice; `AUTHORIZE` is not fulfilled as `authorized` until capture is implemented) — MF-PAYMENTCOMPLETED-REDIRECT pending case. `Invoice.Status=REFUNDED` / `PARTIALLY_REFUNDED` stay `refunded` / `partially_refunded` (not `failed`). Legacy `PAID` + non-success → `paid` (not `failed`). `getPayment` also keeps a `PENDING` invoice as `pending` regardless of transaction evidence (the invoice can be retried).

**Stateless mapper:** `myFatoorahPaymentWebhookStatus` in `src/webhook-map.ts` is stateless — it returns `paid` for `PAID` but does **not** remember prior webhooks. Paid terminal must be enforced by the consumer/inbox (`isMyFatoorahPaidTerminal` helper or `status === "paid"` check + ignore `pending`/`failed` after `paid` for the same `Invoice.Id`/`ExternalIdentifier`). See https://docs.myfatoorah.com/docs/v3-updating-payment-status-guidelines and `docs/webhooks.md#paid-is-terminal`. Unknown `Invoice.Status` with `Transaction.Status=SUCCESS` stays `failed` (fail-closed, never `paid`).

## `getPayment` invoice

`getPayment` (`POST /v2/GetPaymentStatus`) maps `InvoiceStatus=PENDING` → `pending` **regardless of the last transaction's `TransactionStatus`** (`FAILED`/`AUTHORIZE`/`INPROGRESS` all stay `pending` because the invoice is retryable). Only `PAID` + a `SUCCESS`/`SUCCSS` transaction (last success, not first) becomes `paid`. `PAID` without a success transaction stays `pending` (official: Paid requires a `Succss` transaction). `Canceled` (and `Expired` → `failed`) are terminal but **replay outside KWT/SAU now allows a new invoice** — a `Canceled`/`Failed` invoice for the same `CustomerReference` does not block `createPayment`; a new `orderId`/`CustomerReference` creates a fresh invoice (see `docs/charges.md` MF-CREATE-REPLAY and `GatewayFixer` change). `REFUNDED` / `PARTIALLY_REFUNDED` stay those statuses with `outcome: succeeded` (settled, not fulfillable — `isPaidOutcome` is false) when seen via webhooks/shared mapper; **`GetPaymentStatus` itself never returns `REFUNDED` — after a full refund the invoice still reads `Paid` (use `GetRefundStatus` / `REFUND_STATUS_CHANGED`; do not treat `Paid` as refund-observation).** This is the **refund-blind** limitation (I3) — poll `GetRefundStatus` for refund state; `getPayment` alone cannot tell if an invoice was refunded. Both `getPayment` and `webhook` share `mapMyFatoorahInvoiceStatus` so statuses stay consistent.
