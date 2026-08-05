/**
 * Phase 0 public API — type-level usage regression tests.
 *
 * These checks fail `tsc` (see `tsconfig.type-tests.json`) if public types
 * regress. Bun executes the file as a test suite via a trivial runtime assertion;
 * type errors are not enforced by `bun test` alone.
 *
 * Patterns use assignability helpers and `// @ts-expect-error` for negative cases.
 * Does not weaken production types or add public exports.
 */
import { describe, it, expect } from "bun:test";
import type {
  PaymentClient,
  BuiltInGatewayName,
  BuiltInGatewayMap,
  GatewayId,
  GatewayName,
  PaymentStatus,
  AmountInput,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  CreateCheckoutSessionParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  WebhookEvent,
  PaymentHooks,
  HookContext,
  BeforeHookResult,
  AfterHookResult,
  PaymentClientConfig,
  CreatePaymentClientOptions,
  MoyasarConfig,
  PayPalConfig,
  PaymobConfig,
  StripeConfig,
  PaymentGateway,
  GatewayAdapter,
  GatewayManifest,
  GatewayCapabilities,
  GatewayCapabilityKey,
  GatewayContext,
  ImmutableGatewayRegistry,
  InferGatewayMapFromAdapters,
  PaymentRuntime,
  GatewayRuntimeDeps,
  Clock,
  CryptoProvider,
  Logger,
  IdempotencyStore,
  StripeGateway,
  MoyasarGateway,
  PayPalGateway,
  PaymobGateway,
  OperationNotSupportedErrorOptions,
  Money,
  DecimalString,
  MinorAmount,
  MoneyFailureKind,
  MoneyParseOptions,
  MoneyRoundingMode,
  CurrencyExponentOverrides,
  CurrencyCode,
  CommonPaymentInput,
  PaymentMetadata,
  PaymentDomainStatus,
  PaymentOperationResult,
  PaymentOperationOutcome,
  Payment,
  PaymentAction,
  PaymentDecline,
  PaymentErrorLike,
  ProviderReferences,
  AuthorizationStatus,
  CaptureStatus,
  RefundDomainStatus,
  SetupTokenStatus,
  DisputeStatus,
  TransferStatus,
  PayoutStatus,
  RefundOperationResult,
  RefundOperationOutcome,
  ApplyOutcomeGatewayBase,
  // Phase 7
  PaymentEvent,
  PaymentEventSchemaVersion,
  StablePaymentEventType,
  ProviderEventMetadata,
  PersistedPaymentEventEnvelope,
  RawWebhookPayloadCodec,
  PaymentFailure,
  Refund,
  Capture,
  Dispute,
  PaymentMethodSetup,
  EncryptedRawPayloadRecord,
  RequestLocalWebhookContext,
} from "./index";
import {
  createGatewayRegistry,
  createDefaultGatewayContext,
  createPaymentRuntime,
  createPaymentClient,
  sha256Hex,
  hmacSha256Hex,
  timingSafeEqualBytes,
  stripeGateway,
  moyasarGateway,
  paypalGateway,
  paymobGateway,
  generateGatewayCapabilitiesMarkdown,
  CAPABILITY_DOCS_BANNER,
  BUILTIN_GATEWAY_MANIFESTS,
  GATEWAY_CAPABILITY_KEYS,
  isGatewayCapabilityKey,
  money,
  toMinorUnits,
  fromMinorUnits,
  getCurrencyExponent,
  normalizeCurrencyCode,
  normalizeAmountInput,
  mapGatewayResultToOperationResult,
  mapGatewayRefundToOperationResult,
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  isPaidOutcome,
  isRequiresActionOutcome,
  isIndeterminateOutcome,
  buildProviderReferences,
  isPaymentDomainStatus,
  successFromRefundOutcome,
  inferRefundOperationOutcome,
  STABLE_PAYMENT_EVENT_TYPES,
  PAYMENT_EVENT_SCHEMA_VERSION,
  isStablePaymentEventType,
  webhookEventToPaymentEvent,
  toPersistedPaymentEventEnvelope,
  hashWebhookPayload,
  mapProviderEventTypeToStable,
} from "./index";

/** Compile-time assignability assertion (erased at runtime). */
function expectType<T>(_value: T): void {}

