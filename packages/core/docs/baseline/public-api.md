# Public API Baseline

> **Phase 0 freeze artifact.** Generated from `src/index.ts` and the built `dist/` package.
> Do not hand-edit the inventory tables; regenerate with the command below.

## Generation metadata

- **Generated at (UTC)**: 2026-08-14T13:12:11.636Z
- **Command**: `bun run scripts/generate-api-baseline.ts`
- **Source of truth (exports)**: `src/index.ts`
- **Runtime module inspected**: `dist/index.js`
- **Declarations inspected**: `dist/**/*.d.ts`
- **Bundle**: `dist/index.js` — 397971 bytes, sha256 `cd7698d31f78610aff726b960cf9c5096ae3d0109d6bd0ebebb955681485d846`

## Package

- **name**: `@paykernel/core`
- **version**: `0.1.0-next.0`

## Entry points

- **main**: `./dist/index.js`
- **types**: `./dist/index.d.ts`
- **type**: `module`
- **exports**:
```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

## Runtime exports

Value exports from `src/index.ts`, classified by inspecting the built ESM module.

| Name | Kind |
| --- | --- |
| `applyOutcomeToGatewayRefundResult` | function |
| `applyOutcomeToGatewayResult` | function |
| `assertNoSecretsInEnvelope` | function |
| `attachPaymentEvent` | function |
| `AuthenticationError` | class |
| `base64ToBytes` | function |
| `BaseGateway` | class |
| `buildProviderEventMetadata` | function |
| `buildProviderReferences` | function |
| `BUILTIN_ADAPTER_VERSION` | const |
| `BUILTIN_GATEWAY_CAPABILITIES` | const |
| `BUILTIN_GATEWAY_MANIFESTS` | const |
| `bytesToBase64` | function |
| `bytesToHex` | function |
| `CAPABILITY_DOCS_BANNER` | const |
| `CAPABILITY_OPERATION_MAP` | const |
| `CardDeclinedError` | class |
| `combineAbortSignals` | function |
| `concatBytes` | function |
| `createDefaultGatewayContext` | function |
| `createDynamicGatewayRegistry` | function |
| `createGatewayRegistry` | function |
| `createOperationContext` | function |
| `createPaymentClient` | function |
| `createPaymentRuntime` | function |
| `createRedactingLogger` | function |
| `createRedactingTelemetrySink` | function |
| `createTimeoutSignal` | function |
| `DEFAULT_GATEWAY_CAPABILITIES` | const |
| `DEFAULT_RETRY_CONFIG` | const |
| `defineGatewayCapabilities` | function |
| `encryptRawWebhookPayload` | function |
| `extractAbortSignal` | function |
| `finalizeOperationContext` | function |
| `fingerprintParams` | function |
| `formatMoney` | function |
| `freezeCapabilities` | function |
| `fromMinorUnits` | function |
| `GATEWAY_CAPABILITY_KEYS` | const |
| `GatewayApiError` | class |
| `GatewayNotConfiguredError` | class |
| `generateGatewayCapabilitiesMarkdown` | function |
| `getCurrencyExponent` | function |
| `hashWebhookPayload` | function |
| `hexToBytes` | function |
| `hmacSha256` | function |
| `hmacSha256Hex` | function |
| `hmacSha512` | function |
| `hmacSha512Hex` | function |
| `HooksManager` | class |
| `inferOperationOutcome` | function |
| `inferRefundOperationOutcome` | function |
| `InMemoryIdempotencyStore` | class |
| `InsufficientFundsError` | class |
| `InvalidRequestError` | class |
| `InvalidWebhookError` | class |
| `isAbortError` | function |
| `isApplePaySource` | function |
| `isCardTokenSource` | function |
| `isCreditCardSource` | function |
| `isGatewayCapabilityKey` | function |
| `isGatewayPaymentResult` | function |
| `isIndeterminateOutcome` | function |
| `isKnownCurrencyCode` | function |
| `isMoney` | function |
| `isPaidLikePaymentStatus` | function |
| `isPaidOutcome` | function |
| `isPaymentDomainStatus` | function |
| `isPaymentEvent` | function |
| `isPaymentFailedEvent` | function |
| `isPaymentSucceededEvent` | function |
| `isProviderUnmappedEvent` | function |
| `isRefundCompletedEvent` | function |
| `isRequiresActionOutcome` | function |
| `isSamsungPaySource` | function |
| `isStablePaymentEventType` | function |
| `isStcPaySource` | function |
| `mapGatewayRefundToOperationResult` | function |
| `mapGatewayResultToOperationResult` | function |
| `mapHttpAbortError` | function |
| `mapProviderEventTypeToStable` | function |
| `mergePaymentRuntime` | function |
| `minorAmountToNumber` | function |
| `money` | function |
| `MoneyAmountError` | class |
| `moneyToMajorNumber` | function |
| `MOYASAR_CAPABILITIES` | const |
| `MOYASAR_EVENT_TYPE_MAP` | const |
| `moyasarGateway` | function |
| `MoyasarGateway` | class |
| `NetworkError` | class |
| `noopLogger` | const |
| `normalizeAmountInput` | function |
| `normalizeCurrencyCode` | function |
| `operationContextToTelemetryData` | function |
| `OperationNotSupportedError` | class |
| `PAID_LIKE_PAYMENT_STATUSES` | const |
| `parseRetryAfterSeconds` | function |
| `PAYMENT_DOMAIN_STATUSES` | const |
| `PAYMENT_EVENT_SCHEMA_VERSION` | const |
| `PaymentAbortedError` | class |
| `PaymentClient` | class |
| `PaymentError` | class |
| `paymentFromGatewayResult` | function |
| `paymentFromWebhookEvent` | function |
| `paymentNextActionToAction` | function |
| `paymentRuntimeFromContext` | function |
| `PAYMOB_CAPABILITIES` | const |
| `PAYMOB_TOKEN_EVENT_TYPES` | const |
| `paymobGateway` | function |
| `PaymobGateway` | class |
| `PAYPAL_CAPABILITIES` | const |
| `PAYPAL_EVENT_TYPE_MAP` | const |
| `paypalGateway` | function |
| `PayPalGateway` | class |
| `RateLimitError` | class |
| `redact` | function |
| `redactWebhookPayloadSecrets` | function |
| `resolveDefaultCrypto` | function |
| `ResourceNotFoundError` | class |
| `sha256` | function |
| `sha256Hex` | function |
| `sha512` | function |
| `sha512Hex` | function |
| `STABLE_PAYMENT_EVENT_TYPES` | const |
| `stableStringifyForHash` | function |
| `stripAbortSignal` | function |
| `STRIPE_CAPABILITIES` | const |
| `STRIPE_EVENT_TYPE_MAP` | const |
| `STRIPE_UNMAPPED_EVENT_TYPES` | const |
| `stripeGateway` | function |
| `StripeGateway` | class |
| `stripRawFromPaymentEvent` | function |
| `successFromOutcome` | function |
| `successFromRefundOutcome` | function |
| `systemClock` | const |
| `timingSafeEqualBytes` | function |
| `timingSafeEqualHex` | function |
| `toMinorUnits` | function |
| `toPaymentErrorLike` | function |
| `toPersistedPaymentEventEnvelope` | function |
| `utf8Encode` | function |
| `utf8ToBase64` | function |
| `uuidV4FromGetRandomValues` | function |
| `validateMoney` | function |
| `WEBHOOK_PAYLOAD_SECRET_KEYS` | const |
| `webhookEventToPaymentEvent` | function |
| `withAbortSignal` | function |
| `withRetry` | function |

**Count**: 149

## Type-only exports

Names from `export type { ... }` (and `type` members in value export lists) in `src/index.ts`.
These exist only in the TypeScript declaration surface.

| Name |
| --- |
| `AfterHook` |
| `AfterHookResult` |
| `AmountInput` |
| `ApplePayDecryptedSource` |
| `ApplePaySource` |
| `ApplyOutcomeGatewayBase` |
| `ApplyOutcomeGatewayRefundBase` |
| `AttachPaymentEventOptions` |
| `AuthorizationStatus` |
| `BeforeHook` |
| `BeforeHookResult` |
| `BuildProviderEventMetadataOptions` |
| `BuildProviderReferencesInput` |
| `BuiltinGatewayCapabilityName` |
| `BuiltInGatewayMap` |
| `BuiltInGatewayName` |
| `Capture` |
| `CaptureParams` |
| `CaptureStatus` |
| `CardTokenSource` |
| `Clock` |
| `CommonPaymentInput` |
| `CreateCheckoutSessionParams` |
| `CreateDefaultGatewayContextOptions` |
| `CreateOperationContextInput` |
| `CreatePaymentClientOptions` |
| `CreatePaymentParams` |
| `CreditCardSource` |
| `CryptoProvider` |
| `CurrencyCode` |
| `CurrencyExponentOverrides` |
| `DecimalString` |
| `Dispute` |
| `DisputeStatus` |
| `EncryptedRawPayloadRecord` |
| `ErrorHook` |
| `FinalizeOperationContextPatch` |
| `GatewayAdapter` |
| `GatewayAdaptersMap` |
| `GatewayCapabilities` |
| `GatewayCapabilityKey` |
| `GatewayConfig` |
| `GatewayContext` |
| `GatewayId` |
| `GatewayManifest` |
| `GatewayMap` |
| `GatewayName` |
| `GatewayPaymentResult` |
| `GatewayRefundResult` |
| `GatewayRegistryBuilder` |
| `GatewayRuntimeDeps` |
| `GetCurrencyExponentOptions` |
| `GetPaymentParams` |
| `HookContext` |
| `IdempotencyRecord` |
| `IdempotencyStatus` |
| `IdempotencyStore` |
| `ImmutableGatewayRegistry` |
| `InferGatewayMapFromAdapters` |
| `Logger` |
| `LogLevel` |
| `MappedStableEventType` |
| `MinorAmount` |
| `Money` |
| `MoneyFailureKind` |
| `MoneyParseOptions` |
| `MoneyRoundingMode` |
| `MoyasarAftRecipient` |
| `MoyasarAftSender` |
| `MoyasarBackendPaymentSource` |
| `MoyasarConfig` |
| `MoyasarConfirmStcPayOtpParams` |
| `MoyasarCreatePaymentParams` |
| `MoyasarNextAction` |
| `MoyasarPaymentSource` |
| `MoyasarPaymentSplit` |
| `MoyasarStcPayOtpNextAction` |
| `MoyasarWebhookPayload` |
| `OperationContext` |
| `OperationNotSupportedErrorOptions` |
| `OperationRequestOptions` |
| `OperationType` |
| `Payment` |
| `PaymentAction` |
| `PaymentClientConfig` |
| `PaymentDecline` |
| `PaymentDomainStatus` |
| `PaymentErrorLike` |
| `PaymentEvent` |
| `PaymentEventSchemaVersion` |
| `PaymentFailure` |
| `PaymentGateway` |
| `PaymentHooks` |
| `PaymentMetadata` |
| `PaymentMethodSetup` |
| `PaymentNextAction` |
| `PaymentOperationOutcome` |
| `PaymentOperationResult` |
| `PaymentOperationType` |
| `PaymentRuntime` |
| `PaymentStatus` |
| `PaymobCardTokenWebhookPayload` |
| `PaymobConfig` |
| `PaymobCreatePaymentParams` |
| `PaymobIdempotencyRecord` |
| `PaymobIdempotencyStore` |
| `PaymobRedirectWebhookPayload` |
| `PaymobWebhookPayload` |
| `PayoutStatus` |
| `PayPalConfig` |
| `PayPalCreatePaymentParams` |
| `PayPalWebhookPayload` |
| `PersistedPaymentEventEnvelope` |
| `ProviderEventMapContext` |
| `ProviderEventMetadata` |
| `ProviderReferences` |
| `RawWebhookPayloadCodec` |
| `RedirectPaymentNextAction` |
| `Refund` |
| `RefundDomainStatus` |
| `RefundOperationOutcome` |
| `RefundOperationResult` |
| `RefundParams` |
| `RefundStatus` |
| `RequestLocalWebhookContext` |
| `RetryConfig` |
| `SamsungPaySource` |
| `SetupTokenStatus` |
| `StablePaymentEventType` |
| `StcPaySource` |
| `StripeConfig` |
| `StripeCreatePaymentParams` |
| `StripeWebhookPayload` |
| `TelemetrySink` |
| `TimeoutSignalHandle` |
| `ToPersistedEnvelopeOptions` |
| `TransferStatus` |
| `UnmappedPaymentEventType` |
| `VoidParams` |
| `WebhookEvent` |
| `WebhookEventToPaymentEventOptions` |
| `WebhookFailedHook` |
| `WebhookReceivedHook` |
| `WebhookVerifiedHook` |
| `WithRetryOptions` |

**Count**: 145

## Cross-checks

- Parsed value exports present on runtime module: **yes**
- Runtime keys not listed in `src/index.ts` value exports: _none_
- Type-only names that also exist as runtime values: _none_
- Total distinct public names (runtime + type-only): **294**

## Declaration output tree (`dist/**/*.d.ts`)

Relative paths under `dist/`, sorted. Source maps (`.d.ts.map`) are omitted.

- `client.d.ts`
- `create-payment-client.d.ts`
- `errors.d.ts`
- `gateways/base.gateway.d.ts`
- `gateways/builtin-capabilities.d.ts`
- `gateways/capabilities-docs.d.ts`
- `gateways/factories.d.ts`
- `gateways/gateway-adapter.d.ts`
- `gateways/gateway-capabilities.d.ts`
- `gateways/gateway-context.d.ts`
- `gateways/gateway-manifest.d.ts`
- `gateways/gateway-registry.d.ts`
- `gateways/gateway.interface.d.ts`
- `gateways/index.d.ts`
- `gateways/moyasar/moyasar.gateway.d.ts`
- `gateways/paymob/paymob.gateway.d.ts`
- `gateways/paypal/paypal.gateway.d.ts`
- `gateways/stripe/stripe.gateway.d.ts`
- `hooks/hooks.manager.d.ts`
- `hooks/hooks.types.d.ts`
- `index.d.ts`
- `runtime/abort.d.ts`
- `runtime/clock.d.ts`
- `runtime/crypto-portable.d.ts`
- `runtime/crypto-provider.d.ts`
- `runtime/index.d.ts`
- `runtime/operation-context.d.ts`
- `runtime/payment-runtime.d.ts`
- `types/config.types.d.ts`
- `types/domain-status.d.ts`
- `types/moyasar-source.types.d.ts`
- `types/operation-result.d.ts`
- `types/payment-event.d.ts`
- `types/payment.types.d.ts`
- `types/provider-refs.d.ts`
- `types/stable-payment-event-types.d.ts`
- `types/validation.d.ts`
- `types/webhook-event-map.d.ts`
- `types/webhook.types.d.ts`
- `utils/currency.d.ts`
- `utils/idempotency.d.ts`
- `utils/logger.d.ts`
- `utils/money.d.ts`
- `utils/retry.d.ts`

**Count**: 44

## Notes

- Only symbols re-exported from `src/index.ts` are part of the supported public API.
- Internal modules under `dist/` (e.g. `dist/utils/currency.d.ts`) may appear in the declaration tree for compiler layout; they are **not** public entry points unless re-exported from `src/index.ts`.
- Package is **ESM-only** (`"type": "module"`, `exports["."].import` only).
- Kind classification uses runtime heuristics (class vs function vs const); see script source for rules.
