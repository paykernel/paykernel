# Lifecycle Hooks

Hooks allow you to intercept and modify payment operations.

## Configuration

```typescript
const client = new PaymentClient({
  moyasar: { secretKey: '...' },
  hooks: {
    // Logging
    onBefore: async (ctx) => {
      console.log(`[${ctx.gateway}] Starting ${ctx.operation}`);
      return { proceed: true };
    },

    // Fraud detection
    beforeCreatePayment: async (ctx) => {
      const isFraud = await fraudService.check(ctx.params);
      if (isFraud) {
        return { proceed: false, abortReason: 'Fraud detected' };
      }
      return { proceed: true };
    },

    // Analytics
    afterCreatePayment: async (ctx, result) => {
      await analytics.track('payment_created', {
        gateway: ctx.gateway,
        amount: ctx.params.amount,
        status: result.status,
      });
      return { proceed: true };
    },

    // Error tracking
    onError: async (ctx, error) => {
      await errorTracker.capture(error, { context: ctx });
    },

    // Webhook processing
    onWebhookVerified: async (event) => {
      await orderService.updatePaymentStatus(
        event.paymentId,
        event.status
      );
    },
  },
});
```

## Available Hooks

| Hook | Trigger | Can Abort? |
|------|---------|------------|
| `onBefore` | Before any hooked operation | ✅ |
| `onAfter` | After any successful hooked operation | ❌ (ignored; see below) |
| `onError` | When the gateway executor/API path throws (not intentional before-hook aborts) | ❌ |
| `beforeCreatePayment` | Before creating payment | ✅ |
| `afterCreatePayment` | After payment created | ❌ (ignored; see below) |
| `beforeAuthorize` | Before authorizing payment | ✅ |
| `afterAuthorize` | After payment authorized | ❌ (ignored; see below) |
| `beforeCapture` | Before capturing payment | ✅ |
| `afterCapture` | After payment captured | ❌ (ignored; see below) |
| `beforeRefund` | Before refunding | ✅ |
| `afterRefund` | After refund processed | ❌ (ignored; see below) |
| `beforeVoid` | Before voiding payment | ✅ |
| `afterVoid` | After payment voided | ❌ (ignored; see below) |
| `onWebhookReceived` | When webhook payload received | ❌ (logged; verify continues) |
| `onWebhookVerified` | After webhook verified | ❌ (throw → rethrow / 5xx) |
| `onWebhookFailed` | When webhook verification fails | ❌ (secondary; primary error kept) |

## After hooks cannot abort money operations

Before hooks run **before** the gateway API call. Returning
`{ proceed: false }` (or throwing) aborts the operation cleanly — no charge,
capture, refund, or void is sent.

After hooks run **after** the gateway operation has already succeeded. They
**cannot** abort or fail the operation:

- If an after hook returns `{ proceed: false }`, the abort is **ignored**
  (**warn-logged** by `HooksManager` / the gateway layer) and **later
  after-handlers still run** with the last good `modifiedResult`. Success is
  always returned because the side effect is already committed.
- If an after hook **throws**, the throw is **isolated** and **error-logged**
  (later after-handlers still run; earlier `modifiedResult` is kept). The
  gateway outer safety net also ensures a throw cannot convert success into a
  payment failure. Post-success analytics / bookkeeping failures must not
  become retryable payment failures.

### After-hooks cannot change money identity fields

After-hooks may return `modifiedResult` to attach additive fields (e.g.
metadata bags, `rawResponse` annotations, `redirectUrl` tweaks). The SDK
**restores critical money / identity fields** from the original gateway result
whenever they were present on that original object — including when the hook
mutates the result argument **in-place** (hooks receive a shallow clone; the
freeze snapshot stays clean):

`success`, `status`, `amount`, `gatewayId`, `captureId`, `authorizationId`,
`orderId`, `totalRefunded`, `refundId`, `gatewayRefundId`, `fee`,
`capturedAmount`, `refundedAmount`, `clientSecret`

A non-object `modifiedResult` (`null` / primitive) is **ignored** and the
original gateway result is returned (warn-logged when a logger is configured).

Hooks **cannot** flip paid status, amounts, fees, client secrets, or gateway
identity IDs. Do not rely on after-hooks to “correct” financial outcomes —
change the gateway call or use before-hooks instead.

The SDK **does not reverse** the gateway side effect in either case:

- A capture/refund/void that already completed at the provider **stays completed**.
- Idempotency records (where used) may already be marked completed.

Use after hooks to inspect results, attach analytics, or return a
`modifiedResult` (non-money fields). Do **not** treat `proceed: false` (or a
throw) on an after hook as a financial undo — and do not expect them to surface
as `PaymentAbortedError` or to fail the caller.

## Which operations fire which hooks

Gateway methods that go through `BaseGateway.executeWithHooks` always run:

1. Global `onBefore` (if set)
2. Operation-specific `before*` (if set for that operation)
3. The gateway API call
4. Operation-specific `after*` (if set)
5. Global `onAfter` (if set)

