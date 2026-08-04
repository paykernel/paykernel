# Entry Points & Consumer Imports

Phase 0 baseline of how consumers resolve and import `@paykernel/core`.

Source of truth for **export names**: [`src/index.ts`](../../src/index.ts).  
Source of truth for **resolution fields**: [`package.json`](../../package.json).

## Module format

| Field | Value |
| --- | --- |
| `name` | `@paykernel/core` |
| `version` (at freeze) | `0.8.0` |
| `type` | `module` (ESM-only) |
| `main` | `./dist/index.js` |
| `types` | `./dist/index.d.ts` |
| `engines.node` | `>=18` |
| `engines.bun` | `>=1.0.0` |

### `exports` map

```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

Implications:

- Only the package root subpath `"."` is public.
- There is **no** `require` / CommonJS condition. `require('@paykernel/core')` is unsupported.
- Deep imports such as `@paykernel/core/dist/client` are **not** part of the supported public API (even if files exist on disk after install).
- Types resolve via `exports["."].types` → `dist/index.d.ts`.

## Consumer import examples

### Preferred orchestration (plugin / registry)

Use `createPaymentClient` with built-in factories or a typed registry. Gateway names are inferred from the registry; third-party adapters work without editing core.

```typescript
import {
  createPaymentClient,
  createGatewayRegistry,
  moyasarGateway,
  stripeGateway,
} from "@paykernel/core";

// Gateways map (sugar for register-all + build)
const payments = createPaymentClient({
  gateways: {
    moyasar: moyasarGateway({
      secretKey: process.env.MOYASAR_SECRET_KEY!,
      webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
    }),
    stripe: stripeGateway({ secretKey: process.env.STRIPE_SECRET_KEY! }),
  },
  defaultGateway: "moyasar",
});

payments.gateway("stripe"); // StripeGateway
payments.hasGateway("moyasar");
payments.configuredGateways();

// Equivalent registry form
const registry = createGatewayRegistry()
  .register(
    moyasarGateway({ secretKey: process.env.MOYASAR_SECRET_KEY! }),
  )
  .register(stripeGateway({ secretKey: process.env.STRIPE_SECRET_KEY! }))
  .build();
const client = createPaymentClient({ registry, defaultGateway: "moyasar" });
```

See [plugin-architecture.md](../plugin-architecture.md) and [custom-gateways.md](../custom-gateways.md) for custom `GatewayAdapter`s.

### Legacy constructor (deprecated, still supported in 0.x)

```typescript
import { PaymentClient } from "@paykernel/core";