/** Assert two types are mutually assignable. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

function expectTypesEqual<A, B>(_ok: Equal<A, B> extends true ? true : never): void {}

// ─── GatewayName / BuiltInGatewayName (closed 0.x legacy alias) ──────────────

const validGateways = ["moyasar", "paypal", "paymob", "stripe"] as const;
expectTypesEqual<(typeof validGateways)[number], GatewayName>(true);
expectTypesEqual<GatewayName, BuiltInGatewayName>(true);
expectTypesEqual<BuiltInGatewayName, "moyasar" | "paypal" | "paymob" | "stripe">(
  true,
);

// Legacy closed surface: GatewayName rejects non-built-ins (plugin APIs use GatewayId / registry generics)
// @ts-expect-error — "adyen" is not a GatewayName (closed built-in alias)
const _invalidGateway: GatewayName = "adyen";

// @ts-expect-error — empty string is not a GatewayName
const _emptyGateway: GatewayName = "";

// Built-in names assign to open GatewayId; open ids stay open strings
const _builtInAsId: GatewayId = "stripe";
const _customAsId: GatewayId = "adyen";
const _emptyAsId: GatewayId = "";

// BuiltInGatewayMap keys match BuiltInGatewayName
type BuiltInMapKeys = keyof BuiltInGatewayMap;
expectTypesEqual<BuiltInMapKeys, BuiltInGatewayName>(true);

// ─── CreatePaymentParams & related param shapes ──────────────────────────────

const createParams: CreatePaymentParams = {
  amount: 10.5,
  currency: "SAR",
  callbackUrl: "https://example.com/callback",
  description: "type-test payment",
  metadata: { orderId: "ord_1" },
  capture: true,
  idempotencyKey: "idem_type_test",
};
expectType<CreatePaymentParams>(createParams);

// Phase 8 Stream C — optional AbortSignal on operation params
const createParamsWithSignal: CreatePaymentParams = {
  amount: 10.5,
  currency: "SAR",
  callbackUrl: "https://example.com/callback",
  signal: new AbortController().signal,
};
expectType<CreatePaymentParams>(createParamsWithSignal);

const captureWithSignal: CaptureParams = {
  gatewayPaymentId: "pay_xxx",
  signal: new AbortController().signal,
};
expectType<CaptureParams>(captureWithSignal);

const getWithSignal: GetPaymentParams = {
  gatewayPaymentId: "pay_xxx",
  signal: new AbortController().signal,
};
expectType<GetPaymentParams>(getWithSignal);

// Phase 5: AmountInput accepts deprecated number and Money
const moneyAmount: Money = money("10.50", "SAR");
const amountAsNumber: AmountInput = 10.5;
const amountAsMoney: AmountInput = moneyAmount;
expectType<AmountInput>(amountAsNumber);
expectType<AmountInput>(amountAsMoney);

const createParamsMoney: CreatePaymentParams = {
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://example.com/callback",
};
expectType<CreatePaymentParams>(createParamsMoney);

const captureParams: CaptureParams = {
  gatewayPaymentId: "pay_xxx",
  amount: 5,
  currency: "SAR",
};
expectType<CaptureParams>(captureParams);

const captureParamsMoney: CaptureParams = {
  gatewayPaymentId: "pay_xxx",
  amount: money("5.00", "SAR"),
  currency: "SAR",
};
expectType<CaptureParams>(captureParamsMoney);

const refundParams: RefundParams = {
  gatewayPaymentId: "pay_xxx",
  amount: 1,
  reason: "customer request",
};
expectType<RefundParams>(refundParams);

const refundParamsMoney: RefundParams = {
  gatewayPaymentId: "pay_xxx",
  amount: money("1.00", "SAR"),
};
expectType<RefundParams>(refundParamsMoney);

// Stripe Checkout dual-accept: simple amount + line-item priceData.amount
const checkoutSimpleMoney: CreateCheckoutSessionParams = {
  amount: money("100.00", "USD"),
  currency: "USD",
  successUrl: "https://example.com/success",
};
expectType<CreateCheckoutSessionParams>(checkoutSimpleMoney);

const checkoutLineItemMoney: CreateCheckoutSessionParams = {
  successUrl: "https://example.com/success",
  lineItems: [
    {
      priceData: {
        currency: "USD",
        productData: { name: "Plan" },
        amount: money("20.00", "USD"),
      },
      quantity: 1,
    },
  ],
};
expectType<CreateCheckoutSessionParams>(checkoutLineItemMoney);

// Money primitive types are exported
const _decimal: DecimalString = "10.50";
const _minor: MinorAmount = 1050n;
const _rounding: MoneyRoundingMode = "reject";
const _parseOpts: MoneyParseOptions = { rounding: "half_up", allowZero: true };
const _overrides: CurrencyExponentOverrides = { OMR: 2 };
const _code: CurrencyCode = "SAR";
expectType<DecimalString>(_decimal);
expectType<MinorAmount>(_minor);
expectType<MoneyRoundingMode>(_rounding);
expectType<MoneyParseOptions>(_parseOpts);
expectType<CurrencyExponentOverrides>(_overrides);
expectType<CurrencyCode>(_code);

// Runtime helpers assignable
expectType<MinorAmount>(toMinorUnits(moneyAmount));
expectType<Money>(fromMinorUnits(1050n, "SAR"));
expectType<number>(getCurrencyExponent("JPY"));
expectType<string>(normalizeCurrencyCode("sar"));
expectType<Money>(normalizeAmountInput(10.5, "SAR"));
expectType<Money>(normalizeAmountInput(moneyAmount, "SAR"));

const voidParams: VoidParams = {
  gatewayPaymentId: "pay_xxx",
};
expectType<VoidParams>(voidParams);

const getParams: GetPaymentParams = {
  gatewayPaymentId: "pay_xxx",
};
expectType<GetPaymentParams>(getParams);

// @ts-expect-error — amount is required on CreatePaymentParams
const _missingAmount: CreatePaymentParams = {
  currency: "SAR",
  callbackUrl: "https://example.com/cb",
};

// @ts-expect-error — callbackUrl is required on base CreatePaymentParams
const _missingCallback: CreatePaymentParams = {
  amount: 1,
  currency: "USD",
};

// ─── GatewayPaymentResult required fields ────────────────────────────────────

const paymentResult: GatewayPaymentResult = {
  success: true,
  gatewayId: "pay_abc",
  status: "paid",
  redirectUrl: undefined,
  rawResponse: {},
};
expectType<GatewayPaymentResult>(paymentResult);

// Phase 6 dual-write fields optional on GatewayPaymentResult
const paymentResultWithOutcome: GatewayPaymentResult = {
  success: true,
  outcome: "succeeded",
  gatewayId: "pay_abc",
  status: "paid",
  redirectUrl: undefined,
  rawResponse: {},
  references: buildProviderReferences({
    gateway: "stripe",
    gatewayId: "pay_abc",
    status: "paid",
  }),
};
expectType<GatewayPaymentResult>(paymentResultWithOutcome);

// Identity fields used across gateways must remain present
type PaymentResultKeys = keyof GatewayPaymentResult;
expectType<PaymentResultKeys>("success");
expectType<PaymentResultKeys>("outcome");
expectType<PaymentResultKeys>("gatewayId");
expectType<PaymentResultKeys>("status");
expectType<PaymentResultKeys>("redirectUrl");
expectType<PaymentResultKeys>("rawResponse");
expectType<PaymentResultKeys>("amount");
expectType<PaymentResultKeys>("fee");
expectType<PaymentResultKeys>("capturedAmount");
expectType<PaymentResultKeys>("refundedAmount");
expectType<PaymentResultKeys>("clientSecret");
expectType<PaymentResultKeys>("nextAction");
expectType<PaymentResultKeys>("captureId");
expectType<PaymentResultKeys>("authorizationId");
expectType<PaymentResultKeys>("orderId");
expectType<PaymentResultKeys>("references");
expectType<PaymentResultKeys>("decline");
expectType<PaymentResultKeys>("reconciliationRequired");
expectType<PaymentResultKeys>("providerRequestId");

// @ts-expect-error — success is required (0.x dual-write)
const _missingSuccess: GatewayPaymentResult = {
  gatewayId: "x",
  status: "paid",
  redirectUrl: undefined,
  rawResponse: null,
};

// @ts-expect-error — gatewayId is required (not optional)
const _missingGatewayId: GatewayPaymentResult = {
  success: true,
  status: "paid",
  redirectUrl: undefined,
  rawResponse: null,
};

const _badStatus: GatewayPaymentResult = {
  success: true,
  gatewayId: "x",
  // @ts-expect-error — unknown status string is not PaymentStatus
  status: "totally_invalid_status",
  redirectUrl: undefined,
  rawResponse: null,
};

const refundResult: GatewayRefundResult = {
  success: true,
  gatewayRefundId: "ref_1",
  status: "completed",
  rawResponse: {},
};
expectType<GatewayRefundResult>(refundResult);

// ─── WebhookEvent required fields ────────────────────────────────────────────

const webhookEvent: WebhookEvent = {
  id: "evt_1",
  type: "payment_paid",
  gateway: "moyasar",
  paymentId: "order_1",
  gatewayPaymentId: "pay_1",
  status: "paid",
  timestamp: new Date(),
  rawPayload: {},
};
expectType<WebhookEvent>(webhookEvent);

type WebhookKeys = keyof WebhookEvent;
expectType<WebhookKeys>("id");
expectType<WebhookKeys>("type");
expectType<WebhookKeys>("gateway");
expectType<WebhookKeys>("paymentId");
expectType<WebhookKeys>("gatewayPaymentId");
expectType<WebhookKeys>("status");
expectType<WebhookKeys>("timestamp");
expectType<WebhookKeys>("rawPayload");

// @ts-expect-error — id is required
const _missingWebhookId: WebhookEvent = {
  type: "payment_paid",
  gateway: "stripe",
  paymentId: undefined,
  gatewayPaymentId: "pi_1",
  status: "paid",
  timestamp: new Date(),
  rawPayload: {},
};

// Open contract: WebhookEvent.gateway accepts custom GatewayId strings
const customWebhookGateway: WebhookEvent = {
  id: "evt",
  type: "x",
  gateway: "square",
  paymentId: undefined,
  gatewayPaymentId: "x",
  status: "paid",
  timestamp: new Date(),
  rawPayload: {},
};
expectType<WebhookEvent>(customWebhookGateway);

// Phase 7 additive dual-write fields on WebhookEvent remain optional
type WebhookPhase7Keys = keyof WebhookEvent;
expectType<WebhookPhase7Keys>("schemaVersion");
expectType<WebhookPhase7Keys>("event");
expectType<WebhookPhase7Keys>("provider");
expectType<WebhookPhase7Keys>("stableType");
expectType<WebhookPhase7Keys>("payloadHash");
// rawPayload still required for 0.x
expectType<WebhookEvent["rawPayload"]>({});

// ─── Phase 7 PaymentEvent discrimination ─────────────────────────────────────

expectTypesEqual<PaymentEventSchemaVersion, "1">(true);
expectType<typeof PAYMENT_EVENT_SCHEMA_VERSION>("1");

type StableFromConst = (typeof STABLE_PAYMENT_EVENT_TYPES)[number];
expectTypesEqual<StableFromConst, StablePaymentEventType>(true);

const providerMeta: ProviderEventMetadata = {
  gateway: "stripe",
  eventId: "evt_1",
  eventType: "payment_intent.succeeded",
  occurredAt: "2024-01-01T00:00:00.000Z",
  receivedAt: "2024-01-01T00:00:01.000Z",
};
expectType<ProviderEventMetadata>(providerMeta);

const paymentSnapForEvent: Payment = {
  status: "paid",
  references: buildProviderReferences({
    gateway: "stripe",
    gatewayId: "pi_1",
    status: "paid",
  }),
};

const succeededEvent: PaymentEvent = {
  schemaVersion: "1",
  type: "payment.succeeded",
  payment: paymentSnapForEvent,
  provider: providerMeta,
};
expectType<PaymentEvent>(succeededEvent);

const failedEvent: PaymentEvent = {
  schemaVersion: "1",
  type: "payment.failed",
  payment: paymentSnapForEvent,
  failure: { code: "card_declined", message: "declined" } satisfies PaymentFailure,
  provider: providerMeta,
};
expectType<PaymentEvent>(failedEvent);

// payment.succeeded is not assignable where payment.failed is required
type FailedArm = Extract<PaymentEvent, { type: "payment.failed" }>;
// @ts-expect-error — payment.succeeded arm missing failure
const _wrongArm: FailedArm = succeededEvent;
void _wrongArm;

// refund arm requires refund entity
const refundEntity: Refund = {
  status: "completed",
  references: buildProviderReferences({
    gateway: "stripe",
    gatewayId: "re_1",
    status: "refunded",
  }),
};
const refundEvent: PaymentEvent = {
  schemaVersion: "1",
  type: "refund.completed",
  refund: refundEntity,
  provider: providerMeta,
};
expectType<PaymentEvent>(refundEvent);

// capture / dispute / setup arms
const captureEntity: Capture = {
  status: "completed",
  references: buildProviderReferences({
    gateway: "paypal",
    gatewayId: "cap_1",
    status: "paid",
  }),
};
expectType<PaymentEvent>({
  schemaVersion: "1",
  type: "capture.completed",
  capture: captureEntity,
  provider: providerMeta,
});

const disputeEntity: Dispute = {
  status: "needs_response",
  references: buildProviderReferences({
    gateway: "stripe",
    gatewayId: "dp_1",
    status: "pending",
  }),
};
expectType<PaymentEvent>({
  schemaVersion: "1",
  type: "dispute.opened",
  dispute: disputeEntity,
  provider: providerMeta,
});

const setupEntity: PaymentMethodSetup = {
  status: "succeeded",
  references: buildProviderReferences({
    gateway: "paymob",
    gatewayId: "tok_1",
    status: "setup_completed",
  }),
};
expectType<PaymentEvent>({
  schemaVersion: "1",
  type: "payment_method.setup_completed",
  setup: setupEntity,
  provider: providerMeta,
});

// provider.unmapped arm
expectType<PaymentEvent>({
  schemaVersion: "1",
  type: "provider.unmapped",
  provider: { ...providerMeta, eventType: "invoice.paid" },
  note: "ambiguous",
});

// Exhaustive switch on PaymentEvent.type (compile-time)
function _assertPaymentEventExhaustive(event: PaymentEvent): string {
  switch (event.type) {
    case "payment.created":
    case "payment.processing":
    case "payment.authorized":
    case "payment.succeeded":
    case "payment.cancelled":
      return event.payment.status;
    case "payment.failed":
      return event.failure.code;
    case "capture.completed":
      return event.capture.status;
    case "refund.pending":
    case "refund.completed":
      return event.refund.status;
    case "refund.failed":
      return event.refund.status;
    case "payment_method.setup_completed":
      return event.setup.status;
    case "dispute.opened":
    case "dispute.updated":
    case "dispute.closed":
      return event.dispute.status;
    case "provider.unmapped":
      return event.provider.eventType;
    default: {
      const _never: never = event;
      return String(_never);
    }
  }
}
void _assertPaymentEventExhaustive;

// schemaVersion is literally '1' on every PaymentEvent arm — wrong version not assignable
type PaymentEventSchema = PaymentEvent["schemaVersion"];
expectTypesEqual<PaymentEventSchema, "1">(true);
const _badPaymentEventVersion: PaymentEvent = {
  // @ts-expect-error — schemaVersion must be '1' (not '2' without a cast)
  schemaVersion: "2",
  type: "payment.succeeded",
  payment: paymentSnapForEvent,
  provider: providerMeta,
};
void _badPaymentEventVersion;

// Discriminant narrowing guarantees (handlers receive typed arms)
type SucceededArm = Extract<PaymentEvent, { type: "payment.succeeded" }>;
type RefundCompletedArm = Extract<PaymentEvent, { type: "refund.completed" }>;
expectType<SucceededArm["payment"]>(paymentSnapForEvent);
expectType<FailedArm["failure"]>({ code: "x", message: "y" });
expectType<RefundCompletedArm["refund"]>(refundEntity);
// failure is not a key on payment.succeeded
type SucceededKeys = keyof SucceededArm;
// @ts-expect-error — payment.succeeded arm has no failure field
const _noFailureKey: SucceededKeys = "failure";
void _noFailureKey;
// payment is not a key on refund.completed
type RefundCompletedKeys = keyof RefundCompletedArm;
// @ts-expect-error — refund.completed arm has no payment field
const _noPaymentKey: RefundCompletedKeys = "payment";
void _noPaymentKey;

// ProviderEventMetadata requires gateway, eventId, eventType, occurredAt, receivedAt
// @ts-expect-error — missing required provider fields
const _incompleteProvider: ProviderEventMetadata = {
  gateway: "stripe",
  eventId: "e1",
};
void _incompleteProvider;
const _wrongProviderTimes: ProviderEventMetadata = {
  gateway: "stripe",
  eventId: "e1",
  eventType: "x",
  // @ts-expect-error — Date is not assignable to ISO string
  occurredAt: new Date(),
  // @ts-expect-error — Date is not assignable to ISO string
  receivedAt: new Date(),
};
void _wrongProviderTimes;

// Envelope requires schemaVersion + event + payloadHash + storedAt
const envelope: PersistedPaymentEventEnvelope = {
  schemaVersion: "1",
  event: succeededEvent,
  payloadHash: "abc",
  storedAt: "2024-01-01T00:00:00.000Z",
};
expectType<PersistedPaymentEventEnvelope>(envelope);
// schemaVersion is literally '1' — other versions are not assignable
type EnvelopeSchema = PersistedPaymentEventEnvelope["schemaVersion"];
expectTypesEqual<EnvelopeSchema, "1">(true);
// @ts-expect-error — schemaVersion must be '1'
const _badEnvelopeVersion: EnvelopeSchema = "2";
void _badEnvelopeVersion;
const _badEnvelope: PersistedPaymentEventEnvelope = {
  // @ts-expect-error — envelope schemaVersion cannot be '2'
  schemaVersion: "2",
  event: succeededEvent,
  payloadHash: "abc",
  storedAt: "2024-01-01T00:00:00.000Z",
};
void _badEnvelope;

// Encrypted raw record + request-local context
expectType<EncryptedRawPayloadRecord>({
  schemaVersion: "1",
  ciphertext: "c",
  payloadHash: "h",
});
expectType<RequestLocalWebhookContext>({ rawPayload: {} });

// Runtime helpers
expectType<boolean>(isStablePaymentEventType("payment.succeeded"));
expectType<PaymentEvent>(webhookEventToPaymentEvent(webhookEvent));
expectType<PersistedPaymentEventEnvelope>(
  toPersistedPaymentEventEnvelope(succeededEvent, {
    payloadHash: "a".repeat(64),
  }),
);
expectType<string>(hashWebhookPayload({}));
expectType<"payment.succeeded" | "provider.unmapped">(
  mapProviderEventTypeToStable("stripe", "payment_intent.succeeded") as
    | "payment.succeeded"
    | "provider.unmapped",
);

// Open contract: HookContext.gateway accepts custom names
const customHookCtx: HookContext = {
  gateway: "braintree",
  operation: "createPayment",
  params: {},
  timestamp: new Date(),
  metadata: {},
};
expectType<HookContext>(customHookCtx);

// PaymentGateway is generic-friendly over custom names (type-level only)
expectTypesEqual<PaymentGateway<"acme">["name"], "acme">(true);
expectType<PaymentGateway>(null! as PaymentGateway<"acme">);

// ─── PaymentStatus union (smoke) ─────────────────────────────────────────────

const statuses: PaymentStatus[] = [
  "pending",
  "processing",
  "authorized",
  "approved",
  "paid",
  "partially_captured",
  "failed",
  "cancelled",
  "reversed",
  "refunded",
  "partially_refunded",
  "refund_completed",
  "refund_pending",
  "refund_failed",
  "setup_completed",
];
expectType<PaymentStatus[]>(statuses);

// @ts-expect-error — not a PaymentStatus
const _badPaymentStatus: PaymentStatus = "succeeded";

// ─── Phase 6 CommonPaymentInput / outcomes / domain statuses ──────────────────

const commonInput: CommonPaymentInput = {
  amount: 1,
  orderId: "o1",
  description: "d",
  metadata: { k: "v" } satisfies PaymentMetadata,
};
expectType<CommonPaymentInput>(commonInput);

// AC3: keyof CommonPaymentInput is only amount|orderId|description|metadata
type CommonPaymentInputKeys = keyof CommonPaymentInput;
expectTypesEqual<
  CommonPaymentInputKeys,
  "amount" | "orderId" | "description" | "metadata"
>(true);

// AC3: assigning provider-specific fields to CommonPaymentInput is a type error
const _commonWithStripe: CommonPaymentInput = {
  amount: 1,
  // @ts-expect-error — stripePaymentMethodId is not on CommonPaymentInput
  stripePaymentMethodId: "pm_x",
};
void _commonWithStripe;

const _commonWithMoyasar: CommonPaymentInput = {
  amount: 1,
  // @ts-expect-error — moyasarSource is not on CommonPaymentInput
  moyasarSource: { type: "token", token: "tok_x" },
};
void _commonWithMoyasar;

const _commonWithCurrency: CommonPaymentInput = {
  amount: 1,
  // @ts-expect-error — currency is on CreatePaymentParams, not CommonPaymentInput
  currency: "SAR",
};
void _commonWithCurrency;

// CreatePaymentParams still accepts provider keys (0.x convenience mega-interface)
expectType<CreatePaymentParams>({
  ...commonInput,
  currency: "SAR",
  callbackUrl: "https://example.com/cb",
  stripePaymentMethodId: "pm_x",
});

type SucceededOp = Extract<PaymentOperationResult, { outcome: "succeeded" }>;
type RequiresActionOp = Extract<
  PaymentOperationResult,
  { outcome: "requires_action" }
>;
type DeclinedOp = Extract<PaymentOperationResult, { outcome: "declined" }>;
type FailedOp = Extract<PaymentOperationResult, { outcome: "failed" }>;
type IndeterminateOp = Extract<
  PaymentOperationResult,
  { outcome: "indeterminate" }
>;

// AC1 type-level: outcome arms are not mutually assignable
// @ts-expect-error — requires_action arm is not assignable to succeeded
const _reqNotSucc: SucceededOp = null! as RequiresActionOp;
void _reqNotSucc;
// @ts-expect-error — succeeded is not assignable to requires_action
const _succNotReq: RequiresActionOp = null! as SucceededOp;
void _succNotReq;
// @ts-expect-error — declined is not assignable to succeeded
const _decNotSucc: SucceededOp = null! as DeclinedOp;
void _decNotSucc;
// @ts-expect-error — indeterminate is not assignable to succeeded
const _indNotSucc: SucceededOp = null! as IndeterminateOp;
void _indNotSucc;

// AC2 type-level: indeterminate arm requires reconciliationRequired: true (literal)
expectTypesEqual<IndeterminateOp["reconciliationRequired"], true>(true);
const _indOk: IndeterminateOp = {
  outcome: "indeterminate",
  reconciliationRequired: true,
};
expectType<IndeterminateOp>(_indOk);
const _indFalse: IndeterminateOp = {
  outcome: "indeterminate",
  // @ts-expect-error — reconciliationRequired must be true, not false
  reconciliationRequired: false,
};
void _indFalse;

// AC1: exhaustiveness switch on PaymentOperationResult.outcome
function _assertOutcomeExhaustive(result: PaymentOperationResult): string {
  switch (result.outcome) {
    case "succeeded":
      return result.payment.status;
    case "requires_action":
      return result.action.type;
    case "declined":
      return result.failure.code;
    case "failed":
      return result.error.code;
    case "indeterminate": {
      const _true: true = result.reconciliationRequired;
      return _true ? "indeterminate" : "never";
    }
    default: {
      const _never: never = result;
      return String(_never);
    }
  }
}
void _assertOutcomeExhaustive;

expectType<PaymentOperationOutcome>("succeeded");
expectType<PaymentOperationOutcome>("indeterminate");
expectType<PaymentDecline>({ code: "x", message: "y" });
expectType<PaymentErrorLike>({ name: "PaymentError", message: "m", code: "C" });
expectType<PaymentAction>({ type: "redirect", url: "https://x" });
expectType<PaymentDomainStatus>("paid");
expectType<AuthorizationStatus>("voided");
expectType<CaptureStatus>("partially_completed");
expectType<RefundDomainStatus>("completed");
expectType<SetupTokenStatus>("requires_action");
expectType<DisputeStatus>("needs_response");
expectType<TransferStatus>("reversed");
expectType<PayoutStatus>("in_transit");

// AC4: PaymentDomainStatus does not include setup_completed or refund_pending
// @ts-expect-error — setup_completed is legacy mega-union only
const _domainNoSetup: PaymentDomainStatus = "setup_completed";
void _domainNoSetup;
// @ts-expect-error — refund_pending is legacy mega-union only
const _domainNoRefundPending: PaymentDomainStatus = "refund_pending";
void _domainNoRefundPending;
// @ts-expect-error — refund_completed is legacy mega-union only
const _domainNoRefundCompleted: PaymentDomainStatus = "refund_completed";
void _domainNoRefundCompleted;

// AC5: ProviderReferences required fields
type ProviderRefRequired = Pick<
  ProviderReferences,
  "providerObjectId" | "normalizedStatus" | "gateway"
>;
expectType<ProviderRefRequired>({
  providerObjectId: "x",
  normalizedStatus: "paid",
  gateway: "stripe",
});
// @ts-expect-error — providerObjectId is required
const _refsMissingId: ProviderReferences = {
  normalizedStatus: "paid",
  gateway: "stripe",
};
void _refsMissingId;

expectType<ProviderReferences>(
  buildProviderReferences({
    gateway: "moyasar",
    gatewayId: "pay_1",
    status: "paid",
  }),
);

// Runtime helpers assignable
expectType<PaymentOperationResult>(
  mapGatewayResultToOperationResult(paymentResult),
);
expectType<GatewayPaymentResult>(
  applyOutcomeToGatewayResult(
    {
      gatewayId: "x",
      status: "paid",
      rawResponse: {},
      gateway: "stripe",
    },
    "succeeded",
  ),
);
expectType<boolean>(isPaidOutcome(paymentResult));
expectType<boolean>(isRequiresActionOutcome(paymentResult));
expectType<boolean>(isIndeterminateOutcome(paymentResult));
expectType<boolean>(isPaymentDomainStatus("paid"));

// Payment snapshot type
const _paymentSnap: Payment = {
  status: "paid",
  references: buildProviderReferences({
    gateway: "stripe",
    gatewayId: "pi",
    status: "paid",
  }),
};
expectType<Payment>(_paymentSnap);

// AC7: RefundOperationResult parallel surface
expectType<RefundOperationOutcome>("succeeded");
expectType<RefundOperationOutcome>("pending");
expectType<RefundOperationOutcome>("failed");
expectType<RefundOperationOutcome>("indeterminate");
type RefundInd = Extract<RefundOperationResult, { outcome: "indeterminate" }>;
expectTypesEqual<RefundInd["reconciliationRequired"], true>(true);
const _refundInd: RefundInd = {
  outcome: "indeterminate",
  reconciliationRequired: true,
};
expectType<RefundInd>(_refundInd);
const _refundIndFalse: RefundInd = {
  outcome: "indeterminate",
  // @ts-expect-error — refund indeterminate requires true
  reconciliationRequired: false,
};
void _refundIndFalse;

expectType<RefundOperationResult>(
  mapGatewayRefundToOperationResult(refundResult),
);
expectType<boolean>(successFromRefundOutcome("succeeded"));
expectType<RefundOperationOutcome>(
  inferRefundOperationOutcome(refundResult),
);
expectType<GatewayRefundResult>(
  applyOutcomeToGatewayRefundResult(
    {
      gatewayRefundId: "re_x",
      status: "completed",
      rawResponse: {},
    },
    "succeeded",
  ),
);

// GatewayRefundResult optional outcome dual-write field
type RefundResultKeys = keyof GatewayRefundResult;
expectType<RefundResultKeys>("success");
expectType<RefundResultKeys>("outcome");
expectType<RefundResultKeys>("gatewayRefundId");
expectType<RefundResultKeys>("status");
expectType<RefundResultKeys>("reconciliationRequired");
expectType<RefundResultKeys>("providerRequestId");

// ─── PaymentHooks optional handlers ──────────────────────────────────────────

const emptyHooks: PaymentHooks = {};
expectType<PaymentHooks>(emptyHooks);

const fullHooks: PaymentHooks = {
  onBefore: (_ctx: HookContext) => ({ proceed: true }),
  onAfter: (_ctx, _result) => ({ proceed: true }),
  onError: (_ctx, _error) => {},
  beforeCreatePayment: (ctx) => {
    expectType<CreatePaymentParams>(ctx.params);
    const ok: BeforeHookResult<CreatePaymentParams> = { proceed: true };
    return ok;
  },
  afterCreatePayment: (_ctx, result) => {
    expectType<GatewayPaymentResult>(result);
    const ok: AfterHookResult<GatewayPaymentResult> = {
      proceed: true,
      modifiedResult: result,
    };
    return ok;
  },
  beforeCapture: (_ctx) => ({ proceed: true }),
  afterCapture: (_ctx, _result) => ({ proceed: true }),
  beforeRefund: (_ctx) => ({ proceed: true }),
  afterRefund: (_ctx, result) => {
    expectType<GatewayRefundResult>(result);
    return { proceed: true };
  },
  beforeVoid: (_ctx) => ({ proceed: true }),
  afterVoid: (_ctx, _result) => ({ proceed: true }),
  onWebhookReceived: (_gateway, _payload) => {},
  onWebhookVerified: (event) => {
    expectType<WebhookEvent>(event);
  },
  onWebhookFailed: (_payload, _error) => {},
};
expectType<PaymentHooks>(fullHooks);

// ─── PaymentClient method signatures (assignability of args) ─────────────────

/**
 * Structural stand-in: if PaymentClient methods change param types, these
 * assignments fail typecheck. We never instantiate here — only check call shapes.
 */
