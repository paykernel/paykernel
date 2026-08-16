# Typed & Versioned Webhook Events (Phase 7)

Stable, provider-agnostic payment events for fulfillment and persistence.
This document is the **public contract** for `PaymentEvent` schema version `1`.

Cross-links:

- Verification, raw-body rules, hooks: [webhooks.md](./webhooks.md)
- Operation outcomes / Payment snapshots: [operation-results.md](./operation-results.md)
- Inbox engine (claim / modes / outcomes) — **not in core**: [`@paykernel/webhooks`](../../webhooks/docs/webhook-inbox.md) · [crash-boundaries.md](../../webhooks/docs/crash-boundaries.md)

## Why

Legacy `WebhookEvent.type` is a **free-form, provider-native** string
(`payment_paid`, `payment_intent.succeeded`, `PAYMENT.CAPTURE.COMPLETED`,
`TRANSACTION_RESPONSE`, …). That works for 0.x dual-write but forces every app
to re-implement provider mapping.

Phase 7 adds:

| Concept | Role |
|--------|------|
| **Stable names** | Public fulfillment contract (`payment.succeeded`, …) |
| **`PaymentEvent`** | Discriminated union on `type` + `schemaVersion: '1'` |
| **`ProviderEventMetadata`** | Native `eventType`, ISO times, livemode, apiVersion |
| **`PersistedPaymentEventEnvelope`** | Sanitized store shape (no raw / secrets) |
| **Dual-write on `WebhookEvent`** | Additive `event` / `stableType` / `provider` without breaking `type` |

## Schema versioning

```ts
export const PAYMENT_EVENT_SCHEMA_VERSION = '1' as const;
// every PaymentEvent arm includes: schemaVersion: '1'
```

### Compatibility rules (v1)

1. **Consumers must switch on `schemaVersion` then `type`.**
2. **Additive optional fields** on an arm are OK within `schemaVersion: '1'`.
3. **Changing the meaning** of a stable `type` string requires a **new**
   `schemaVersion` (and dual-write / migration docs).
4. **Never silently rename** a stable type once shipped
   (e.g. do not redefine `payment.succeeded` as “authorized only”).
5. Provider-native names live only on `provider.eventType` — they are **not**
   the public stable contract.

## Stable event names

```ts
import {
  STABLE_PAYMENT_EVENT_TYPES,
  isStablePaymentEventType,
} from '@paykernel/core';

// payment.created | payment.processing | payment.authorized |
// payment.succeeded | payment.failed | payment.cancelled |
// capture.completed | refund.pending | refund.completed | refund.failed |
// payment_method.setup_completed |
// dispute.opened | dispute.updated | dispute.closed
```

Unmapped / ambiguous provider events use a dedicated arm:

```ts
{ schemaVersion: '1'; type: 'provider.unmapped'; provider: ProviderEventMetadata; payment?: Payment; note?: string }
```

Do **not** invent stable names for ambiguous domains (Stripe invoice /
subscription schedules, Paymob redirect-only without status context).

## `ProviderEventMetadata`

```ts
type ProviderEventMetadata = {
  gateway: string;
  eventId: string;
  /** Provider-native event type — never silently renamed */
  eventType: string;
  apiVersion?: string;
  livemode?: boolean;
  /** ISO-8601 when the provider says the event occurred */
  occurredAt: string;
  /** ISO-8601 when the SDK received/parsed the event */
  receivedAt: string;
  requestId?: string;
};
```

Timestamps are **ISO-8601 strings** (portable; Engineering Rule 15), not `Date`.

## `PaymentEvent` (discriminated union)

Every arm has `schemaVersion: '1'` and `provider: ProviderEventMetadata`.

| `type` | Required entity fields |
|--------|------------------------|
| `payment.created` / `processing` / `authorized` / `succeeded` / `cancelled` | `payment: Payment` |
| `payment.failed` | `payment` + `failure: PaymentFailure` |
| `capture.completed` | `capture: Capture`; optional `payment` |
| `refund.pending` / `refund.completed` | `refund: Refund` |
| `refund.failed` | `refund`; optional `failure` |
| `payment_method.setup_completed` | `setup: PaymentMethodSetup` |
| `dispute.opened` / `updated` / `closed` | `dispute: Dispute` |
| `provider.unmapped` | optional `payment`, optional `note` |