/** @deprecated Prefer createPaymentClient + factories/registry */
const client = new PaymentClient({
  moyasar: {
    secretKey: process.env.MOYASAR_SECRET_KEY!,
    webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
  },
  defaultGateway: "moyasar",
});
```

### Named runtime imports (values)

```typescript
import {
  // Preferred client factory + registry
  createPaymentClient,
  createGatewayRegistry,
  createDynamicGatewayRegistry,
  createDefaultGatewayContext,
  // Built-in adapter factories
  moyasarGateway,
  stripeGateway,
  paypalGateway,
  paymobGateway,
  // Client & hooks
  PaymentClient,
  HooksManager,
  // Gateways (advanced / extension)
  BaseGateway,
  MoyasarGateway,
  PayPalGateway,
  PaymobGateway,
  StripeGateway,
  // Errors
  PaymentError,
  PaymentAbortedError,
  GatewayNotConfiguredError,
  OperationNotSupportedError,
  InvalidWebhookError,
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  AuthenticationError,
  RateLimitError,
  ResourceNotFoundError,
  InvalidRequestError,
  NetworkError,
  // Utilities
  noopLogger,
  redact,
  createRedactingLogger,
  InMemoryIdempotencyStore,
  fingerprintParams,
  withRetry,
  parseRetryAfterSeconds,
  DEFAULT_RETRY_CONFIG,
  // Money primitives (Phase 5) + currency exponents
  money,
  isMoney,
  toMinorUnits,
  fromMinorUnits,
  formatMoney,
  minorAmountToNumber,
  moneyToMajorNumber,
  normalizeAmountInput,
  validateMoney,
  MoneyAmountError,
  getCurrencyExponent,
  normalizeCurrencyCode,
  // Phase 6 operation outcomes + domain helpers
  mapGatewayResultToOperationResult,
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  successFromOutcome,
  isPaidOutcome,
  isRequiresActionOutcome,
  isIndeterminateOutcome,
  isGatewayPaymentResult,
  inferOperationOutcome,
  paymentFromGatewayResult,
  paymentNextActionToAction,
  toPaymentErrorLike,
  successFromRefundOutcome,
  inferRefundOperationOutcome,
  mapGatewayRefundToOperationResult,
  buildProviderReferences,
  isPaymentDomainStatus,
  isPaidLikePaymentStatus,
  PAYMENT_DOMAIN_STATUSES,
  PAID_LIKE_PAYMENT_STATUSES,
  // Phase 7 typed webhook / PaymentEvent model
  STABLE_PAYMENT_EVENT_TYPES,
  PAYMENT_EVENT_SCHEMA_VERSION,
  isStablePaymentEventType,
  isPaymentEvent,
  isPaymentSucceededEvent,
  isPaymentFailedEvent,
  isRefundCompletedEvent,
  isProviderUnmappedEvent,
  mapProviderEventTypeToStable,
  webhookEventToPaymentEvent,
  attachPaymentEvent,
  toPersistedPaymentEventEnvelope,
  hashWebhookPayload,
  // Moyasar source type guards
  isCreditCardSource,
  isCardTokenSource,
  isApplePaySource,
  isSamsungPaySource,
  isStcPaySource,
} from "@paykernel/core";
```

### Type-only imports

```typescript
import type {
  // Plugin architecture
  GatewayAdapter,
  GatewayManifest,
  GatewayContext,
  ImmutableGatewayRegistry,
  GatewayRegistryBuilder,
  BuiltInGatewayName,
  GatewayId,
  CreatePaymentClientOptions,
  InferGatewayMapFromAdapters,
  // Payment / gateway types
  GatewayName,
  PaymentStatus,
  RefundStatus,
  AmountInput,
  CommonPaymentInput,
  PaymentMetadata,
  PaymentOperationResult,
  PaymentOperationOutcome,
  Payment,
  PaymentAction,
  PaymentDecline,
  PaymentErrorLike,
  ProviderReferences,
  PaymentDomainStatus,
  AuthorizationStatus,
  CaptureStatus,
  RefundDomainStatus,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  PaymentNextAction,
  // Phase 7
  PaymentEvent,
  ProviderEventMetadata,
  PersistedPaymentEventEnvelope,
  StablePaymentEventType,
  PaymentFailure,
  // Money
  Money,
  DecimalString,
  MinorAmount,
  MoneyParseOptions,
  MoneyRoundingMode,
  CurrencyExponentOverrides,
  // Config
  PaymentClientConfig,
  MoyasarConfig,
  PayPalConfig,
  PaymobConfig,
  StripeConfig,
  GatewayConfig,
  // Hooks
  PaymentHooks,
  HookContext,
  OperationType,
  // Gateway interface
  PaymentGateway,
  // Logging / idempotency / retry
  Logger,
  LogLevel,
  IdempotencyStore,
  IdempotencyRecord,
  IdempotencyStatus,
  RetryConfig,
  WithRetryOptions,
} from "@paykernel/core";
```

### Bun

```typescript
// package.json: { "type": "module" }
import { PaymentClient } from "@paykernel/core";
```

### Node (ESM)

```typescript
// Node ≥ 18, ESM package or .mjs
import { PaymentClient } from "@paykernel/core";
```

## Unsupported patterns

```typescript
// ❌ CommonJS require (no CJS build / exports.require)
const { PaymentClient } = require("@paykernel/core");

// ❌ Deep import of internal modules (not on exports map)
import { PaymentClient } from "@paykernel/core/dist/client.js";

// ❌ Importing symbols that are not re-exported from src/index.ts
// (e.g. internal helpers such as currency exponent tables)
```

## Related artifacts

- Full export inventory (generated): [`public-api.md`](./public-api.md)
- Pack contents + bundle hash (generated): [`package-contents.md`](./package-contents.md)
- Regeneration instructions: [`README.md`](./README.md)