type ClientCreate = PaymentClient["createPayment"];
type ClientCapture = PaymentClient["capturePayment"];
type ClientRefund = PaymentClient["refundPayment"];
type ClientVoid = PaymentClient["voidPayment"];
type ClientGet = PaymentClient["getPayment"];
type ClientStatus = PaymentClient["getPaymentStatus"];
type ClientWebhook = PaymentClient["handleWebhook"];

// Single-arg create accepts CreatePaymentParams (default BuiltInGatewayMap names)
expectType<
  (params: CreatePaymentParams, gateway?: GatewayName) => Promise<GatewayPaymentResult>
>(null! as ClientCreate);

// Capture / refund / void / get accept their param types
expectType<
  (params: CaptureParams, gateway?: GatewayName) => Promise<GatewayPaymentResult>
>(null! as ClientCapture);
expectType<
  (params: RefundParams, gateway?: GatewayName) => Promise<GatewayRefundResult>
>(null! as ClientRefund);
expectType<
  (params: VoidParams, gateway?: GatewayName) => Promise<GatewayPaymentResult>
>(null! as ClientVoid);
expectType<
  (params: GetPaymentParams, gateway?: GatewayName) => Promise<GatewayPaymentResult>
>(null! as ClientGet);
expectType<
  (gatewayId: string, gateway?: GatewayName) => Promise<PaymentStatus>