`Payment` reuses the Phase 6 snapshot type (`status`, `amount?`, `currency?`,
`references: ProviderReferences`, …). `PaymentFailure` is shape-aligned with
`PaymentDecline` (no secrets in `raw`).

### Example handler

```ts
import {
  attachPaymentEvent,
  type PaymentEvent,
  type WebhookEvent,
} from '@paykernel/core';

async function onVerified(legacy: WebhookEvent) {
  // Dual-write (or use webhookEventToPaymentEvent(legacy))
  const { event } = attachPaymentEvent(legacy);
  if (!event) return;

  switch (event.schemaVersion) {
    case '1':
      return handleV1(event);
    default:
      // Future schema versions
      return;
  }
}

function handleV1(event: PaymentEvent) {
  switch (event.type) {
    case 'payment.succeeded':
      return fulfill(event.payment);
    case 'payment.failed':
      return markFailed(event.payment, event.failure);
    case 'capture.completed':
      return fulfillCapture(event.capture);
    case 'refund.completed':
      return recordRefund(event.refund);
    case 'provider.unmapped':
      // Inspect event.provider.eventType — do not guess
      return logUnmapped(event.provider);
    default:
      return;
  }
}
```

## Provider-native → stable mapping

```ts
import { mapProviderEventTypeToStable } from '@paykernel/core';

mapProviderEventTypeToStable('stripe', 'payment_intent.succeeded');
// → 'payment.succeeded'

mapProviderEventTypeToStable('moyasar', 'payment_paid');
// → 'payment.succeeded'

mapProviderEventTypeToStable('paypal', 'PAYMENT.CAPTURE.COMPLETED');
// → 'capture.completed'  (capture domain — see note below)

mapProviderEventTypeToStable('stripe', 'invoice.paid');
// → 'provider.unmapped'
```

### Mapping policy highlights

| Gateway | Native type | Stable | Notes |
|---------|-------------|--------|-------|
| Stripe | `payment_intent.succeeded` (full / status `paid`) | `payment.succeeded` | Default map when not partial |
| Stripe | `payment_intent.succeeded` + status `partially_captured` | **`payment.processing`** | Partial capture dual-write demotion; aligns with `isPaidOutcome` / Paymob |
| Stripe | `payment_intent.payment_failed` | `payment.failed` | |
| Stripe | `payment_intent.canceled` | `payment.cancelled` | |
| Stripe | `checkout.session.completed` + `payment_status=paid` | `payment.succeeded` | Needs context |
| Stripe | `charge.refunded` | `refund.completed` | |
| Stripe | `setup_intent.succeeded` | `payment_method.setup_completed` | |
| Stripe | `charge.dispute.*` | `dispute.*` | |
| Stripe | `invoice.*` / `customer.subscription.*` | **unmapped** | Ambiguous |
| Moyasar | `payment_paid` | `payment.succeeded` | |
| Moyasar | `payment_failed` / `payment_faild` | `payment.failed` | Typo normalized by gateway |
| Moyasar | `payment_authorized` | `payment.authorized` | |
| PayPal | `PAYMENT.CAPTURE.COMPLETED` | **`capture.completed`** | Not `payment.succeeded` |
| PayPal | `PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED` | **`payment.processing`** | Status `partially_captured`; **not** `capture.completed` / `payment.succeeded` — open capture story |
| PayPal | `PAYMENT.CAPTURE.REFUNDED` | `refund.completed` when status is `refunded`; otherwise `refund.pending` | Type-only / refund-shaped / `partially_refunded` must not close a capture as fully refunded |
| PayPal | `PAYMENT.REFUND.COMPLETED` | `refund.completed` | Refund resource; capture id via `rel: up` / related_ids |
| PayPal | `PAYMENT.CAPTURE.REVERSED` | **unmapped** | No stable `reversed` arm |
| Paymob | `TOKEN` | `payment_method.setup_completed` | |
| Paymob | `TRANSACTION` + success flags | `payment.succeeded` / … | Use `flags` / `status` / `amounts` context; **processed** server webhook only |
| Paymob | `TRANSACTION` + signed `is_refunded` (or HMAC `is_refund` alias) | **`refund.pending`** | Domain status **`refund_completed`** (incomplete snapshot) — **not** full `refunded` / `partially_refunded`. Unsigned `refunded_amount_cents` is stripped after HMAC and cannot choose partial vs full |
| Paymob | `TRANSACTION` amount-only refund (`refunded_amount_cents` without signed refund flags) | **ignored for refund** | Status stays non-refund; **not** `payment.succeeded` and **not** forged `refunded` |
| Paymob | `TRANSACTION` `is_auth` + full `captured_amount` / status `paid` | `payment.succeeded` | Not `payment.authorized` when fully settled; capture totals on webhooks still require inquiry for multi-partial (unsigned `captured_amount` stripped) |
| Paymob | `TRANSACTION` `partially_captured` (status or partial `captured_amount` on **API** path) | **`payment.processing`** | Aligns with `isPaidOutcome` (partial is not paid-like); amount-aware capture logic required |
| Paymob | `TRANSACTION` `is_capture` + success (no trusted `captured_amount`) | **`payment.processing`** | Gateway fail-closes to `processing` — **not** `capture.completed` / `paid`. Use transaction inquiry for capture fulfillment (PAYMOB-4) |
| Paymob | `TRANSACTION_RESPONSE` without status | **unmapped** | Do not fulfill on redirect-only |
| Paymob | `TRANSACTION_RESPONSE` + success / paid / capture signals | **`payment.processing`** | **Never** `payment.succeeded` / `capture.completed` on redirect; wait for processed `TRANSACTION` |