On failure of the **executor / gateway API call** (or other uncaught errors
inside that path), `onError` runs, then the mapped error is rethrown.

`onError` does **not** run for intentional before-hook aborts, nor for after-hook
outcomes (after hooks never fail the operation):

- Before hook `{ proceed: false }` → `PaymentAbortedError` (no API call made)
- After hook `{ proceed: false }` → warn + return success (side effect committed)
- After hook throw → error log + return success (side effect committed)

Use `onError` for provider/network/validation failures from the executor path,
not for “business rule said stop” before aborts or after-hook noise.

| Operation (`ctx.operation`) | Specific before/after hooks | Notes |
|-----------------------------|-----------------------------|--------|
| `createPayment` | `beforeCreatePayment` / `afterCreatePayment` | All gateways |
| `authorizePayment` | `beforeAuthorize` / `afterAuthorize` | **Primarily PayPal** — `PayPalGateway.authorizePayment()` after customer approval of an `AUTHORIZE` intent order. Other built-in gateways do not expose a separate authorize step today; use `capture: false` + `capturePayment` instead. |
| `capturePayment` | `beforeCapture` / `afterCapture` | All gateways that support capture |
| `refundPayment` | `beforeRefund` / `afterRefund` | All gateways |
| `voidPayment` | `beforeVoid` / `afterVoid` | Gateways that support void |
| `getPayment` | _(global hooks only)_ | No dedicated `beforeGetPayment` |
| `getCheckoutSession` | _(global hooks only)_ | Stripe Checkout session lookup |
| `confirmStcPayOtp` | _(global hooks only)_ | Moyasar STC Pay OTP confirm |
| `createCheckoutSession` | _(global hooks only)_ | Stripe Checkout (and similar) |
| `verifyWebhook` | _(not used by `handleWebhook`)_ | Reserved operation name; client webhook flow uses the webhook hooks below |

### Webhook path (client-level, not `executeWithHooks`)

`PaymentClient.handleWebhook` runs a separate sequence (verify and parse are
**separate stages**):

| Step | Hook / outcome |
|------|----------------|
| Payload arrives | `onWebhookReceived(gateway, payload)` — **untrusted** |
| Verification fails | `onWebhookFailed(payload, error)` then rethrow |
| Parse fails after successful verify | Throw (`InvalidWebhookError` / `InvalidRequestError`); **no** `onWebhookFailed` |
| Verify + parse succeed | `onWebhookVerified(event)` — **trusted** |

#### Webhook hook throw matrix

| Hook | If it throws | Composition (`addHook` / multi-register) |
|------|--------------|------------------------------------------|
| `onWebhookReceived` | Logged; **verify continues** (never blocks) | Run both; rethrow first after both (outer path still isolates) |
| `onWebhookFailed` | Logged as secondary; **primary verify error is rethrown** | Run both; rethrow first after both (outer path still isolates) |
| `onWebhookVerified` | **Rethrown** so HTTP handlers can return **5xx** and the provider retries | **Fail-fast**: previous runs; if it throws, next is **not** run |

`onWebhookVerified` composition short-circuits on the first throw so a failed
primary fulfillment handler cannot leave a secondary handler also fulfilling
(which would double-charge or double-ship on a later provider retry).

**Merchants MUST dedupe by `event.id` (or an equivalent provider event id)
before fulfillment.** Providers retry on 5xx; without idempotent handlers you
will process the same paid event more than once.

Webhook hooks cannot abort verification by returning a value; handle rejection
by not fulfilling orders when verification fails (the SDK already throws).

See [webhooks.md](./webhooks.md#hook-ordering-and-verification) for details.

## Runtime composition (`addHook`)

When a second handler is registered for the same hook name:

- **Before hooks**: previous first; short-circuit on `proceed: false`.
- **After hooks**: chain with `modifiedResult` carry-forward. **`proceed: false`
  does not short-circuit** — it is **warn-logged and ignored** and later
  after-handlers still run with the last good result. Throws from one
  after-handler are **error-logged and isolated** so later handlers still run
  and earlier `modifiedResult` is kept. Success is always returned at the
  gateway layer.
- **`onWebhookVerified`**: fail-fast on first throw (no double fulfillment).
- **`onError` / `onWebhookReceived` / `onWebhookFailed`**: run both, then
  rethrow the first error (secondary isolation at the call site).

## Authorize hooks (PayPal)

`beforeAuthorize` / `afterAuthorize` are wired to the `authorizePayment`
operation. In this SDK that path is used by **PayPal**:

```typescript
// After createPayment({ capture: false }) and customer approval:
const auth = await client.gateway('paypal').authorizePayment({
  gatewayPaymentId: orderIdFromCreate,
});
```

Moyasar, Paymob, and Stripe place an auth hold via `createPayment({ capture: false })`
and capture later with `capturePayment` — those flows fire create/capture hooks,
not authorize hooks.
