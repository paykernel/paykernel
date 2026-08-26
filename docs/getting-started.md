# Getting started

Compose PayKernel from the public packages. Every symbol below is exported from the package named in the import.

## What to install

| You need | Packages |
| --- | --- |
| Create / capture / refund / verify webhooks | `@paykernel/core` |
| Deduped, leased webhook fulfillment | core + `@paykernel/webhooks` + one `@paykernel/store-*` |
| Recover after timeout / indeterminate create | add `@paykernel/reconciliation` (same store) |
| Pick a gateway before `createPayment` | optional `@paykernel/routing` |
| Metrics / spans | optional `@paykernel/opentelemetry` |
| App tests without live PSPs | `@paykernel/testkit` (dev) |

Core never depends on webhooks, stores, routing, or OpenTelemetry. You wire those at the application layer.

**Which store:** [adapter-selection.md](./adapter-selection.md). This walkthrough uses PostgreSQL (`pg`) because it is the general multi-host default. Local SQLite is single-host only. Redis is optional. D1 and Durable Objects are Cloudflare-only.

---

## 1. First payment (core only)

```typescript
import { createPaymentClient, money, isPaidOutcome, moyasarGateway } from "@paykernel/core";

const client = createPaymentClient({
  gateways: {
    moyasar: moyasarGateway({
      secretKey: process.env.MOYASAR_SECRET_KEY!,
      webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
    }),
  },
  defaultGateway: "moyasar",
});

const result = await client.createPayment({
  amount: money("100.00", "SAR"),
  currency: "SAR",
  orderId: "order_123",
  callbackUrl: "https://example.com/callback",
  moyasarSource: { type: "token", token: "token_xxx" },
});

if (isPaidOutcome(result)) {
  // Paid-like settlement only (`outcome === "succeeded"` and status `paid`).
} else if (result.outcome === "indeterminate" || result.reconciliationRequired) {
  // Charge may already exist. Schedule reconcile. Do not createPayment again.
} else {
  // declined / pending / authorized — see operation-results.md
}
```

`success: true` is not the fulfillment signal. Prefer `isPaidOutcome` and the `outcome` discriminant. Full rules: [operation-results.md](../packages/core/docs/operation-results.md), [money.md](../packages/core/docs/money.md).

---

## 2. Verify a webhook (still core only)

`PaymentClient.handleWebhook` **verifies, normalizes, and runs hooks**. It does not claim an inbox, dedupe across workers, or decide HTTP status.

```typescript
const webhookEvent = await client.handleWebhook("moyasar", rawBody, signature);
// webhookEvent.event is the Phase 7 PaymentEvent when mapping succeeds.
```

**Never fulfill inside `onWebhookVerified`.** That hook is authenticity-only
(metrics). Verification can succeed on a payload you must still claim and lease.
Guides: [webhooks.md](../packages/core/docs/webhooks.md), [webhook-events.md](../packages/core/docs/webhook-events.md).

`handleWebhook` throws on a failed signature (`InvalidWebhookError`). That is forgery — map to a 4xx in *your* HTTP adapter. The inbox engine never sets status codes.

---

## 3. Production composition (inbox + durable store)

```bash
bun add @paykernel/core @paykernel/webhooks @paykernel/store-postgres pg
```

Migrate **explicitly**. Importing a store package does not apply DDL.

