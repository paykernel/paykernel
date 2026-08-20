// file: packages/core/src/index.ts

/**
 * @paykernel/core
 *
 * Framework-agnostic multi-gateway payment SDK with lifecycle hooks.
 * Supports Moyasar, PayPal, Paymob, and Stripe.
 *
 * @example
 * ```typescript
 * import { PaymentClient, isPaidOutcome } from '@paykernel/core';
 *
 * const client = new PaymentClient({
 *   moyasar: {
 *     secretKey: process.env.MOYASAR_SECRET_KEY!,
 *     webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
 *   },
 *   defaultGateway: 'moyasar',
 *   hooks: {
 *     beforeCreatePayment: async (ctx) => {
 *       // inspect or mutate ctx.params.amount here
 *       return { proceed: true };
 *     },
 *     afterCreatePayment: async (ctx, result) => {
 *       if (isPaidOutcome(result)) {
 *         await analytics.track('payment_paid', { status: result.status });
 *       }
 *       return { proceed: true };
 *     },
 *     onWebhookVerified: async (event) => {
 *       // Verification only — never fulfill here. After inbox claim, fulfill
 *       // when event.event is payment.succeeded|capture.completed AND
 *       // payment.status === 'paid', bound to gatewayPaymentId.
 *     },
 *   },
 * });
 *
 * // Create a payment
 * const result = await client.createPayment({
 *   amount: 100,
 *   currency: 'SAR',
 *   callbackUrl: 'https://example.com/callback',
 *   moyasarSource: {
 *     type: 'token',
 *     token: 'token_xxx',
 *   },
 *   metadata: { orderId: 'order_123' },
 * });
 * if (isPaidOutcome(result)) {
 *   // fulfill — paid settlement only (`status === 'paid'`)
 * }
 *
 * // Handle webhook (verify). Production: inbox claim, then status === 'paid'.
 * const event = await client.handleWebhook('moyasar', webhookPayload);
 * ```
 */

// Main client
export { PaymentClient } from "./client";
export type { BuiltInGatewayMap } from "./client";
export { createPaymentClient } from "./create-payment-client";
export type { InferGatewayMapFromAdapters } from "./create-payment-client";

// Types
export type {
  BuiltInGatewayName,
  GatewayId,
  GatewayName,
  PaymentStatus,
  RefundStatus,
  AmountInput,
  PaymentMetadata,
  OperationRequestOptions,
  CommonPaymentInput,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  MoyasarBackendPaymentSource,
  MoyasarPaymentSplit,
  MoyasarAftRecipient,
  MoyasarAftSender,
  MoyasarCreatePaymentParams,
  MoyasarConfirmStcPayOtpParams,
  PayPalCreatePaymentParams,
  PaymobCreatePaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  PaymentNextAction,
  MoyasarStcPayOtpNextAction,
  RedirectPaymentNextAction,
  MoyasarNextAction,
} from "./types/payment.types";

// Phase 22.1 — customers and stored payment methods
export type {
  CommonCustomerInput,
  CreateCustomerParams,
  GetCustomerParams,
  AttachPaymentMethodParams,
  ListPaymentMethodsParams,
  DetachPaymentMethodParams,
  Customer,
  CustomerStatus,
  CustomerOperationOutcome,
  CustomerOperationResult,
  StoredPaymentMethod,
  StoredPaymentMethodType,
  PaymentMethodOperationResult,
  ListPaymentMethodsResult,
} from "./types/customer.types";

// Phase 22.2 — hosted checkout
export type {
  CheckoutSessionStatus,
  CommonCheckoutSessionInput,
  GetCheckoutSessionParams,
  CheckoutSession,
  CheckoutSessionOperationOutcome,
  CheckoutSessionOperationResult,
} from "./types/checkout.types";
export {
  isHostedCheckoutRedirect,
  applyIndeterminateCheckoutSessionOutcome,
} from "./types/checkout.types";

// Phase 22.3 — disputes
export type {
  GetDisputeParams,
  ListDisputesParams,
  DisputeEvidenceInput,
  SubmitDisputeEvidenceParams,
  DisputeOperationOutcome,
  DisputeOperationResult,
  ListDisputesResult,
} from "./types/dispute.types";

// Phase 22.5 — payment links
export type {
  PaymentLinkStatus,
  CommonPaymentLinkInput,
  CreatePaymentLinkParams,
  GetPaymentLinkParams,
  DeactivatePaymentLinkParams,
  PaymentLink,
  PaymentLinkOperationOutcome,
  PaymentLinkOperationResult,
} from "./types/payment-link.types";

// Phase 22.4 — marketplace vocabulary
export type {
  MarketplaceSplit,
  Transfer,
  Payout,
} from "./types/marketplace.types";

