# Webhook Handling

`PaymentClient.handleWebhook(gateway, payload, signatureOrHeaders?, headers?)`
verifies the payload for the given gateway, normalizes it into a `WebhookEvent`,
and runs webhook hooks. Prefer this helper over calling `verifyWebhook` /
`parseWebhookEvent` yourself unless you need gateway-specific control.

## Per-gateway verification

Each gateway authenticates webhooks differently. Pass the **right** body shape
and signature material or verification will fail closed.

### Stripe — raw body + `stripe-signature`

Stripe signs the **exact raw request body bytes**. You must pass the unparsed
body (`string` or `Buffer`) plus the `stripe-signature` header. A parsed JSON
object will never verify.

```typescript
// Express: register a raw-body parser for this route only
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const event = await client.handleWebhook(
      'stripe',
      req.body, // Buffer from express.raw()
      req.headers['stripe-signature'] as string,
    );
    // Do NOT call isPaidOutcome(event) — that helper is for GatewayPaymentResult /
    // PaymentOperationResult and is always false on a WebhookEvent (CORE-8).
    // Prefer event.status === 'paid', isPaidLikePaymentStatus(event.status), or
    // event.event?.type === 'payment.succeeded' (authorized is not paid).
    res.json({ received: true });
  },
);
```

```typescript
// Bun / Fetch-style handlers: read the body as text before JSON.parse
app.post('/webhooks/stripe', async ({ request }) => {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature') ?? undefined;

  const event = await client.handleWebhook('stripe', rawBody, signature);
  return { received: true };
});
```