```typescript
import { createPaymentClient, stripeGateway } from "@paykernel/core";
import {
  createWebhookInboxEngine,
  resolveInboxPayloadHash,
  type WebhookProcessingOutcome,
} from "@paykernel/webhooks";
import {
  createPostgresStoresFromPg,
  createPgPostgresExecutor,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/pg";
import { Pool } from "pg";

type Order = { orderId: string; gatewayPaymentId?: string };
declare function findOrderByGatewayPaymentId(id: string): Order | undefined;
declare function findOrderById(orderId: string): Order | undefined;
declare function fulfillOrder(order: Order, gatewayPaymentId: string): Promise<void>;

function isPaidFulfillmentEvent(event: unknown): boolean {
  if (event === null || typeof event !== "object") return false;
  const rec = event as { type?: unknown; payment?: { status?: unknown } };
  return (
    (rec.type === "payment.succeeded" || rec.type === "capture.completed") &&
    rec.payment?.status === "paid"
  );
}

/** Bind webhook PI first. Metadata orderId must not fulfill a different stored PI. */
function findOrderForEvent(
  webhookEvent: { gatewayPaymentId?: string; paymentId?: string },
  _event: unknown,
): { kind: "ok"; order: Order } | { kind: "mismatch" } | { kind: "missing" } {
  const webhookPi =
    typeof webhookEvent.gatewayPaymentId === "string" &&
    webhookEvent.gatewayPaymentId.length > 0
      ? webhookEvent.gatewayPaymentId
      : undefined;
  if (webhookPi === undefined) return { kind: "missing" };
  const byGw = findOrderByGatewayPaymentId(webhookPi);
  if (byGw) return { kind: "ok", order: byGw };
  const candidate = webhookEvent.paymentId
    ? findOrderById(webhookEvent.paymentId)
    : undefined;
  if (!candidate) return { kind: "missing" };
  if (candidate.gatewayPaymentId === undefined) {
    candidate.gatewayPaymentId = webhookPi;
    return { kind: "ok", order: candidate };
  }
  if (candidate.gatewayPaymentId === webhookPi) {
    return { kind: "ok", order: candidate };
  }
  return { kind: "mismatch" };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Ops / CI only — never on import or inside the request factory.
const executor = createPgPostgresExecutor(pool);
await migratePostgresAdapter(executor);
const stores = createPostgresStoresFromPg({ client: pool });

const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    }),
  },
  defaultGateway: "stripe",
  // WEBHOOKS-2: no onWebhookVerified fulfillment here — fulfillment belongs only
  // in the handler passed to processWebhookHttp after the inbox claim. See
  // “Never fulfill in onWebhookVerified” above.
});
// `inline` does not require a processRetryable worker.
// `durable_retry` is only safe to ACK if that worker is guaranteed.
const engine = createWebhookInboxEngine({
  store: stores.webhookInbox,
  mode: "inline",
});

export async function onStripeWebhook(rawBody: string, signature: string) {
  // Raw-body-safe: pass raw string directly; do not JSON.parse/stringify.
  const result = await processWebhookHttp({
    gateway: "stripe",
    rawBody,
    headers: { "stripe-signature": signature },
    client,
    engine,
    handler: async (ctx) => {
      if (!isPaidFulfillmentEvent(ctx.event)) return;
      // Extract gatewayPaymentId from PaymentEvent payment.references.providerObjectId
      const event = ctx.event as { payment?: { references?: { providerObjectId?: string; internalReference?: string } } };
      const gatewayPaymentId = event.payment?.references?.providerObjectId;
      if (typeof gatewayPaymentId !== "string" || gatewayPaymentId.length === 0) return;
      // Simple lookup: try gatewayPaymentId, then internalReference
      const byGw = findOrderByGatewayPaymentId(gatewayPaymentId);
      if (byGw) {
        await fulfillOrder(byGw, gatewayPaymentId);
        return;
      }
      const ref = event.payment?.references?.internalReference;
      if (ref) {
        const candidate = findOrderById(ref);
        if (candidate) {
          await fulfillOrder(candidate, gatewayPaymentId);
          return;
        }
      }
      throw new Error("no local order for paid webhook");
    },
  });
  return { status: result.status };
}

// For Express, use expressRawJson() only on the webhook route:
// app.post("/webhooks/stripe", expressRawJson(), expressWebhook({ gateway: "stripe", client, engine, handler }));

import { mapInboxOutcome, processWebhookHttp } from "@paykernel/integration-http";
// HTTP mapping lives in @paykernel/integration-http, not in webhooks.
// Use processWebhookHttp for raw-body-safe handling, or mapInboxOutcome(outcome) for custom adapters.
// Default is fail-closed provider_redelivery (never 200 for scheduled_for_retry); pass { kind: "durable_worker" } when a worker is guaranteed.
// Framework helpers: honoWebhook (Hono), elysiaWebhook (Elysia, parse:"none"), expressWebhook + expressRawJson (Express), handleCloudflareWebhook (Workers).
```

**Hash rule:** prefer `webhookEvent.payloadHash`. If you must hash, hash the **same object shape** the gateway hashed (`rawPayload` / parsed event). Do **not** fall back to `hashWebhookPayload(rawBody)` — that mix is `payload_conflict` / idle supersede. `resolveInboxPayloadHash` throws if both inputs are missing.

**Paymob keys:** pass `event: webhookEvent.event` so domain status (`payment.status` / `refund.status`) qualifies `paymob:TRANSACTION:{id}:{status}`. A later void on the same transaction id is not `already_completed`.