>(null! as ClientStatus);
// handleWebhook accepts registered names (built-in default map ⊆ GatewayName)
expectType<
  (
    gateway: GatewayName,
    payload: unknown,
    signatureOrHeaders?: string | Record<string, string>,
    headers?: Record<string, string>,
  ) => Promise<WebhookEvent>
>(null! as ClientWebhook);

// ─── PaymentClientConfig gateway shapes ──────────────────────────────────────

const moyasarOnly: PaymentClientConfig = {
  moyasar: { secretKey: "sk_test" } satisfies MoyasarConfig,
  defaultGateway: "moyasar",
};
const paypalOnly: PaymentClientConfig = {
  paypal: {
    clientId: "id",
    clientSecret: "secret",
  } satisfies PayPalConfig,
  defaultGateway: "paypal",
};
const paymobOnly: PaymentClientConfig = {
  paymob: { secretKey: "sec" } satisfies PaymobConfig,
  defaultGateway: "paymob",
};
const stripeOnly: PaymentClientConfig = {
  stripe: { secretKey: "sk_test" } satisfies StripeConfig,
  defaultGateway: "stripe",
};
expectType<PaymentClientConfig>(moyasarOnly);
expectType<PaymentClientConfig>(paypalOnly);
expectType<PaymentClientConfig>(paymobOnly);
expectType<PaymentClientConfig>(stripeOnly);

