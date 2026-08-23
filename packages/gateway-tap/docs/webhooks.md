# Webhooks

Tap POSTs the charge / authorize / refund JSON to `post.url` (`webhookUrl` config or `tapPostUrl`). Verification is **not** HMAC-of-raw-body.

Canonical string:

```text
x_id{id}x_amount{isoAmount}x_currency{currency}x_gateway_reference{gatewayOrEmpty}x_payment_reference{payment}x_status{status}x_created{created}
```

HMAC-SHA256 hex with the **secret API key**, compared to the `hashstring` header (`timingSafeEqualHex`). Amount must be ISO-padded (`1.00` SAR / USD, `1.200` KWD). Missing or non-hex `hashstring`, and a payload that cannot supply those fields, fail closed (`verifyWebhook` → `false`).

Tests lock Tap’s published Create-a-Charge `hashstring` header (docs example secret + posted charge JSON). Unpadded amount `1` does not match that vector.

Charge webhooks set `gatewayPaymentId` to the `chg_…` id. Auth/capture merchants must also match `reference.order` / `metadata.paymentId`: capture settlement is a **charge** object (`chg_…`), not the original `auth_…`. Authorize objects may carry `relatedIds.chargeId` when `charge_id` is present. `paymentId` is `metadata.paymentId`, then `metadata.orderId`, then `reference.order`. **`metadata.udf1` is not a payment id** (Tap uses udf1 as a free-form metadata slot).

Invoice objects parse as **non-paid** (`cancelled`) so they are not fulfilled. Missing `id` or `created` is `InvalidRequestError`. Do not fulfill against invoices.

Refund objects use the same hashstring field formula when those fields exist. Tap’s official table lists charge / authorize / invoice.

Fulfill only after an inbox **claim** and `status === "paid"` / `isPaidOutcome`. `handleWebhook` only verifies and normalizes.