Inbox modes, outcomes, and crash matrix: [webhook-inbox.md](../packages/webhooks/docs/webhook-inbox.md).

Fulfill only when the rematched stable type is still `payment.succeeded` / `capture.completed` **and** nested `payment.status === "paid"`, then bind `gatewayPaymentId`. Do not fulfill on `payment.processing`, `partially_captured`, or Paymob `TRANSACTION_RESPONSE`. Never fulfill in `onWebhookVerified`. See [operation-results.md](../packages/core/docs/operation-results.md).

---

## 4. Indeterminate create → reconcile (do not charge again)

Timeouts, dropped connections after POST, mutating HTTP 2xx with unreadable JSON, and `outcome: "indeterminate"` mean the provider **may already have the charge**.

```typescript
import {
  createPaymentReconciler,
  createReconciliationScheduler,
  createGetPaymentLookupPort,
  buildReconciliationTarget,
  buildProviderPaymentSnapshot,
  decideReconciliationPolicy,
  type ReconciliationTarget,
} from "@paykernel/reconciliation";
import {
  money,
  NetworkError,
  type GatewayPaymentResult,
  type Money,
} from "@paykernel/core";

function publishableCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function moneyFromMajorUnits(
  amount: number | undefined,
  currency: string | undefined,
): Money | undefined {
  if (amount === undefined || !Number.isFinite(amount)) return undefined;
  if (currency === undefined) return undefined;
  try {
    return money(amount, currency);
  } catch {
    return undefined;
  }
}

/** Provider recon snapshot from `getPayment` money only. Incomplete money fails closed. */
function providerSnapshotFromGetPayment(got: GatewayPaymentResult) {
  if (!got.gatewayId) return undefined;
  const currency = publishableCurrency(got.currency);
  const hasAmountLike =
    got.amount !== undefined ||
    got.capturedAmount !== undefined ||
    got.refundedAmount !== undefined;
  if (hasAmountLike && currency === undefined) return undefined;
  const amount = moneyFromMajorUnits(got.amount, currency);
  if (amount === undefined) return undefined;
  const input: Parameters<typeof buildProviderPaymentSnapshot>[0] = {
    gatewayPaymentId: got.gatewayId,
    status: got.status,
    amount,
    providerStatus: got.status,
  };
  if (got.capturedAmount !== undefined) {
    const captured = moneyFromMajorUnits(got.capturedAmount, currency);
    if (captured === undefined) return undefined;
    input.capturedAmount = captured;
  }
  if (got.refundedAmount !== undefined) {
    const refunded = moneyFromMajorUnits(got.refundedAmount, currency);
    if (refunded === undefined) return undefined;
    input.refundedAmount = refunded;
  }
  return buildProviderPaymentSnapshot(input);
}

const scheduler = createReconciliationScheduler({
  store: stores.reconciliation,
});

const reconciler = createPaymentReconciler({
  lookup: createGetPaymentLookupPort({
    getPayment: async ({ gateway, gatewayPaymentId }) => {
      const got = await client.getPayment({ gatewayPaymentId }, gateway);
      // Never copy catalog / local trusted amount onto the provider snapshot.
      // Publish currency with every major-unit field; omit incomplete money.
      return providerSnapshotFromGetPayment(got);
    },
  }),
});

async function createOrSchedule(
  params: Parameters<typeof client.createPayment>[0],
  gateway = "stripe",
) {
  try {
    const result = await client.createPayment(params, gateway);
    if (result.outcome === "indeterminate" || result.reconciliationRequired) {
      await scheduler.schedule({
        target: buildReconciliationTarget({
          gateway,
          gatewayPaymentId: result.gatewayId,
          idempotencyKey: params.idempotencyKey,
          expected: { status: "pending" },
        }),
        runAt: new Date().toISOString(),
        reason: "indeterminate_create",
      });
    }
    return result;
  } catch (err) {
    if (err instanceof NetworkError && err.afterProviderSubmit) {
      await scheduler.schedule({
        target: buildReconciliationTarget({
          gateway,
          idempotencyKey: params.idempotencyKey,
          expected: { status: "pending" },
        }),
        runAt: new Date().toISOString(),
        reason: "indeterminate_create",
      });
      return;
    }
    throw err;
  }
}

// Worker: the store row is subjectId + reason, not a serialized target.
// Keep enough app state (or a stable key) to rebuild ReconciliationTarget.
async function loadTarget(job: { record: { subjectId: string } }): Promise<ReconciliationTarget> {
  return buildReconciliationTarget({
    gateway: "stripe",
    gatewayPaymentId: job.record.subjectId,
    expected: { status: "pending" },
  });
}

const due = await scheduler.claimDue({ limit: 10 });
for (const job of due) {
  const target = await loadTarget(job);
  const result = await reconciler.reconcile(target);
  const decision = decideReconciliationPolicy(result, target);
  if (decision.action === "mark_consistent" && decision.safe) {
    await scheduler.complete({ key: job.key, leaseToken: job.leaseToken });
    continue;
  }
  if (decision.action === "do_not_create_replacement") {
    // Never createPayment again. Reschedule lookup; do not leave the lease hanging.
    await scheduler.failAndReschedule({
      key: job.key,
      leaseToken: job.leaseToken,
      error: new Error(decision.reason),
      attempt: job.record.attempts,
    });
    continue;
  }
  if (decision.action === "retry_later") {
    await scheduler.failAndReschedule({
      key: job.key,
      leaseToken: job.leaseToken,
      error: new Error("retry_later"),
      attempt: job.record.attempts,
    });
    continue;
  }
  // update_local_to_paid / update_local_to_failed / apply_drift_review /
  // manual_review — apply local changes first (see scheduling.md), then:
  await scheduler.markManualReview({
    key: job.key,
    leaseToken: job.leaseToken,
    note: decision.action,
  });
}
```

