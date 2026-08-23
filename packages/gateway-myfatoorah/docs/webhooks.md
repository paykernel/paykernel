# Webhooks

Webhook V2 only. Header: `MyFatoorah-Signature` (case-insensitive). Signature = **Base64**(HMAC-SHA256 over the canonical string) with a **separate webhook secret** (portal secure key) — never the API token.

Canonical strings use **fixed field order — never sort keys**. Null / missing fields become empty strings.

Payment (`PAYMENT_STATUS_CHANGED` / `Event.Code` 1):

```text
Invoice.Id={id},Invoice.Status={status},Transaction.Status={status},Transaction.PaymentId={paymentId},Invoice.ExternalIdentifier={ext}
```

Refund (`REFUND_STATUS_CHANGED` / `Event.Code` 2):

```text
Refund.Id={id},Refund.Status={status},Amount.ValueInBaseCurrency={amount},ReferencedInvoice.Id={id}
```

`verifyWebhook` fails closed (`false`) when: `webhookSecret` missing, header missing, unsupported event name/code, unparseable payload, invalid Base64, or byte mismatch (constant-time).

`parseWebhookEvent` normalizes:

- payment: `gatewayPaymentId` = `Invoice.Id`, merchant `paymentId` = `Invoice.ExternalIdentifier` (never `UserDefinedField`); `SUCCESS`+`PAID` → `paid`, `AUTHORIZE` → `authorized`, `FAILED` → `failed`, `CANCELED` → `cancelled`, pending invoice → `pending`. `Transaction.PaymentId` rides `event.payment.references.relatedIds.paymentId`
- refund: `gatewayPaymentId` = `ReferencedInvoice.Id`, `gatewayObjectId` = `Refund.Id`; `REFUNDED` → `refunded`, `CANCELED` → `refund_failed`
- `id` = `Event.Reference`; `timestamp` = `Event.CreationDate` (fail-closed ISO parse)

Card data from `Transaction.Card` is never copied onto the normalized event beyond `rawPayload`.

Fulfill only after an inbox **claim** and `status === "paid"` / `isPaidOutcome`. `handleWebhook` only verifies and normalizes.