const _badDefault: PaymentClientConfig = {
  moyasar: { secretKey: "sk" },
  // @ts-expect-error — defaultGateway must be GatewayName
  defaultGateway: "braintree",
};

// ─── Supporting exported types remain importable ─────────────────────────────

expectType<PaymentGateway>(null! as PaymentGateway);
expectType<Logger>(noopLikeLogger());
expectType<IdempotencyStore>(null! as IdempotencyStore);

// Plugin foundation exports (Stream A + B)
expectType<GatewayManifest>({ name: "acme" });
expectType<GatewayAdapter>(null! as GatewayAdapter);
expectType<GatewayContext>(createDefaultGatewayContext());
expectType<ImmutableGatewayRegistry>(createGatewayRegistry().build());
expectType<CreatePaymentClientOptions>({
  gateways: {
    stripe: stripeGateway({ secretKey: "sk" }),
  },
});

// Phase 8 — PaymentRuntime fields required; optional on client options
const runtime: PaymentRuntime = createPaymentRuntime();
expectType<PaymentRuntime>(runtime);
expectType<typeof globalThis.fetch>(runtime.fetch);
expectType<CryptoProvider>(runtime.crypto);
expectType<Clock>(runtime.clock);
expectType<string>(runtime.randomUUID());
expectType<CreatePaymentClientOptions>({
  gateways: {
    stripe: stripeGateway({ secretKey: "sk" }),
  },
  runtime: {
    fetch: runtime.fetch,
    clock: runtime.clock,
  },
});
// GatewayContext extends PaymentRuntime
expectType<PaymentRuntime>(createDefaultGatewayContext());
expectType<string>(sha256Hex("abc"));
expectType<string>(hmacSha256Hex("key", "msg"));
expectType<boolean>(timingSafeEqualBytes(new Uint8Array(0), new Uint8Array(0)));