**PayPal capture choice:** `PAYMENT.CAPTURE.COMPLETED` maps to
`capture.completed` (capture domain), not `payment.succeeded`. Apps that
fulfill when money is captured should handle `capture.completed` (and may still
inspect normalized `WebhookEvent.status === 'paid'` during migration).

**PayPal partial auth capture:** `PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED`
dual-writes **`payment.processing`** with domain status `partially_captured` —
never `capture.completed` or `payment.succeeded`. Aligns with Paymob partial
dual-write and `isPaidOutcome` (paid-only). Do not fulfill remaining authorized
amount on this event alone; use amount-aware capture completion signals.

**Paymob redirect vs processed:** Native type is the distinguisher. Browser/query
redirect callbacks parse as `TRANSACTION_RESPONSE` and dual-write
`payment.processing` even when status is `paid` or flags say success — so
fulfill-on-`payment.succeeded` handlers never ship from redirect alone. Use the
processed backend notification (`type: 'TRANSACTION'`) or transaction inquiry
as the sole fulfillment source of truth.

**Paymob inbox key (WEBHOOKS-1):** `WebhookEvent.id` is the **transaction id**
on both redirect and processed notifications. `@paykernel/webhooks`
`deriveWebhookEventKey('paymob', id, type)` yields
`paymob:TRANSACTION_RESPONSE:{txn}` vs `paymob:TRANSACTION:{txn}`. Passing
`event` (or `event.event` with `provider.eventType`) into `processVerified`
qualifies the key automatically. Inbox-deduping on raw `event.id` plus a
normal return on documented redirect is the P0 that swallows later paid.

**Stripe / Paymob partial capture:** Domain status `partially_captured` dual-writes
`payment.processing`, not `payment.succeeded`. Stripe still emits native
`payment_intent.succeeded` for partial captures; the mapper consults
`context.status` and demotes the stable type. That matches
`isPaidOutcome` / paid-like helpers (partial capture is excluded). Type-only
handlers that fulfill solely on `payment.succeeded` will not over-fulfill
partials; amount-aware logic still needed for partial inventory/settlement.
Fulfill only with status `paid` or `isPaidOutcome`.