// Phase 6 — domain statuses, provider refs, operation outcomes
export type {
  PaymentDomainStatus,
  AuthorizationStatus,
  CaptureStatus,
  RefundDomainStatus,
  SetupTokenStatus,
  DisputeStatus,
  TransferStatus,
  PayoutStatus,
} from "./types/domain-status";
export {
  isPaymentDomainStatus,
  isPaidLikePaymentStatus,
  isDisputeStatus,
  mapNativeDisputeStatus,
  PAYMENT_DOMAIN_STATUSES,
  PAID_LIKE_PAYMENT_STATUSES,
  DISPUTE_STATUSES,
} from "./types/domain-status";
export type {
  ProviderReferences,
  BuildProviderReferencesInput,
} from "./types/provider-refs";
export { buildProviderReferences } from "./types/provider-refs";
export type {
  PaymentAction,
  PaymentDecline,
  PaymentErrorLike,
  Payment,
  PaymentOperationOutcome,
  PaymentOperationResult,
  ApplyOutcomeGatewayBase,
  ApplyOutcomeGatewayRefundBase,
  RefundOperationOutcome,
  RefundOperationResult,
} from "./types/operation-result";
export {
  mapGatewayResultToOperationResult,
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  applyIndeterminatePaymentOutcome,
  applyIndeterminateRefundOutcome,
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
} from "./types/operation-result";

// Moyasar-specific source types
export type {
  MoyasarPaymentSource,
  CreditCardSource,
  CardTokenSource,
  ApplePaySource,
  ApplePayDecryptedSource,
  SamsungPaySource,
  StcPaySource,
} from "./types/moyasar-source.types";

export {
  isCreditCardSource,
  isCardTokenSource,
  isApplePaySource,
  isSamsungPaySource,
  isStcPaySource,
} from "./types/moyasar-source.types";

export type {
  WebhookEvent,
  MoyasarWebhookPayload,
  PayPalWebhookPayload,
  PaymobWebhookPayload,
  PaymobCardTokenWebhookPayload,
  PaymobRedirectWebhookPayload,
  StripeWebhookPayload,
} from "./types/webhook.types";

// Phase 7 — Typed & versioned webhook / PaymentEvent model
export type {
  PaymentEventSchemaVersion,
  StablePaymentEventType,
  UnmappedPaymentEventType,
  ProviderEventMetadata,
  PaymentFailure,
  Refund,
  Capture,
  Dispute,
  PaymentMethodSetup,
  PaymentEvent,
  PersistedPaymentEventEnvelope,
  RawWebhookPayloadCodec,
  RequestLocalWebhookContext,
  EncryptedRawPayloadRecord,
  BuildProviderEventMetadataOptions,
  WebhookEventToPaymentEventOptions,
  AttachPaymentEventOptions,
  ToPersistedEnvelopeOptions,
} from "./types/payment-event";
export {
  STABLE_PAYMENT_EVENT_TYPES,
  PAYMENT_EVENT_SCHEMA_VERSION,
  isStablePaymentEventType,
  isPaymentEvent,
  isPaymentSucceededEvent,
  isPaymentFailedEvent,
  isRefundCompletedEvent,
  isProviderUnmappedEvent,
  WEBHOOK_PAYLOAD_SECRET_KEYS,
  redactWebhookPayloadSecrets,
  stableStringifyForHash,
  hashWebhookPayload,
  encryptRawWebhookPayload,
  stripRawFromPaymentEvent,
  toPersistedPaymentEventEnvelope,
  assertNoSecretsInEnvelope,
  buildProviderEventMetadata,
  paymentFromWebhookEvent,
  webhookEventToPaymentEvent,
  attachPaymentEvent,
} from "./types/payment-event";
export type {
  MappedStableEventType,
  ProviderEventMapContext,
} from "./types/webhook-event-map";
export {
  mapProviderEventTypeToStable,
  STRIPE_EVENT_TYPE_MAP,
  STRIPE_UNMAPPED_EVENT_TYPES,
  MOYASAR_EVENT_TYPE_MAP,
  PAYPAL_EVENT_TYPE_MAP,
  PAYMOB_TOKEN_EVENT_TYPES,
} from "./types/webhook-event-map";

export type {
  PaymentClientConfig,
  CreatePaymentClientOptions,
  GatewayAdaptersMap,
  MoyasarConfig,
  PayPalConfig,
  PaymobConfig,
  PaymobIdempotencyRecord,
  PaymobIdempotencyStore,
  StripeConfig,
  GatewayConfig,
} from "./types/config.types";

export type {
  StripeCreatePaymentParams,
  CreateCheckoutSessionParams,
} from "./types/validation";

// Hooks
export type {
  PaymentHooks,
  HookContext,
  BeforeHookResult,
  AfterHookResult,
  BeforeHook,
  AfterHook,
  ErrorHook,
  OperationType,
  WebhookReceivedHook,
  WebhookVerifiedHook,
  WebhookFailedHook,
} from "./hooks/hooks.types";