// ─── Phase 5–8 public type freeze hygiene (assignability, not option-bag exhaust) ─

// MoneyFailureKind closed union (Phase 5)
expectType<MoneyFailureKind>("excess_precision");
expectType<MoneyFailureKind>("invalid_format");
expectType<MoneyFailureKind>("zero");
expectType<MoneyFailureKind>("negative");
expectType<MoneyFailureKind>("unsafe_range");
expectType<MoneyFailureKind>("currency_mismatch");
expectType<MoneyFailureKind>("invalid_exponent");
expectType<MoneyFailureKind>("other");
// @ts-expect-error — not a MoneyFailureKind
const _badMoneyKind: MoneyFailureKind = "silent_round";
void _badMoneyKind;

// Clock / CryptoProvider structural contracts (Phase 8)
const clockFixture: Clock = {
  now: () => new Date(),
  nowMs: () => 0,
};
expectType<Clock>(clockFixture);
expectType<Date>(clockFixture.now());
expectType<number>(clockFixture.nowMs());
// @ts-expect-error — Clock requires now/nowMs
const _incompleteClock: Clock = { now: () => new Date() };
void _incompleteClock;

const cryptoFixture: CryptoProvider = {
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
  getRandomValues: <T extends ArrayBufferView>(array: T) => array,
};
expectType<CryptoProvider>(cryptoFixture);
expectType<string>(cryptoFixture.randomUUID());

