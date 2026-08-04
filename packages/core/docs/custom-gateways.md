# Custom Gateways (Plugins)

Third-party gateways are first-class: implement `PaymentGateway` (usually via
`BaseGateway`), wrap it in a `GatewayAdapter`, and pass the adapter to
`createPaymentClient` — no core edits required.

For a deeper walkthrough of registry vs map construction, immutability, and
legacy migration, see [Plugin architecture](./plugin-architecture.md).

## Preferred path: `createPaymentClient`

```typescript
import {
  applyOutcomeToGatewayResult,
  BaseGateway,
  createPaymentClient,
  type GatewayAdapter,
  type GatewayContext,
  type CreatePaymentParams,
  type CaptureParams,
  type RefundParams,
  type GatewayPaymentResult,
  type GatewayRefundResult,
  type WebhookEvent,
} from '@paykernel/core';

class ExampleGateway extends BaseGateway {
  readonly name = 'example' as const;

  constructor(
    private readonly apiKey: string,
    hooks: ConstructorParameters<typeof BaseGateway>[1],
    logger?: ConstructorParameters<typeof BaseGateway>[2],
  ) {
    super({ apiKey }, hooks, logger);
  }

  async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks('createPayment', params, async (p) => {
      // Call your provider; dual-write Phase 6 outcome + references
      // (deprecated success is set from outcome). See operation-results.md.
      return applyOutcomeToGatewayResult(
        {
          gatewayId: 'ex_123',
          status: 'paid',
          redirectUrl: undefined,
          rawResponse: {},
          amount: typeof p.amount === 'number' ? p.amount : undefined,
          gateway: 'example',
        },
        'succeeded',
      );
    });
  }

  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks('capturePayment', params, async () => {
      throw new Error('Not implemented');
    });
  }

  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks('refundPayment', params, async () => {
      throw new Error('Not implemented');
    });
  }

  verifyWebhook(
    _payload: unknown,
    signature?: string,
    _headers?: Record<string, string>,
  ): boolean {
    return signature === 'valid';
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    return {
      id: 'evt_1',
      type: 'payment_paid',
      gateway: 'example',
      paymentId: undefined,
      gatewayPaymentId: 'ex_123',
      status: 'paid',
      timestamp: new Date(),
      rawPayload: payload,
    };
  }
}

/** Adapter factory: close over secrets; never put them on context or manifest. */
function exampleGateway(config: { apiKey: string }): GatewayAdapter<'example', ExampleGateway> {
  const closed = { ...config };
  return {
    name: 'example',
    manifest: {
      name: 'example',
      displayName: 'Example Provider',
      version: '1.0.0',
      // metadata must not include apiKey / secrets
    },
    create(context: GatewayContext) {
      return new ExampleGateway(closed.apiKey, context.hooks, context.logger);
    },
  };
}

const client = createPaymentClient({
  gateways: {
    example: exampleGateway({ apiKey: process.env.EXAMPLE_API_KEY! }),
  },
  defaultGateway: 'example',
  hooks: {
    beforeCreatePayment: (ctx) => {
      // ctx.gateway === 'example'
      return { proceed: true };
    },
    onWebhookVerified: async (event) => {
      // trusted payload only
      console.log(event.status);
    },
  },
});

await client.createPayment({
  amount: 10,
  currency: 'USD',
  callbackUrl: 'https://merchant.example/callback',
});

await client.handleWebhook('example', rawBody, signatureHeader);
```

Built-in providers use the same adapter shape:

```typescript
import {
  createPaymentClient,
  stripeGateway,
  moyasarGateway,
} from '@paykernel/core';

const payments = createPaymentClient({
  gateways: {
    stripe: stripeGateway({ secretKey: process.env.STRIPE_SECRET_KEY! }),
    moyasar: moyasarGateway({ secretKey: process.env.MOYASAR_SECRET_KEY! }),
    example: exampleGateway({ apiKey: process.env.EXAMPLE_API_KEY! }),
  },
  defaultGateway: 'moyasar',
});

payments.gateway('stripe');   // StripeGateway
payments.gateway('example');  // ExampleGateway
// payments.gateway('adyen'); // compile-time error — not registered
```