**Paymob refund HMAC honesty:** Transaction HMAC covers signed refund flags
(`is_refunded` / `is_refund` when it is the HMAC source), **not**
`refunded_amount_cents`. After verify the SDK **always strips** unsigned
`refunded_amount_cents` / `captured_amount` / `is_captured` before status map.
Signed `is_refunded: true` → domain status **`refund_completed`** (incomplete
money snapshot) with dual-write `refund.pending`; partial vs full completeness
requires transaction inquiry. Refund domain webhooks **omit `amount`** when no
trusted refunded total is available so consumers do not book order
`amount_cents` as the refund. Amount-only `refunded_amount_cents` without a signed
refund flag does **not** upgrade status to refunded.

Tables are pure data (`STRIPE_EVENT_TYPE_MAP`, `MOYASAR_EVENT_TYPE_MAP`,
`PAYPAL_EVENT_TYPE_MAP`, …) plus `mapProviderEventTypeToStable`.

## Dual-write with legacy `WebhookEvent`

0.x compatibility strategy:

| Field | Behavior |
|-------|----------|
| `WebhookEvent.type` | **Unchanged** — provider-native / gateway-normalized free-form |
| `WebhookEvent.stableType` | Stable name when mappable; omitted when unmapped |
| `WebhookEvent.event` | Full `PaymentEvent` |
| `WebhookEvent.provider` | `ProviderEventMetadata` |
| `WebhookEvent.rawPayload` | Still **required** request-local; **deprecated for persistence** |
| `PaymentEvent.type` | **Always** stable name or `provider.unmapped` |

```ts
import { webhookEventToPaymentEvent } from '@paykernel/core';

// Built-in parseWebhookEvent + handleWebhook dual-write automatically:
const event = await client.handleWebhook('moyasar', body);
// event.type === 'payment_paid'          // legacy free-form (unchanged)
// event.stableType === 'payment.succeeded'
// event.event.type === 'payment.succeeded'
// event.provider.eventType === 'payment_paid'

// Custom gateways that omit dual-write: handleWebhook attaches as a safety net.
// Manual conversion still available:
const onlyPaymentEvent = webhookEventToPaymentEvent(event);
```

**Do not** rewrite gateway tests to expect stable names on `.type` without an
explicit migration. Dual-write is additive (`event` / `stableType` / `provider`).

### Migration from free-form `type`

1. Prefer `event.event` or `webhookEventToPaymentEvent(event)`.
2. Switch on `schemaVersion` + `PaymentEvent.type`.
3. Inbox-dedupe with `deriveWebhookEventKey(gateway, event.id, event.type)`
   (Paymob **must** include notification class — redirect
   `TRANSACTION_RESPONSE` and processed `TRANSACTION` share the same txn id).
   Do not inbox-dedupe Paymob on raw `event.id` alone (WEBHOOKS-1).
4. For persistence, call `toPersistedPaymentEventEnvelope` (never store
   `rawPayload` by default); prefer `event.payloadHash` when present.
5. When ready for 1.0, `type` may become stable-only; until then dual-write.

## Raw payload retention

| Path | Raw body |
|------|----------|
| Request-local handlers | `WebhookEvent.rawPayload` (required 0.x) |
| `PaymentEvent` default | **No** raw on nested `payment` |
| `PersistedPaymentEventEnvelope` | **Strips** raw / `clientSecret` / secrets |
| Long-term encrypted storage | App implements `RawWebhookPayloadCodec` + `encryptRawWebhookPayload` |

```ts
import {
  toPersistedPaymentEventEnvelope,
  hashWebhookPayload,
  encryptRawWebhookPayload,
  type RawWebhookPayloadCodec,
} from '@paykernel/core';

const paymentEvent = webhookEventToPaymentEvent(webhookEvent);
const envelope = toPersistedPaymentEventEnvelope(paymentEvent, {
  rawForHash: webhookEvent.rawPayload, // already redacted by Moyasar gateway
  storedAt: new Date().toISOString(),
});
// envelope.event has no rawPayload / rawResponse / clientSecret

// Optional: app-owned encrypted retention
const record = await encryptRawWebhookPayload(webhookEvent.rawPayload, codec, {
  codecId: 'kms-v1',
});
```

### `encryptRawWebhookPayload` plaintext preparation

