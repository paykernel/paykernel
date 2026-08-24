# Webhooks

Webhook V2 only. Header: `MyFatoorah-Signature` (case-insensitive). Signature = **Base64**(HMAC-SHA256 over the canonical string) with a **separate webhook secret** (portal secure key) — never the API token.

Canonical strings use **fixed field order — never sort keys**. Null / missing fields become empty strings.

Payment (`PAYMENT_STATUS_CHANGED` / `Event.Code` 1):

```text
Invoice.Id={id},Invoice.Status={status},Transaction.Status={status},Transaction.PaymentId={paymentId},Invoice.ExternalIdentifier={ext}
```

Refund (`REFUND_STATUS_CHANGED` / `Event.Code` 2): official `Data` has **siblings** `{ Refund, Amount, ReferencedInvoice }` (see https://docs.myfatoorah.com/docs/webhook-v2-refund-data-model); legacy fixtures nested `Amount`/`ReferencedInvoice` under `Refund` are still accepted for back-compat with a fallback.

```text
Refund.Id={id},Refund.Status={status},Amount.ValueInBaseCurrency={amount},ReferencedInvoice.Id={id}
```

`verifyWebhook` fails closed (`false`) when: `webhookSecret` missing, header missing, unsupported `Event.Name` (present and unknown — does not fallback to `Event.Code`), unsupported `Event.Code` when `Name` is empty (code `1`/`2` accepted as number or string `"1"`/`"2"`), unparseable payload, invalid Base64, or byte mismatch (constant-time). `Event.Name` is authoritative; `Code` 1/2 is only fallback when `Name` is missing.

`parseWebhookEvent` normalizes:

- payment: `gatewayPaymentId` = `Invoice.Id`, merchant `paymentId` = `Invoice.ExternalIdentifier` (which is `Customer.Reference` / `orderId` — `createPayment` now sends `orderId` as both `Order.ExternalIdentifier` and `Customer.Reference` so the webhook reliably carries it; never `UserDefinedField`); `Invoice.Status=PAID` is authoritative (`paid` regardless of `Transaction.Status` — KNET duplicate webhooks must not un-fulfill); `AUTHORIZE` → `pending` (until auth/capture is implemented), `FAILED` → `failed`, `CANCELED` → `cancelled`, pending invoice → `pending`. `Transaction.PaymentId` (string or number) rides `event.payment.references.relatedIds.paymentId`. `Data.Amount` (base/display/pay) is published as `amount`/`currency` when parseable (base preferred)
- refund: `gatewayPaymentId` = `ReferencedInvoice.Id` (official sibling; legacy `Refund.ReferencedInvoice` fallback), `gatewayObjectId` = `Refund.Id`, `paymentId` = `ReferencedInvoice.ExternalIdentifier` **only** (never the refund's own `ExternalIdentifier` idempotency key) so refunds correlate to the original `orderId`; `REFUNDED` → `refunded`, `CANCELED` → `refund_failed`; `Amount.ValueInBaseCurrency` is read from `Data.Amount` (fallback to `Refund.Amount`) and published as `amount`/`currency`; `KD`/`SR` currency tokens are aliased to `KWD`/`SAR`

Fulfill only after an inbox **claim** and `status === "paid"` / `isPaidOutcome`. `handleWebhook` only verifies and normalizes.