## Registry builder (same adapters)

```typescript
import { createGatewayRegistry, createPaymentClient } from '@paykernel/core';

const registry = createGatewayRegistry()
  .register(stripeGateway({ secretKey: '...' }))
  .register(exampleGateway({ apiKey: '...' }))
  .build(); // immutable

const client = createPaymentClient({
  registry,
  defaultGateway: 'stripe',
});
```

- `register` rejects duplicate names (`InvalidRequestError`).
- `replace` overwrites intentionally.
- Built registries are frozen; there is no `unregisterGateway` on a live client.
- Change the gateway set by building a **new** client (never mutate mid-request).

## What you get without editing core

| Concern | How it works |
| --- | --- |
| Payments | `client.createPayment` / capture / refund / void / get |
| Webhooks | `client.handleWebhook(name, …)` → verify → parse → hooks |
| Hooks | Shared `HooksManager` via `GatewayContext.hooks` |
| Logging | Redacting logger on client + context (do not log secrets yourself) |
| Errors | Throw `PaymentError` subclasses; they propagate unchanged |

## Naming model

| Type | Meaning |
| --- | --- |
| `BuiltInGatewayName` | `"moyasar" \| "paypal" \| "paymob" \| "stripe"` |
| `GatewayName` | **0.x alias** of `BuiltInGatewayName` (closed) — used by legacy config |
| `GatewayId` | Open `string` for hooks, webhooks, and plugin contracts |
| Registry / `TMap` | Inferred names from your adapters (including `"example"`) |

## Legacy constructor (still supported in 0.x)

```typescript
import { PaymentClient } from '@paykernel/core';

/** @deprecated Prefer createPaymentClient({ gateways | registry }) */
const legacy = new PaymentClient({
  moyasar: { secretKey: 'sk_test_…' },
  defaultGateway: 'moyasar',
});
```

This path only constructs the four built-ins from provider config keys. It does
**not** accept custom adapters. Migrate when convenient; it remains through 0.x.

## Conformance suite (testkit)

Validate a custom gateway with the shared, capability-gated suite from
`@paykernel/testkit` (offline / mock or fixture-driven doubles only —
never live provider credentials in CI):

```typescript
import { defineGatewayCapabilities } from '@paykernel/core';
import {
  runGatewayConformanceSuite,
  mockGateway,
} from '@paykernel/testkit';

const capabilities = defineGatewayCapabilities({
  payments: true,
  immediateCapture: true,
  refunds: true,
  partialRefunds: true,
});

// Golden path: mock gateway
await runGatewayConformanceSuite({
  name: 'example',
  createGateway: () => mockGateway({ name: 'example', capabilities }),
  capabilities,
});

// Custom adapter under test:
// await runGatewayConformanceSuite({
//   name: 'example',
//   createGateway: () => new ExampleGateway(...),
//   capabilities,
// });
```

Lease-aware store adapters implement contracts exported from testkit (Phase 9)
and pass `runWebhookInboxStoreConformanceSuite` /
`runIdempotencyStoreConformanceSuite` /
`runReconciliationStoreConformanceSuite`. In-memory stores in testkit are
**NON-PRODUCTION** only. Semantics (atomicity, fencing, manifests, crash
boundaries): [`packages/testkit/docs/store-contracts.md`](../../testkit/docs/store-contracts.md).

See also [`packages/testkit/README.md`](../../testkit/README.md).

## Capabilities

Pass explicit claims into `BaseGateway` (or set `manifest.capabilities` on the
adapter). Unspecified keys default to `false` (fail-closed). Consumers inspect
support with `gateway.supports('partialRefunds')` / `gateway.capabilities`
before calling optional surfaces. Method presence alone does **not** make
`supports` return true.

