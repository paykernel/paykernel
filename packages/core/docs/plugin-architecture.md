# Plugin architecture (Phase 2)

This document describes the open gateway plugin model: adapters, context,
immutable registry, `createPaymentClient`, and migration from the legacy
constructor. Capability queries (`supports` / `capabilities`) are summarized
below; the full provider matrix is [generated from code](./gateway-capabilities.md).

For mock gateways, capability-gated conformance, Phase 9 lease-aware store
contracts, and fixture safety, use **`@paykernel/testkit`**
(`packages/testkit`). Core does **not** depend on testkit. Store contracts:
[`packages/store-contracts/docs/contracts.md`](../../store-contracts/docs/contracts.md).
See [Custom gateways](./custom-gateways.md) and
[`packages/testkit/README.md`](../../testkit/README.md).

## Goals

- Third-party gateways participate in payments, webhooks, hooks, logging, and
  normalized errors **without editing core**.
- Gateway names are **inferred** from the registered adapters (`TMap`).
- Built-in configuration remains usable during 0.x via a **deprecated** path.
- No mid-flight `register` / `unregister` on a live client.

## Building blocks

### `GatewayAdapter`

```ts
interface GatewayAdapter<TName extends string, TGateway extends PaymentGateway<TName>> {
  readonly name: TName;
  readonly manifest: GatewayManifest; // no secrets
  create(context: GatewayContext): TGateway;
}
```

Factories (e.g. `stripeGateway({ secretKey })`) close over credentials and
return an adapter. First-party factories: `stripeGateway`, `moyasarGateway`,
`paypalGateway`, `paymobGateway`.

### `GatewayContext`

Shared, **secret-free** dependencies injected at `create` time. Extends
[`PaymentRuntime`](./runtime.md) (`fetch`, `crypto`, `clock`, `randomUUID`) plus
client-owned fields:

| Field | Role |
| --- | --- |
| `hooks` | Shared `HooksManager` |
| `logger` | Prefer redacting logger |
| `fetch` | Portable fetch (`PaymentRuntime`) |
| `clock` | `now()` / `nowMs()` (`Clock`) |
| `crypto` | Portable Web Crypto surface |
| `randomUUID` | UUID generator (`PaymentRuntime`) |
| `uuid` | Convenience alias of `randomUUID` (0.x) |
| `telemetry?` | Optional sink (no PII/secrets) |

Never put API keys, webhook secrets, DB handles, or request objects on the
context. Use `createDefaultGatewayContext()` in tests or let
`createPaymentClient({ runtime?: Partial<PaymentRuntime> })` build context for you.

**Runtime injection path (Phase 8):**

1. Caller passes `runtime?: Partial<PaymentRuntime>` on `createPaymentClient` options
   (or legacy constructor defaults).
2. Client builds `GatewayContext` via `createDefaultGatewayContext({ runtime, hooks, logger })`.
3. Registry `createAll(context)` / adapter `create(context)` receive the full context.
4. Built-in factories project `fetch` / `crypto` / `clock` / `randomUUID` into
   gateway constructors; gateways call **`this.fetch`** (injected), not bare global
   `fetch`, for provider HTTP.

See [runtime.md](./runtime.md) for portable crypto helpers, clocks, AbortSignal /
timeout notes, and the CI runtime matrix.

### `GatewayManifest`

Frozen descriptive metadata (`name`, optional `displayName` / `version` /
`apiVersion` / `capabilities` / `metadata`). Safe to log. No credentials.

### Capabilities (Phase 3)

Adapters advertise a complete boolean map (`GatewayCapabilities`) on the
manifest and on each gateway instance. Query support before invoking optional
surfaces:

```ts
const gateway = client.gateway('stripe');
if (gateway.supports('partialRefunds')) {
  // partial amount is a claimed path on this adapter
}
// Full snapshot (every key true|false, frozen):
gateway.capabilities;
```

- Keys are stable strings in `GATEWAY_CAPABILITY_KEYS` (e.g. `payments`,
  `partialCapture`, `hostedCheckout`, `customers`, `disputes`, `paymentLinks`,
  `providerRecurring`). Higher-level surfaces (Phase 22) are optional methods
  gated by those keys — see [customers.md](./customers.md),
  [hosted-checkout.md](./hosted-checkout.md), [disputes.md](./disputes.md),
  [marketplace.md](./marketplace.md), [payment-links.md](./payment-links.md).
- Claims are **explicit and fail-closed**: omitted keys default to `false`.
  The SDK does **not** infer `true` from optional method presence alone.
- Built-in factories set conservative claims (shared constants in
  `builtin-capabilities`). Comparison tables are generated — see
  [gateway-capabilities.md](./gateway-capabilities.md) and
  `bun run docs:capabilities`.

### Immutable registry

```ts
const registry = createGatewayRegistry()
  .register(stripeGateway({ secretKey: '…' }))
  .register(customAdapter)
  .build();

registry.names();       // frozen list
registry.manifests();   // frozen copies
registry.createAll(ctx); // materialize once at client construction
// no registry.register after build
```