export { HooksManager } from "./hooks/hooks.manager";

// Utilities (logging, idempotency, retry)
export type { Logger, LogLevel } from "./utils/logger";
export { noopLogger, redact, createRedactingLogger } from "./utils/logger";
export type {
  IdempotencyStore,
  IdempotencyRecord,
  IdempotencyStatus,
} from "./utils/idempotency";
export { InMemoryIdempotencyStore, fingerprintParams } from "./utils/idempotency";
export type { RetryConfig, WithRetryOptions } from "./utils/retry";
export {
  withRetry,
  parseRetryAfterSeconds,
  DEFAULT_RETRY_CONFIG,
} from "./utils/retry";

// Money primitives + currency exponent helpers (Phase 5)
export type {
  DecimalString,
  MinorAmount,
  Money,
  MoneyFailureKind,
  MoneyParseOptions,
  MoneyRoundingMode,
} from "./utils/money";
export type {
  CurrencyCode,
  CurrencyExponentOverrides,
  GetCurrencyExponentOptions,
} from "./utils/currency";
export {
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
} from "./utils/money";
export {
  getCurrencyExponent,
  isKnownCurrencyCode,
  normalizeCurrencyCode,
} from "./utils/currency";

// Gateways (for advanced usage / extension) — single surface via gateways barrel
export type {
  PaymentGateway,
  GatewayManifest,
  GatewayCapabilityKey,
  GatewayCapabilities,
  BuiltinGatewayCapabilityName,
  GatewayContext,
  CryptoProvider,
  TelemetrySink,
  CreateDefaultGatewayContextOptions,
  GatewayAdapter,
  GatewayMap,
  ImmutableGatewayRegistry,
  GatewayRegistryBuilder,
} from "./gateways";
export {
  BaseGateway,
  GATEWAY_CAPABILITY_KEYS,
  DEFAULT_GATEWAY_CAPABILITIES,
  defineGatewayCapabilities,
  isGatewayCapabilityKey,
  CAPABILITY_OPERATION_MAP,
  freezeCapabilities,
  STRIPE_CAPABILITIES,
  MOYASAR_CAPABILITIES,
  PAYPAL_CAPABILITIES,
  PAYMOB_CAPABILITIES,
  BUILTIN_GATEWAY_CAPABILITIES,
  BUILTIN_GATEWAY_MANIFESTS,
  BUILTIN_ADAPTER_VERSION,
  generateGatewayCapabilitiesMarkdown,
  CAPABILITY_DOCS_BANNER,
  createDefaultGatewayContext,
  createRedactingTelemetrySink,
  createGatewayRegistry,
  createDynamicGatewayRegistry,
  MoyasarGateway,
  PayPalGateway,
  PaymobGateway,
  StripeGateway,
  stripeGateway,
  moyasarGateway,
  paypalGateway,
  paymobGateway,
} from "./gateways";

// Phase 8 — portable runtime (PaymentRuntime, pure crypto helpers, abort)
// Phase 20 — OperationContext for diagnostics / telemetry
export type {
  Clock,
  PaymentRuntime,
  GatewayRuntimeDeps,
  TimeoutSignalHandle,
  PaymentOperationType,
  OperationContext,
  CreateOperationContextInput,
  FinalizeOperationContextPatch,
} from "./runtime";
export {
  createPaymentRuntime,
  mergePaymentRuntime,
  paymentRuntimeFromContext,
  systemClock,
  resolveDefaultCrypto,
  uuidV4FromGetRandomValues,
  utf8Encode,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  utf8ToBase64,
  timingSafeEqualBytes,
  timingSafeEqualHex,
  sha256,
  sha256Hex,
  sha512,
  sha512Hex,
  hmacSha256,
  hmacSha256Hex,
  hmacSha512,
  hmacSha512Hex,
  concatBytes,
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
} from "./runtime";

// Explicit local bindings so the library bundler cannot tree-shake public
// abort helpers that are only re-exported (not always referenced by builtins).
import {
  combineAbortSignals as _combineAbortSignals,
  createTimeoutSignal as _createTimeoutSignal,
  isAbortError as _isAbortError,
  mapHttpAbortError as _mapHttpAbortError,
  extractAbortSignal as _extractAbortSignal,
  stripAbortSignal as _stripAbortSignal,
  withAbortSignal as _withAbortSignal,
} from "./runtime";
export const combineAbortSignals = _combineAbortSignals;
export const createTimeoutSignal = _createTimeoutSignal;
export const isAbortError = _isAbortError;
export const mapHttpAbortError = _mapHttpAbortError;
export const extractAbortSignal = _extractAbortSignal;
export const stripAbortSignal = _stripAbortSignal;
export const withAbortSignal = _withAbortSignal;

// Errors
export {
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
} from "./errors";
export type { OperationNotSupportedErrorOptions } from "./errors";