```typescript
import { defineGatewayCapabilities, BaseGateway } from '@paykernel/core';

class ExampleGateway extends BaseGateway {
  readonly name = 'example' as const;

  constructor(
    apiKey: string,
    hooks: ConstructorParameters<typeof BaseGateway>[1],
    logger?: ConstructorParameters<typeof BaseGateway>[2],
  ) {
    super(
      { apiKey },
      hooks,
      logger,
      defineGatewayCapabilities({
        payments: true,
        refunds: true,
        // voids: false by default — even if you implement voidPayment later
      }),
    );
  }
  // …
}
```

Built-in comparison tables are **generated from code** — see
[gateway-capabilities.md](./gateway-capabilities.md) (`bun run docs:capabilities`).

## Amount conversion (required)

Custom adapters **must** use the shared money helpers from
`@paykernel/core` for major ↔ minor conversion. Do **not** invent
`Math.round(amount * 100)` (or any float multiply) paths.

```typescript
import {
  normalizeAmountInput,
  toMinorUnits,
  fromMinorUnits,
  minorAmountToNumber,
  moneyToMajorNumber,
  type CreatePaymentParams,
  type GatewayPaymentResult,
} from '@paykernel/core';

async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
  return this.executeWithHooks('createPayment', params, async (p) => {
    // Accepts deprecated number | Money; prefer callers pass money("10.50", "SAR")
    const m = normalizeAmountInput(p.amount, p.currency);
    const minor = toMinorUnits(m); // bigint — provider integer APIs
    const providerCents = minorAmountToNumber(minor); // only if API needs JSON number

    // … call provider with providerCents …

    // 0.x results still use major-unit number for shape stability:
    const amountMajor = moneyToMajorNumber(fromMinorUnits(minor, p.currency));
    // Prefer applyOutcomeToGatewayResult so outcome + references dual-write
    // (see operation-results.md). Do not fulfill on success alone.
    return {
      success: true,
      outcome: 'succeeded',
      gatewayId: 'ex_123',
      status: 'paid',
      amount: amountMajor,
      rawResponse: {},
    };
  });
}
```

Provider-specific exponent tables (Stripe ISK/UGX, PayPal HUF/JPY/TWD, merchant
Paymob overrides) stay **explicit** via `MoneyParseOptions.exponent` /
`exponentOverrides` — never fold them into a silent global table.

Full model, rounding modes, and 0.x migration: [Safe Money Model](./money.md).

## Operation outcomes (required for fulfillment safety)

Custom adapters should dual-write Phase 6 fields on payment results:

- `outcome`: `succeeded` | `requires_action` | `declined` | `failed` | `indeterminate`
- `references`: via `buildProviderReferences` / `applyOutcomeToGatewayResult`
- Keep deprecated `success` populated (helpers set it from `outcome`)

**Never** set `outcome: 'succeeded'` with a paid-like status unless money is
settled. Use `requires_action` for 3DS/redirect/OTP and
`indeterminate` + `reconciliationRequired: true` when the mutation may have
been accepted but the client cannot confirm. Full guide:
[Operation results](./operation-results.md).

## Rules of thumb

1. **Close over secrets** in the adapter factory — never put API keys on
   `GatewayContext` or `GatewayManifest`.
2. **Extend `BaseGateway`** when you want hooks, money-identity restoration,
   capability defaults, and shared error mapping for free.
3. **Match names**: map key === `adapter.name` === `manifest.name` ===
   `instance.name`.
4. **Claim capabilities explicitly** on the constructor / manifest — do not
   rely on duck-typing optional methods for `supports()`.
5. **Convert amounts with shared money helpers** (`normalizeAmountInput` /
   `toMinorUnits` / `fromMinorUnits`) — never float `amount * 100`. See
   [money.md](./money.md).
6. **Dual-write `outcome` + `references`** on results; fulfill only via
   `isPaidOutcome` / paid-like status — not `success` alone. See
   [operation-results.md](./operation-results.md).

## Prefer built-ins when possible

For Moyasar, PayPal, Paymob, and Stripe, use `stripeGateway` / `moyasarGateway` /
etc. (or the legacy constructor). Custom adapters are for providers this package
does not ship.