The store does not persist the full target. Rebuild it from `subjectId` / your order table. Do not `complete` on raw `result.outcome === "consistent"` — sparse pending vs provider pending is still settling (`retry_later`). Full worker matrix: [scheduling.md](../packages/reconciliation/docs/scheduling.md).

Invariant: **lookup + decide, never a second charge**.

`createPayment` / capture / refund that may have reached the provider return `outcome: "indeterminate"` (and often `reconciliationRequired: true`) instead of throwing in several post-submit paths. Thrown `NetworkError` with `afterProviderSubmit: true` is the remaining uncertain class (for example Moyasar mutating HTTP 200 + invalid JSON).

---

## 5. Optional: select a gateway first

```typescript
import { createPaymentRouter, route } from "@paykernel/routing";
import { money } from "@paykernel/core";

const router = createPaymentRouter({
  rules: [route({ currency: "SAR" }).to("moyasar")],
  fallback: "stripe", // select-time only — not post-attempt recovery
});

const amount = money("10.00", "SAR");
const decision = router.select({
  currency: amount.currency,
  amount,
});
await client.createPayment({ amount, currency: amount.currency, orderId: "o1" }, decision.gateway);
```

If `input.currency` and `amount.currency` are both set and differ, `select` throws `NoRouteMatchError` with reason `currency_mismatch_honesty`. Pass `money()` (or the same currency on both fields). After a timeout or indeterminate attempt, do **not** `select` another gateway. [safe-fallback.md](../packages/routing/docs/safe-fallback.md).

---

## Failure path (inbox)

| Outcome | Meaning | Typical HTTP (you map this) |
| --- | --- | --- |
| `processed` | Handler ran; `complete` succeeded | 200 |
| `duplicate_completed` | Same event already done | 200 |
| `scheduled_for_retry` | Read `reason` (`parked` / `handler_retry` / `not_available`) | 200 if a worker owns the row; 5xx for `not_available` without a worker |
| `handler_failed` | Handler threw; `retryable` says whether to redeliver | 5xx if retryable |
| `invalid_webhook` | Bad input / forgery class | 4xx |
| `payload_conflict` | Hash mismatch on an active lease | 409 |

Silent ACK of failed work is forbidden. Full matrix: [webhook-inbox.md](../packages/webhooks/docs/webhook-inbox.md).

---

## Next

- [docs home](./README.md)
- [Runnable examples](../examples/README.md) — checkout kernel + Bun Hono/Elysia over single-host in-memory SQLite
- [Adapter selection](./adapter-selection.md)
- [Store contracts](../packages/store-contracts/docs/contracts.md)
- Gateway notes: [Moyasar](../packages/core/docs/moyasar.md) · [PayPal](../packages/core/docs/paypal.md) · [Paymob](../packages/core/docs/paymob.md) · [Stripe](../packages/core/docs/stripe.md)
