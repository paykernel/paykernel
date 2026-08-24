# Charges

`createPayment` (sale only) calls `POST /v3/payments`.

Required: `amount` (must be **> 0**), `currency` (3-letter), HTTPS `callbackUrl`, and a caller `idempotencyKey` (→ `Idempotency-Key` header). Customer is optional.

Optional: `myfatoorahCustomer`, `myfatoorahPaymentMethod` (default: config `defaultPaymentMethod`; both omitted → all enabled methods on the hosted page), `myfatoorahDisplayPaymentMethods` (lowercase tokens), `myfatoorahLanguage` (`EN` | `AR`), `myfatoorahWebhookUrl` (HTTPS), `myfatoorahSessionId` / `myfatoorahToken` (mutually exclusive → `SourceOfFund`), `orderId` → `Order.ExternalIdentifier`, `UDF1`..`UDF5` string `metadata`.

Never sent: `OperationType` (defaults PAY), `SaveCardOptions`, raw `SourceOfFund.Card` blobs (rejected before any fetch).

Response mapping:

- `PaymentCompleted` + nested `TransactionDetails.Invoice.Status=PAID` **or** `TransactionDetails.Transaction.Status` in `{SUCCESS,Succss}` (official V3) → `succeeded` / `paid`, no redirect. Legacy `InvoiceStatus` / `TransactionDetails.Status` fallbacks still accepted. `PaymentURL` on a paid completion is the Result URL, not checkout — ignored when paid.
- non-empty `PaymentURL` (hosted) when not paid → `requires_action` / `pending` + `redirectUrl`
- mutating 2xx with neither → `indeterminate` (`afterProviderSubmit`) — replay `createPayment` with the same `idempotencyKey`. **Idempotency-Key header is only honored in KWT/SAU** (https://docs.myfatoorah.com/docs/idempotency); in other countries create retries only before submit to avoid double-charge. Refunds use `ExternalIdentifier` + header (KWT/SAU) with a one-shot retry without header on `Idempotency` validation error.

`getPayment` calls `POST /v2/GetPaymentStatus` (`KeyType` `InvoiceId` by default; `myfatoorahKeyType: "PaymentId"` for PaymentId lookups; `PaymentId` may be string or number). Uses `InvoiceTransactions` (official per https://docs.myfatoorah.com/docs/get-payment-status; `Transactions` legacy fallback) and normalizes `KD` → `KWD`. Never use `GET /v3/invoices/{id}` for unpaid invoices — it returns "No invoices match this InvoiceId" when there are no transactions. A pending invoice stays pending even when the latest transaction failed (the customer can retry the same invoice).