Core never ships a default encryptor — apps own keys via `RawWebhookPayloadCodec`.
Before `codec.encrypt` runs, plaintext is prepared as follows:

| Input | Behavior |
|-------|----------|
| **object** (plain JSON-like value) | Known secret keys redacted via `redactWebhookPayloadSecrets`, then canonical-stringified |
| **string** that is JSON object/array | `JSON.parse` → same redaction + stringify (secret values are **not** encrypted verbatim) |
| **string** that is non-JSON / non-object JSON | Passed through unchanged (app-owned binary-ish or primitive text) |
| **`Uint8Array` / `Buffer`** | Passed through unchanged (app-owned binary; core does **not** invent binary redaction) |

`payloadHash` on the returned record always uses `hashWebhookPayload` (redacted
canonical digest), independent of which plaintext path the codec receives.

**Never** re-expose Moyasar `secret_token`, Stripe signatures, PayPal transmission
sigs, or HMAC headers in envelopes, logs, or `payloadHash` inputs.
`hashWebhookPayload` redacts known secret keys (including camelCase aliases)
before hashing. JSON strings are parsed and redacted the same way as encrypt
plaintext; after redaction, string vs object digests may still differ
(WEBHOOKS-2). Top-level `Uint8Array` / `Buffer` is hashed as the raw bytes.

## `PersistedPaymentEventEnvelope`

```ts
type PersistedPaymentEventEnvelope = {
  schemaVersion: '1';
  event: PaymentEvent;
  payloadHash: string; // hex sha256 of redacted canonical bytes
  storedAt: string;    // ISO-8601
};
```

Lease-aware inbox **store contracts** remain in testkit for conformance and the
memory reference impl (Phase 9 — [`store-contracts.md`](../../testkit/docs/store-contracts.md)).
The Phase 10 webhook **inbox engine** lives in **`@paykernel/webhooks`**
([guide](../../webhooks/docs/webhook-inbox.md)); it owns domain `WebhookInboxStore`
types (structurally compatible with testkit) and `createWebhookInboxEngine`.

When integrating the engine + store:

1. Dedupe via `deriveWebhookEventKey(gateway, event.provider.eventId,
   event.provider.eventType)` (and/or `payloadHash` conflict policy). Paymob
   keys include the native type (`TRANSACTION` vs `TRANSACTION_RESPONSE`) so
   redirect and processed snapshots are distinct (WEBHOOKS-1).
2. Persist **only** the envelope (or equivalent sanitized fields) as optional
   `payloadRef` / claim `envelope` — never raw signatures or secrets.
3. Treat hash conflicts on the same id as integrity failures (`payload_conflict`
   outcome; see store claim kinds + conformance suites).

## Helpers (public exports)

| Symbol | Purpose |
|--------|---------|
| `STABLE_PAYMENT_EVENT_TYPES` / `isStablePaymentEventType` | Stable name set + guard |
| `PAYMENT_EVENT_SCHEMA_VERSION` | `'1'` |
| `mapProviderEventTypeToStable` | Native → stable / unmapped |
| `webhookEventToPaymentEvent` | Legacy → `PaymentEvent` |
| `attachPaymentEvent` | Dual-write onto `WebhookEvent` |
| `buildProviderEventMetadata` | Metadata builder |
| `paymentFromWebhookEvent` | Phase 6 `Payment` from webhook fields |
| `hashWebhookPayload` | Redacted canonical sha256 |
| `toPersistedPaymentEventEnvelope` | Sanitized envelope |
| `encryptRawWebhookPayload` | App codec encryption helper |
| `assertNoSecretsInEnvelope` | Test/runtime guard |

## What this phase does **not** do

- Does not change `handleWebhook` return type (still `WebhookEvent`; dual-write
  is additive on the same object).
- Does not implement Phase 8 clock injection. Phase 9 lease-aware store
  contracts and conformance live in `@paykernel/testkit`. The inbox
  **engine** is `@paykernel/webhooks` (not core).
- Does not remap gateway `parseWebhookEvent` `.type` strings (keeps native;
  stable names live on `stableType` / `event.type`).
- Does not store raw provider payloads by default (Engineering Rule 14).