// PaymentRuntime required keys; GatewayRuntimeDeps is Partial<PaymentRuntime>
type PaymentRuntimeKeys = keyof PaymentRuntime;
expectType<PaymentRuntimeKeys>("fetch");
expectType<PaymentRuntimeKeys>("crypto");
expectType<PaymentRuntimeKeys>("clock");
expectType<PaymentRuntimeKeys>("randomUUID");
// @ts-expect-error — missing required PaymentRuntime fields
const _incompleteRuntime: PaymentRuntime = {
  fetch: globalThis.fetch,
};
void _incompleteRuntime;

const runtimeDepsEmpty: GatewayRuntimeDeps = {};
const runtimeDepsPartial: GatewayRuntimeDeps = { clock: clockFixture };
expectType<GatewayRuntimeDeps>(runtimeDepsEmpty);
expectType<GatewayRuntimeDeps>(runtimeDepsPartial);
// Partial assignability: GatewayRuntimeDeps accepts subset of PaymentRuntime
const _depsFromRuntime: GatewayRuntimeDeps = runtime;
expectType<GatewayRuntimeDeps>(_depsFromRuntime);

// ApplyOutcomeGatewayBase — dual-write base shape (Phase 6)
const applyBase: ApplyOutcomeGatewayBase = {
  gatewayId: "pi_x",
  status: "paid",
  rawResponse: {},
  gateway: "stripe",
};
expectType<ApplyOutcomeGatewayBase>(applyBase);
expectType<GatewayPaymentResult>(
  applyOutcomeToGatewayResult(applyBase, "succeeded"),
);
// required keys on ApplyOutcomeGatewayBase
type ApplyBaseKeys = keyof ApplyOutcomeGatewayBase;
expectType<ApplyBaseKeys>("gatewayId");
expectType<ApplyBaseKeys>("status");
expectType<ApplyBaseKeys>("rawResponse");
expectType<ApplyBaseKeys>("nextAction");
expectType<ApplyBaseKeys>("clientSecret");
// @ts-expect-error — gatewayId required
const _missingApplyId: ApplyOutcomeGatewayBase = {
  status: "paid",
  rawResponse: {},
};
void _missingApplyId;

// RawWebhookPayloadCodec (Phase 7 opt-in raw retention)
const codecFixture: RawWebhookPayloadCodec = {
  encrypt: (plaintext) => String(plaintext),
  decrypt: (ciphertext) => ciphertext,
};
expectType<RawWebhookPayloadCodec>(codecFixture);
// @ts-expect-error — encrypt required
const _incompleteCodec: RawWebhookPayloadCodec = {
  decrypt: (c) => c,
};
void _incompleteCodec;

// StablePaymentEventType ↔ STABLE_PAYMENT_EVENT_TYPES (already equal above);
// sample catalog literals + negatives (provider.unmapped is PaymentEvent escape hatch only)
expectType<StablePaymentEventType>("payment.succeeded");
expectType<StablePaymentEventType>("refund.completed");
expectType<StablePaymentEventType>("payment.created");
// @ts-expect-error — not a catalog stable name (escape hatch is PaymentEvent arm, not StablePaymentEventType)
const _notStable: StablePaymentEventType = "provider.unmapped";
void _notStable;
// @ts-expect-error — arbitrary string is not StablePaymentEventType
const _bogusStable: StablePaymentEventType = "payment.totally_fake";
void _bogusStable;

// ProviderEventMetadata optional fields remain optional; required keys locked
type ProviderMetaKeys = keyof ProviderEventMetadata;
expectType<ProviderMetaKeys>("gateway");
expectType<ProviderMetaKeys>("eventId");
expectType<ProviderMetaKeys>("eventType");
expectType<ProviderMetaKeys>("occurredAt");
expectType<ProviderMetaKeys>("receivedAt");
expectType<ProviderMetaKeys>("apiVersion");
expectType<ProviderMetaKeys>("livemode");
expectType<ProviderMetaKeys>("requestId");

// PersistedPaymentEventEnvelope keys locked (secret-free envelope)
type EnvelopeKeys = keyof PersistedPaymentEventEnvelope;
expectType<EnvelopeKeys>("schemaVersion");
expectType<EnvelopeKeys>("event");
expectType<EnvelopeKeys>("payloadHash");
expectType<EnvelopeKeys>("storedAt");
// rawPayload must not be an envelope key
// @ts-expect-error — envelope never carries rawPayload
const _envRawKey: EnvelopeKeys = "rawPayload";
void _envRawKey;

// RefundOperationOutcome closed union + map helper return (applyOutcomeToGatewayRefundResult dual-writes outcome)
expectTypesEqual<
  RefundOperationOutcome,
  "succeeded" | "pending" | "failed" | "indeterminate"
>(true);
// @ts-expect-error — refunds have no requires_action arm
const _refundRequiresAction: RefundOperationOutcome = "requires_action";
void _refundRequiresAction;
expectType<RefundOperationResult>(
  mapGatewayRefundToOperationResult(refundResult),
);
// GatewayRefundResult.outcome is optional dual-write field when present
const refundWithOutcome: GatewayRefundResult = {
  success: true,
  gatewayRefundId: "re_1",
  status: "completed",
  rawResponse: {},
  outcome: "succeeded",
};
expectType<GatewayRefundResult>(refundWithOutcome);
expectType<RefundOperationOutcome>(
  inferRefundOperationOutcome(refundWithOutcome),
);

