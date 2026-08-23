# Charges

`createPayment` (sale only) calls `POST /v3/payments`.

Required: `amount` (must be **> 0**), `currency` (3-letter), HTTPS `callbackUrl`, and a caller `idempotencyKey` (→ `Idempotency-Key` header). Customer is optional.

Optional: `myfatoorahCustomer`, `myfatoorahPaymentMethod` (default: config `defaultPaymentMethod`; both omitted → all enabled methods on the hosted page), `myfatoorahDisplayPaymentMethods` (lowercase tokens), `myfatoorahLanguage` (`EN` | `AR`), `myfatoorahWebhookUrl` (HTTPS), `myfatoorahSessionId` / `myfatoorahToken` (mutually exclusive → `SourceOfFund`), `orderId` → `Order.ExternalIdentifier`, `UDF1`..`UDF5` string `metadata`.

Never sent: `OperationType` (defaults PAY), `SaveCardOptions`, raw `SourceOfFund.Card` blobs (rejected before any fetch).

Response mapping:

- `PaymentCompleted` + paid invoice/transaction evidence → `succeeded` / `paid`, no redirect
- non-empty `PaymentURL` → `requires_action` / `pending` + `redirectUrl`
- mutating 2xx with neither → `indeterminate` (`afterProviderSubmit`) — replay `createPayment` with the same `idempotencyKey`

`getPayment` calls `POST /v2/GetPaymentStatus` (`KeyType` `InvoiceId` by default; `myfatoorahKeyType: "PaymentId"` for PaymentId lookups). Never use `GET /v3/invoices/{id}` for unpaid invoices — it returns "No invoices match this InvoiceId" when there are no transactions. A pending invoice stays pending even when the latest transaction failed (the customer can retry the same invoice).
