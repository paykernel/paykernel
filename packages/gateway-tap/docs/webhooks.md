# Webhooks

Tap POSTs the charge / authorize / refund JSON to `post.url` (`webhookUrl` config or `tapPostUrl`). Verification is **not** HMAC-of-raw-body.

Canonical string:

```text
x_id{id}x_amount{isoAmount}x_currency{currency}x_gateway_reference{gatewayOrEmpty}x_payment_reference{payment}x_status{status}x_created{created}
```

HMAC-SHA256 hex with the **secret API key**, compared to the `hashstring` header (`timingSafeEqualHex`). Amount must be ISO-padded (`1.00` SAR, `1.200` KWD). Missing `hashstring` fails closed.

Invoice objects are not supported: after a verified delivery, unknown `object` throws `InvalidRequestError` (parse class — do not use `InvalidWebhookError` after verify).

Fulfill only after an inbox **claim** and `status === "paid"` / `isPaidOutcome`. `handleWebhook` only verifies and normalizes.
