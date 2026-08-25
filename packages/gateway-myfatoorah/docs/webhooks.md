# Webhooks

Webhook V2 only. Header: `MyFatoorah-Signature` (case-insensitive). Signature = **Base64**(HMAC-SHA256 over the canonical string) with a **separate webhook secret** (portal secure key) — never the API token. Raw `string` bodies (e.g. from Workers `request.text()`) are JSON-parsed before verify — `verifyWebhook` and `parseWebhookEvent` both accept a `string` or already-parsed object and parse when needed; unparseable strings fail closed (`false` / throw) (MF-WEBHOOK-RAW).

Canonical strings use **fixed field order — never sort keys**. Null / missing fields become empty strings.

Payment (`PAYMENT_STATUS_CHANGED` / `Event.Code` 1):

```text
Invoice.Id={id},Invoice.Status={status},Transaction.Status={status},Transaction.PaymentId={paymentId},Invoice.ExternalIdentifier={ext}
```

Refund (`REFUND_STATUS_CHANGED` / `Event.Code` 2): official `Data` has **siblings** `{ Refund, Amount, ReferencedInvoice }` (see https://docs.myfatoorah.com/docs/webhook-v2-refund-data-model); legacy fixtures nested `Amount`/`ReferencedInvoice` under `Refund` are still accepted for back-compat with a fallback.

```text
Refund.Id={id},Refund.Status={status},Amount.ValueInBaseCurrency={amount},ReferencedInvoice.Id={id}
```

`verifyWebhook` fails closed (`false`) when: `webhookSecret` missing, header missing, unsupported `Event.Name` (present and unknown — does not fallback to `Event.Code`), unsupported `Event.Code` when `Name` is empty (code `1`/`2` accepted as number or string `"1"`/`"2"`), unparseable payload (including raw string that is not JSON), invalid Base64, or byte mismatch (constant-time). `Event.Name` is authoritative; `Code` 1/2 is only fallback when `Name` is missing.

`parseWebhookEvent` normalizes (stateless mappers — see `src/webhook-map.ts:myFatoorahPaymentWebhookStatus` and `isMyFatoorahPaidTerminal`):

- payment: `gatewayPaymentId` = `Invoice.Id`, merchant `paymentId` = `Invoice.ExternalIdentifier` (which is `Customer.Reference` / `orderId` — `createPayment` sends `orderId` as both `Order.ExternalIdentifier` and `Customer.Reference` so the webhook reliably carries it for `paymentId` correlation; never `UserDefinedField`; inbox can correlate via either identifier); `Invoice.Status=PAID` is authoritative (`paid` regardless of `Transaction.Status` — KNET duplicate webhooks must not un-fulfill); `AUTHORIZE` → `pending` (until auth/capture is implemented), `FAILED` → `failed`, `CANCELED` → `cancelled`, pending invoice → `pending` (even when transaction is `AUTHORIZE`/`FAILED`). `Transaction.PaymentId` (string or number) rides `event.payment.references.relatedIds.paymentId` via `withRelatedIdsOnPaymentEvent`. `Data.Amount` is published as `amount`/`currency` with base preference (`ValueInBaseCurrency`/`BaseCurrency` → `ValueInDisplayCurrency`/`DisplayCurrency` → `ValueInPayCurrency`/`PayCurrency`, fallback `Value`/`Currency`/`Amount`), so webhook amount is **base currency** (e.g. KWD) even when checkout was SAR — see `docs/money.md` MF-WEBHOOK-MONEY-DRIFT. `KD`/`SR` and dotted variants (`K.D.`/`S.R.`) are aliased to `KWD`/`SAR` via `normalizeMyFatoorahCurrency`; amounts handle grouping commas (`12,345.000`) via `parseMyFatoorahAmount`. Unknown `Invoice.Status` with `Transaction.Status=SUCCESS` stays `failed` (fail-closed, never `paid` — only explicit `PAID` maps to `paid`).
- refund: `gatewayPaymentId` = `ReferencedInvoice.Id` (official sibling; legacy `Refund.ReferencedInvoice` fallback), `gatewayObjectId` = `Refund.Id`, `paymentId` = `ReferencedInvoice.ExternalIdentifier` **only** (never the refund's own `ExternalIdentifier` idempotency key) so refunds correlate to the original `orderId`; `REFUNDED` → `refunded`, `CANCELED` → `refund_failed`; `Amount.ValueInBaseCurrency` is read from `Data.Amount` (fallback to `Refund.Amount`) and published as `amount`/`currency` — **refund webhooks are base currency** (MF-WEBHOOK-MONEY-DRIFT); `KD`/`SR` currency tokens are aliased to `KWD`/`SAR`.

**PAID is terminal** (I12): `Invoice.Status=PAID` is terminal per https://docs.myfatoorah.com/docs/v3-updating-payment-status-guidelines — success cannot be overridden. The webhook mapper `myFatoorahPaymentWebhookStatus` is **stateless**: it correctly returns `paid` for `PAID` but does **not** remember prior state, so a later webhook with `Invoice.Status=PENDING` would naïvely map to `pending`. **Consumers must enforce terminal Paid at the application/inbox layer, not the mapper.** Use `isMyFatoorahPaidTerminal(status)` helper or `status === "paid"` check and ignore `pending`/`failed` for the same `Invoice.Id`/`ExternalIdentifier` after a `paid` has been fulfilled. `PaymentClient.handleWebhook` dedupes via inbox `claim` (same `Event.Reference` / `payloadHash` not re-delivered), but your handler must also treat `paid` as final — if you already fulfilled on a `paid` event, ignore later `pending`/`failed` for the same `Invoice.Id`/`ExternalIdentifier`. Unknown invoice + `SUCCESS` transaction stays `failed` — only explicit `PAID` is `paid`.

Fulfill only after an inbox **claim** and `status === "paid"` / `isPaidOutcome` / `isMyFatoorahPaidTerminal(status)`. `handleWebhook` only verifies and normalizes. Raw string payloads are parsed before signature check (MF-WEBHOOK-RAW).