- Requires `stripe.webhookSecret` (`whsec_...`). Missing secret → verification fails.
- See [Stripe Webhooks](./stripe.md#webhooks) for thin-event hydration, status
  mapping, and `gatewayPaymentId` / `gatewayObjectId` normalization.

### PayPal — raw body + transmission headers

PayPal verifies via their API using several transmission headers (not a single
local HMAC of the body). Pass the **raw request body** (`string` / `Buffer` /
`Uint8Array`) plus a **headers object**. The SDK embeds that exact JSON text as
PayPal’s `webhook_event` field for the verify postback **without**
parse→stringify reordering (which can break signatures). Parsed objects are
accepted but may fail verification. `handleWebhook` uses async verification
automatically for PayPal (sync `verifyWebhook` throws).

```typescript
app.post('/webhooks/paypal', async (req) => {
  // Prefer raw body (e.g. express.raw) so webhook_event matches what PayPal signed.
  const rawBody = req.rawBody ?? req.body;
  const event = await client.handleWebhook('paypal', rawBody, {
    'paypal-transmission-id': req.headers['paypal-transmission-id'],
    'paypal-transmission-time': req.headers['paypal-transmission-time'],
    'paypal-transmission-sig': req.headers['paypal-transmission-sig'],
    'paypal-cert-url': req.headers['paypal-cert-url'],
    'paypal-auth-algo': req.headers['paypal-auth-algo'],
  });

  return { received: true };
});
```

- Requires `paypal.webhookId` from the PayPal Developer Dashboard.
- `paypal-transmission-time` must be parseable. **Unparseable** or **far-future**
  timestamps are rejected before calling PayPal. **Aged** transmissions (including
  older than 15 minutes / late retries after outages) are **soft-accepted**: the
  SDK warns and still calls PayPal signature verify. There is **no hard 15-minute
  replay reject** — merchants **must** dedupe by **`event.id`**. `paypal-cert-url`
  must be HTTPS on `*.paypal.com`.
- Transient PayPal API failures during verification throw (so PayPal can retry);
  return 5xx for those, 4xx only for genuinely invalid webhooks.
- Details: [PayPal Webhooks](./paypal.md#webhook-verification).

### Moyasar — `secret_token` in the payload

Moyasar embeds a `secret_token` field in the JSON body. No signature header is
required; pass the parsed body only.

```typescript
app.post('/webhooks/moyasar', async (req) => {
  const event = await client.handleWebhook('moyasar', req.body);
  return { received: true };
});
```

- Requires `moyasar.webhookSecret`. Compared against `payload.secret_token`
  with a constant-time check.
- Details: [Moyasar Webhooks](./moyasar.md#webhook-verification).

### Paymob — HMAC

Paymob signs transaction / token / redirect callbacks with an HMAC. Pass the
body and the HMAC string (query param, body field, or both — the gateway also
reads `payload.hmac` when present).

```typescript
app.post('/webhooks/paymob', async (req) => {
  const hmac = req.query.hmac ?? req.body.hmac;
  const event = await client.handleWebhook('paymob', req.body, hmac);
  return { received: true };
});
```

- Requires `paymob.hmacSecret` in production. HMAC is computed over
  gateway-defined field orderings (transaction vs card-token vs redirect shapes).
- Details: [Paymob Webhooks](./paymob.md#webhook-verification).

## Raw body required (Stripe & HMAC-style verification)

Signature / HMAC verification is only trustworthy when computed over the **same
bytes the provider signed**.

| Gateway | Body to pass | Why |
|---------|--------------|-----|
| **Stripe** | Raw `string` or `Buffer` **required** | Stripe HMAC is over `timestamp.rawBody`. Parsed/re-serialized JSON **never** matches. `verifyWebhook` returns `false` (and logs) if given an object. |
| **Paymob** | Parsed object is fine for HMAC fields | HMAC is over selected payload fields, not the raw HTTP body. Still do not mutate fields before verifying. |
| **PayPal** | Prefer raw `string` / `Buffer` / `Uint8Array` | Verification is an API postback with body + headers (not a local raw-body HMAC). Raw payloads are embedded as `webhook_event` **without** re-serialization; parsed objects are re-serialized and may fail. |
| **Moyasar** | Parsed JSON body | Checks `secret_token` on the object. |

For Stripe (and any future raw-body HMAC gateway): in frameworks that auto-parse
JSON, register a **raw-body** parser for the webhook route only
(e.g. `express.raw({ type: 'application/json' })`). Do not
`JSON.stringify` a parsed object and expect verification to succeed.

## Hook ordering and verification

`handleWebhook` runs **verify and parse as separate stages**:

1. `onWebhookReceived(gateway, payload)` — fires **before** verification.
2. **Verify** signature / authenticity.
   - On failure (`isVerified === false` or verify throws): `onWebhookFailed`
     runs, then the error is rethrown (`InvalidWebhookError` for failed checks).
3. **Parse** the payload into a normalized `WebhookEvent` (only after verify succeeds).
   - Parse failures throw **`InvalidRequestError` only** (gateway
     `InvalidWebhookError` from parse is reclassified) and **do not** call
     `onWebhookFailed`. Treat them as server/data-shape errors — **not** forged
     webhooks. With `@paykernel/webhooks` `processWithVerifier`, parse /
     `InvalidRequestError` maps to `handler_failed { retryable: true }` (~5xx)
     so authentic paid events redeliver; only verify-false `InvalidWebhookError`
     / `{ ok: false }` maps to `invalid_webhook` (~400).
4. `onWebhookVerified(event)` — fires **after** verify + parse succeed.

### Throw matrix (what happens when a webhook hook fails)

| Hook | Throw behavior | Why |
|------|----------------|-----|
| `onWebhookReceived` | **Log and continue** to verify | Untrusted path must never block authenticity checks |
| `onWebhookFailed` | **Secondary**: logged if it throws; the **primary verification error** is always rethrown | Metrics/alerts must not replace `InvalidWebhookError` |
| `onWebhookVerified` | **Rethrow** (after logging) | HTTP handler should return **5xx** so the provider retries delivery |

Composition via `addHook` / multi-register:

- `onWebhookReceived` / `onWebhookFailed`: run both handlers, then rethrow the
  first error (outer `handleWebhook` still isolates so the primary verify error
  wins for failed hooks).
- `onWebhookVerified`: **fail-fast** — if the first composed handler throws, the
  second is **not** run. This avoids double fulfillment when a primary handler
  fails part-way and the provider later retries.

See also [hooks.md](./hooks.md#webhook-path-client-level-not-executewithhooks).

### Deduplicate before fulfillment

**Merchants MUST dedupe by a stable inbox key before fulfilling orders,
capturing inventory, or sending goods.** For Stripe / PayPal / Moyasar that
key is `event.id`. **Paymob must not use raw `event.id` alone** — redirect
`TRANSACTION_RESPONSE` and processed `TRANSACTION` share the same transaction
id. Use `deriveWebhookEventKey('paymob', event.id, event.type)` (or
`event.provider?.eventType`) so a no-op redirect cannot ACK-suppress the later
paid snapshot (WEBHOOKS-1).

Providers redeliver the same event when your endpoint returns 5xx (including when
`onWebhookVerified` throws). Without an idempotency check on the inbox key, a
retry after a partial fulfillment will run your handler again.

```typescript
hooks: {
  onWebhookVerified: async (event) => {
    const inboxId =
      event.gateway === 'paymob'
        ? `${event.type}:${event.id}`
        : event.id;
    if (await alreadyProcessed(inboxId)) return;
    await fulfillOrder(event);
    await markProcessed(inboxId);
  },
}
```

### `onWebhookFailed` = verification failures only

Use `onWebhookFailed` for metrics/alerts about **authenticity** failures
(bad signature, missing secret, provider rejected the transmission). Do **not**
rely on it for malformed-but-authenticated payloads; those surface as thrown
errors after verify without invoking this hook.

> ⚠️ The payload given to `onWebhookReceived` is **unverified and untrusted** —
> anyone who can reach your endpoint can trigger it with arbitrary data. Use it
> only for side-effect-free work (logging, metrics). Put all trusted,
> state-changing logic (fulfilling orders, updating payment status) in
> `onWebhookVerified`.

## Normalized event

Successful handling returns a `WebhookEvent` with common fields such as
`status` (unified `PaymentStatus`, including `partially_refunded` /
`partially_captured` / `refunded` when the gateway exposes enough amount data),
`paymentId` (your internal id when the gateway/metadata provides one),
`gatewayPaymentId`, `amount`, `currency`, optional `livemode` (set when the
gateway exposes a live/test flag — e.g. Moyasar envelope `live`, Stripe
`livemode`), and `rawPayload`. Exact mapping differs per gateway — see each
gateway doc linked above.

### Phase 7 — stable `PaymentEvent` (preferred for new handlers)

`WebhookEvent.type` remains the **provider-native** (or gateway-normalized)
free-form string for 0.x compatibility (`payment_paid`,
`payment_intent.succeeded`, …). Prefer the Phase 7 dual-write fields and helpers
for fulfillment:

```typescript
import {
  toPersistedPaymentEventEnvelope,
  webhookEventToPaymentEvent,
} from '@paykernel/core';

const event = await client.handleWebhook('moyasar', body);
// event.type === 'payment_paid' (legacy free-form, 0.x)
// Built-in gateways dual-write Phase 7 fields; client attaches if missing:
// event.stableType === 'payment.succeeded'
// event.event is PaymentEvent (schemaVersion: '1', discriminated on type)
// event.provider.eventType === 'payment_paid' (provider-native)

// Handlers: switch on event.event?.type (or webhookEventToPaymentEvent(event).type)
// Persistence: never store rawPayload by default
const envelope = toPersistedPaymentEventEnvelope(event.event!, {
  payloadHash: event.payloadHash,
  rawForHash: event.rawPayload,
});
```

Full contract (stable names, mapping tables, envelope rules, schema versioning,
raw retention): **[webhook-events.md](./webhook-events.md)**.

## Inbox engine (Phase 10 — separate package)

`PaymentClient.handleWebhook` **verifies, normalizes, and runs hooks only**. It does
**not** claim an inbox, dedupe across workers, or return processing outcomes for
durable retry.

Claim / dedupe / lease fencing / explicit modes live in:

**[`@paykernel/webhooks`](../../webhooks/README.md)**

```typescript
import { hashWebhookPayload } from '@paykernel/core';
import {
  createWebhookInboxEngine,
  type WebhookInboxStore,
} from '@paykernel/webhooks';

declare const store: WebhookInboxStore; // testkit memory in tests; Phase 11+ durable adapters

const engine = createWebhookInboxEngine({ store, mode: 'inline' });

const event = await client.handleWebhook('stripe', rawBody, signature);

const outcome = await engine.processVerified({
  gateway: 'stripe',
  providerEventId: event.id,
  payloadHash: event.payloadHash ?? hashWebhookPayload(rawBody),
  // Pass event so Paymob keys include notification class (WEBHOOKS-1).
  event: event.event ?? event,
  handler: async (ctx) => {
    await fulfillOrder(ctx.event);
  },
});
// Map outcome → HTTP in your framework — never silent-ACK failures.
```

- Engine guide: [webhook-inbox.md](../../webhooks/docs/webhook-inbox.md)
- Crash boundaries: [crash-boundaries.md](../../webhooks/docs/crash-boundaries.md)
- Store semantics (Phase 9 contracts + conformance): [store-contracts.md](../../testkit/docs/store-contracts.md)

Core **must not** depend on `@paykernel/webhooks`. Apps that need inbox
behavior add the webhooks package as a separate dependency.