// Phase 3 capability foundation (Stream A)
expectType<GatewayCapabilityKey>("payments");
expectType<GatewayCapabilityKey>("providerRecurring");
// @ts-expect-error — not a capability key
const _badCapKey: GatewayCapabilityKey = "subscriptions";
void _badCapKey;
expectType<GatewayCapabilities>({
  payments: true,
  immediateCapture: false,
  authorization: false,
  partialCapture: false,
  refunds: true,
  partialRefunds: true,
  voids: true,
  hostedCheckout: false,
  tokenization: false,
  customers: false,
  paymentMethods: false,
  marketplaceSplits: false,
  disputes: false,
  paymentLinks: false,
  providerRecurring: false,
});
expectType<GatewayManifest>({
  name: "acme",
  capabilities: {
    payments: true,
    immediateCapture: false,
    authorization: false,
    partialCapture: false,
    refunds: false,
    partialRefunds: false,
    voids: false,
    hostedCheckout: false,
    tokenization: false,
    customers: false,
    paymentMethods: false,
    marketplaceSplits: false,
    disputes: false,
    paymentLinks: false,
    providerRecurring: false,
  },
});
expectType<OperationNotSupportedErrorOptions>({
  capability: "voids",
  claimedSupport: false,
  message: "no voids",
});
// PaymentGateway requires capabilities + supports
expectType<PaymentGateway["capabilities"]>(null! as GatewayCapabilities);
expectType<PaymentGateway["supports"]>((_k: GatewayCapabilityKey) => false);
// supports only accepts GatewayCapabilityKey (type-only; avoid declare for bun test)
function _assertSupportsTyping(
  supports: PaymentGateway["supports"],
): void {
  expectType<boolean>(supports("payments"));
  // @ts-expect-error — bogus capability key is not assignable
  supports("notARealCapability");
}
void _assertSupportsTyping;

// Doc generation helper (public)
expectType<string>(
  generateGatewayCapabilitiesMarkdown([...BUILTIN_GATEWAY_MANIFESTS]),
);
expectType<string>(CAPABILITY_DOCS_BANNER);
expectType<readonly string[]>(GATEWAY_CAPABILITY_KEYS);
expectType<boolean>(isGatewayCapabilityKey("payments"));

// createPaymentClient infers concrete gateway() return types from the map
const typedPluginClient = createPaymentClient({
  gateways: {
    stripe: stripeGateway({ secretKey: "sk_type" }),
    moyasar: moyasarGateway({ secretKey: "sk_type_m" }),
  },
  defaultGateway: "moyasar",
});
expectType<StripeGateway>(typedPluginClient.gateway("stripe"));
expectType<MoyasarGateway>(typedPluginClient.gateway("moyasar"));
// Negative name checks are type-only (must not execute at runtime)
function _unregisteredGatewayNamesMustFailTypecheck(
  client: typeof typedPluginClient,
): void {
  // @ts-expect-error — "adyen" was not registered on this client
  client.gateway("adyen");
  // @ts-expect-error — "paypal" was not registered on this client
  client.gateway("paypal");
  // @ts-expect-error — empty / unknown
  client.gateway("nope");
}
void _unregisteredGatewayNamesMustFailTypecheck;

// stripe + custom third-party adapter: custom type inferred; unknown rejected
interface ExampleCustomGateway extends PaymentGateway<"custom"> {
  readonly name: "custom";
  exampleOnly(): number;
}
type ExampleCustomAdapter = GatewayAdapter<"custom", ExampleCustomGateway>;
type StripePlusCustom = {
  stripe: GatewayAdapter<"stripe", StripeGateway>;
  custom: ExampleCustomAdapter;
};
type InferredStripeCustom = InferGatewayMapFromAdapters<StripePlusCustom>;
expectTypesEqual<InferredStripeCustom["stripe"], StripeGateway>(true);
expectTypesEqual<InferredStripeCustom["custom"], ExampleCustomGateway>(true);

// Type-only fixtures (never executed at runtime — bun would throw on `declare`)
function _stripePlusCustomInference(
  client: PaymentClient<InferredStripeCustom>,
  legacy: PaymentClient,
): void {
  expectType<StripeGateway>(client.gateway("stripe"));
  expectType<ExampleCustomGateway>(client.gateway("custom"));
  // @ts-expect-error — not registered
  client.gateway("nope");
  // @ts-expect-error — not on this map
  client.gateway("moyasar");

  // Legacy default PaymentClient is BuiltInGatewayMap — only built-in names
  expectType<StripeGateway>(legacy.gateway("stripe"));
  // @ts-expect-error — "custom" is not a BuiltInGatewayName / BuiltInGatewayMap key
  legacy.gateway("custom");
}
void _stripePlusCustomInference;

// Built-in adapter factories (Stream C) — concrete name + gateway type
expectType<GatewayAdapter<"stripe", StripeGateway>>(
  stripeGateway({ secretKey: "sk_test" }),
);
expectType<GatewayAdapter<"moyasar", MoyasarGateway>>(
  moyasarGateway({ secretKey: "sk_test" }),
);
expectType<GatewayAdapter<"paypal", PayPalGateway>>(
  paypalGateway({ clientId: "id", clientSecret: "sec" }),
);
expectType<GatewayAdapter<"paymob", PaymobGateway>>(
  paymobGateway({ secretKey: "sk" }),
);

function noopLikeLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

// ─── Runtime smoke so bun test executes this file ────────────────────────────

describe("public API type-level suite (runtime smoke)", () => {
  it("keeps fixture objects aligned with public contract samples", () => {
    // Type checks above are compile-time only (`tsc -p tsconfig.type-tests.json`).
    // Runtime asserts ensure the shared fixtures still match documented shapes so
    // `bun test` loads this file and flags accidental fixture drift.
    expect(validGateways).toEqual(["moyasar", "paypal", "paymob", "stripe"]);
    expect(createParams).toMatchObject({
      amount: 10.5,
      currency: "SAR",
      callbackUrl: "https://example.com/callback",
    });
    expect(paymentResult).toMatchObject({
      success: true,
      gatewayId: "pay_abc",
      status: "paid",
    });
    expect(webhookEvent).toMatchObject({
      id: "evt_1",
      gateway: "moyasar",
      status: "paid",
    });
    expect(statuses).toContain("paid");
    expect(statuses).not.toContain("succeeded");
  });
});