| Builder API | Behavior |
| --- | --- |
| `register(adapter)` | Fails if name already present |
| `replace(adapter)` | Overwrite or insert |
| `registerDynamic(adapter)` | Same runtime as register; erases static map precision |
| `build()` | Freezes adapters map, names, manifests |

`createDynamicGatewayRegistry()` starts a string-keyed builder when names are
only known at runtime (explicit loss of static inference).

## Creating a client

### Adapters map (sugar)

```ts
const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({ secretKey: env.STRIPE_SECRET_KEY }),
    custom: customGateway({ apiKey: env.CUSTOM_API_KEY }),
  },
  defaultGateway: 'stripe',
  hooks: { /* … */ },
  logger: myLogger,
});

client.gateway('stripe'); // StripeGateway
client.gateway('custom'); // CustomGateway
// client.gateway('nope'); // compile-time error
```

### Registry form

```ts
const registry = createGatewayRegistry()
  .register(stripeGateway({ secretKey: env.STRIPE_SECRET_KEY }))
  .register(customGateway({ apiKey: env.CUSTOM_API_KEY }))
  .build();

const client = createPaymentClient({
  registry,
  defaultGateway: 'stripe',
});
```

### Fail-closed construction

| Invalid input | Result |
| --- | --- |
| Both `registry` and `gateways` | `InvalidRequestError` |
| Neither `registry` nor `gateways` | `InvalidRequestError` |
| `defaultGateway` not registered | `InvalidRequestError` |
| Map key ≠ `adapter.name` | `InvalidRequestError` |

There is **no** live `unregisterGateway`. To change gateways, construct a new
client (new registry / map). Concurrent `createPayment` calls share the stable
instance map created at construction.

## Type model

| Symbol | Closed / open | Used for |
| --- | --- | --- |
| `BuiltInGatewayName` | Closed four names | First-party only |
| `GatewayName` | Alias of built-in (0.x) | Legacy `PaymentClientConfig` |
| `GatewayId` | Open `string` | Hooks, webhooks, interface names |
| `PaymentClient<TMap>` | Inferred from registry/map | Plugin-typed ops |
| `InferGatewayMapFromAdapters<…>` | Utility | Map adapter record → instance map |

Legacy `new PaymentClient({ moyasar, … })` defaults to
`PaymentClient<BuiltInGatewayMap>`. Plugin clients use a narrower `TMap` so
unknown names fail typecheck on `gateway` / `createPayment` / `handleWebhook`.

Prefer registry-typed names so unregistered gateways fail at compile time.
Dynamic / string-keyed registration uses `createDynamicGatewayRegistry()` with
explicit loss of static precision.

## Legacy migration

```ts
// Before (still works; deprecated)
const client = new PaymentClient({
  stripe: { secretKey: '…' },
  moyasar: { secretKey: '…' },
  defaultGateway: 'moyasar',
});

// After (preferred)
const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({ secretKey: '…' }),
    moyasar: moyasarGateway({ secretKey: '…' }),
  },
  defaultGateway: 'moyasar',
});
```

| Legacy | Plugin |
| --- | --- |
| Provider keys on config | Adapter factories / registry |
| Closed `GatewayName` only | Custom names via `TMap` |
| Built-ins only | Built-ins + third-party |
| Constructor `@deprecated` | `createPaymentClient` |

Hooks, redacting logger, error hierarchy, and webhook staging are shared.

## Security notes

1. Adapters own secrets by closure — not context, not manifest.
2. Client loggers are wrapped with `createRedactingLogger`.
3. Webhook `onWebhookReceived` sees **unverified** payloads (logging/metrics only).
4. Do not convert uncertain payment outcomes to hard failures in after-hooks
   (money-identity fields are restored from the gateway result).

## What this architecture doc does **not** cover

- Extracting each gateway into its own publishable package
- New first-party providers (Adyen, etc.)
- Live hot-swap / unregister of gateways on an active client
- Phase 5 money model / Phase 6 typed outcome unions (separate roadmap items)

Conformance, mock gateway, Phase 9 lease-aware store contracts (defined in
testkit; not core 0.x `IdempotencyStore`), and fixture safety live in
**`@paykernel/testkit`** — not in core. See
[`store-contracts.md`](../../store-contracts/docs/contracts.md),
[`packages/testkit/README.md`](../../testkit/README.md), and
[Custom gateways → Conformance suite](./custom-gateways.md#conformance-suite-testkit).

## See also

- [Gateway capabilities matrix](./gateway-capabilities.md) — **generated** provider comparison
- [Custom gateways](./custom-gateways.md) — implement an adapter end-to-end; run `runGatewayConformanceSuite`
- [`@paykernel/testkit`](../../testkit/README.md) — mock gateway, conformance, fixture safety, NON-PRODUCTION memory stores
- [Hooks](./hooks.md)
- [Logging](./logging.md)
- [Webhooks](./webhooks.md)
