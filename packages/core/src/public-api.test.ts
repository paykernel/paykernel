/**
 * Phase 0 public API surface — runtime regression tests.
 *
 * Freezes constructability and export presence of symbols re-exported from
 * `./index`. No network calls; mock secrets only.
 */
import { describe, it, expect } from "bun:test";
import * as sdk from "./index";
import {
  PaymentClient,
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
  redact,
  noopLogger,
  createRedactingLogger,
  withRetry,
  parseRetryAfterSeconds,
  DEFAULT_RETRY_CONFIG,
  fingerprintParams,
  InMemoryIdempotencyStore,
  isCreditCardSource,
  isCardTokenSource,
  isApplePaySource,
  isSamsungPaySource,
  isStcPaySource,
  HooksManager,
  BaseGateway,
  MoyasarGateway,
  PayPalGateway,
  PaymobGateway,
  StripeGateway,
} from "./index";
import type { GatewayName, CreditCardSource } from "./index";

describe("public API runtime surface", () => {
  describe("namespace export presence", () => {
    it("re-exports every documented runtime symbol from the package root", () => {
      // Freeze the public value surface: accidental renames/removals fail here.
      const runtimeExports: Array<[string, unknown]> = [
        ["PaymentClient", sdk.PaymentClient],
        ["PaymentError", sdk.PaymentError],
        ["PaymentAbortedError", sdk.PaymentAbortedError],
        ["GatewayNotConfiguredError", sdk.GatewayNotConfiguredError],
        ["OperationNotSupportedError", sdk.OperationNotSupportedError],
        ["InvalidWebhookError", sdk.InvalidWebhookError],
        ["GatewayApiError", sdk.GatewayApiError],
        ["CardDeclinedError", sdk.CardDeclinedError],
        ["InsufficientFundsError", sdk.InsufficientFundsError],
        ["AuthenticationError", sdk.AuthenticationError],
        ["RateLimitError", sdk.RateLimitError],
        ["ResourceNotFoundError", sdk.ResourceNotFoundError],
        ["InvalidRequestError", sdk.InvalidRequestError],
        ["NetworkError", sdk.NetworkError],
        ["redact", sdk.redact],
        ["noopLogger", sdk.noopLogger],
        ["createRedactingLogger", sdk.createRedactingLogger],
        ["withRetry", sdk.withRetry],
        ["parseRetryAfterSeconds", sdk.parseRetryAfterSeconds],
        ["DEFAULT_RETRY_CONFIG", sdk.DEFAULT_RETRY_CONFIG],
        ["fingerprintParams", sdk.fingerprintParams],
        ["InMemoryIdempotencyStore", sdk.InMemoryIdempotencyStore],
        ["isCreditCardSource", sdk.isCreditCardSource],
        ["isCardTokenSource", sdk.isCardTokenSource],
        ["isApplePaySource", sdk.isApplePaySource],
        ["isSamsungPaySource", sdk.isSamsungPaySource],
        ["isStcPaySource", sdk.isStcPaySource],
        ["HooksManager", sdk.HooksManager],
        ["BaseGateway", sdk.BaseGateway],
        ["MoyasarGateway", sdk.MoyasarGateway],
        ["PayPalGateway", sdk.PayPalGateway],
        ["PaymobGateway", sdk.PaymobGateway],
        ["StripeGateway", sdk.StripeGateway],
        ["createGatewayRegistry", sdk.createGatewayRegistry],
        ["createDynamicGatewayRegistry", sdk.createDynamicGatewayRegistry],
        ["createDefaultGatewayContext", sdk.createDefaultGatewayContext],
        ["createRedactingTelemetrySink", sdk.createRedactingTelemetrySink],
        // Phase 8 portable runtime
        ["createPaymentRuntime", sdk.createPaymentRuntime],
        ["mergePaymentRuntime", sdk.mergePaymentRuntime],
        ["paymentRuntimeFromContext", sdk.paymentRuntimeFromContext],
        ["systemClock", sdk.systemClock],
        ["resolveDefaultCrypto", sdk.resolveDefaultCrypto],
        ["uuidV4FromGetRandomValues", sdk.uuidV4FromGetRandomValues],
        ["combineAbortSignals", sdk.combineAbortSignals],
        ["createTimeoutSignal", sdk.createTimeoutSignal],
        ["isAbortError", sdk.isAbortError],
        ["mapHttpAbortError", sdk.mapHttpAbortError],
        ["extractAbortSignal", sdk.extractAbortSignal],
        ["stripAbortSignal", sdk.stripAbortSignal],
        ["withAbortSignal", sdk.withAbortSignal],
        ["utf8Encode", sdk.utf8Encode],
        ["bytesToHex", sdk.bytesToHex],
        ["hexToBytes", sdk.hexToBytes],
        ["bytesToBase64", sdk.bytesToBase64],
        ["base64ToBytes", sdk.base64ToBytes],
        ["utf8ToBase64", sdk.utf8ToBase64],
        ["timingSafeEqualBytes", sdk.timingSafeEqualBytes],
        ["timingSafeEqualHex", sdk.timingSafeEqualHex],
        ["sha256", sdk.sha256],
        ["sha256Hex", sdk.sha256Hex],
        ["sha512", sdk.sha512],
        ["sha512Hex", sdk.sha512Hex],
        ["hmacSha256", sdk.hmacSha256],
        ["hmacSha256Hex", sdk.hmacSha256Hex],
        ["hmacSha512", sdk.hmacSha512],
        ["hmacSha512Hex", sdk.hmacSha512Hex],
        ["concatBytes", sdk.concatBytes],
        ["createPaymentClient", sdk.createPaymentClient],
        ["stripeGateway", sdk.stripeGateway],
        ["moyasarGateway", sdk.moyasarGateway],
        ["paypalGateway", sdk.paypalGateway],
        ["paymobGateway", sdk.paymobGateway],
        ["GATEWAY_CAPABILITY_KEYS", sdk.GATEWAY_CAPABILITY_KEYS],
        ["DEFAULT_GATEWAY_CAPABILITIES", sdk.DEFAULT_GATEWAY_CAPABILITIES],
        ["defineGatewayCapabilities", sdk.defineGatewayCapabilities],
        ["isGatewayCapabilityKey", sdk.isGatewayCapabilityKey],
        ["CAPABILITY_OPERATION_MAP", sdk.CAPABILITY_OPERATION_MAP],
        ["freezeCapabilities", sdk.freezeCapabilities],
        ["STRIPE_CAPABILITIES", sdk.STRIPE_CAPABILITIES],
        ["MOYASAR_CAPABILITIES", sdk.MOYASAR_CAPABILITIES],
        ["PAYPAL_CAPABILITIES", sdk.PAYPAL_CAPABILITIES],
        ["PAYMOB_CAPABILITIES", sdk.PAYMOB_CAPABILITIES],
        ["BUILTIN_GATEWAY_CAPABILITIES", sdk.BUILTIN_GATEWAY_CAPABILITIES],
        ["BUILTIN_GATEWAY_MANIFESTS", sdk.BUILTIN_GATEWAY_MANIFESTS],
        ["BUILTIN_ADAPTER_VERSION", sdk.BUILTIN_ADAPTER_VERSION],
        [
          "generateGatewayCapabilitiesMarkdown",
          sdk.generateGatewayCapabilitiesMarkdown,
        ],
        ["CAPABILITY_DOCS_BANNER", sdk.CAPABILITY_DOCS_BANNER],
        // Phase 5 money primitives + currency helpers
        ["money", sdk.money],
        ["isMoney", sdk.isMoney],
        ["toMinorUnits", sdk.toMinorUnits],
        ["fromMinorUnits", sdk.fromMinorUnits],
        ["formatMoney", sdk.formatMoney],
        ["minorAmountToNumber", sdk.minorAmountToNumber],
        ["moneyToMajorNumber", sdk.moneyToMajorNumber],
        ["normalizeAmountInput", sdk.normalizeAmountInput],
        ["validateMoney", sdk.validateMoney],
        ["MoneyAmountError", sdk.MoneyAmountError],
        ["getCurrencyExponent", sdk.getCurrencyExponent],
        ["normalizeCurrencyCode", sdk.normalizeCurrencyCode],
        // Phase 6 operation outcomes + domain helpers
        ["mapGatewayResultToOperationResult", sdk.mapGatewayResultToOperationResult],
        ["applyOutcomeToGatewayResult", sdk.applyOutcomeToGatewayResult],
        ["applyOutcomeToGatewayRefundResult", sdk.applyOutcomeToGatewayRefundResult],
        ["successFromOutcome", sdk.successFromOutcome],
        ["isPaidOutcome", sdk.isPaidOutcome],
        ["isRequiresActionOutcome", sdk.isRequiresActionOutcome],
        ["isIndeterminateOutcome", sdk.isIndeterminateOutcome],
        ["isGatewayPaymentResult", sdk.isGatewayPaymentResult],
        ["inferOperationOutcome", sdk.inferOperationOutcome],
        ["paymentFromGatewayResult", sdk.paymentFromGatewayResult],
        ["paymentNextActionToAction", sdk.paymentNextActionToAction],
        ["toPaymentErrorLike", sdk.toPaymentErrorLike],
        ["buildProviderReferences", sdk.buildProviderReferences],
        ["isPaymentDomainStatus", sdk.isPaymentDomainStatus],
        ["isPaidLikePaymentStatus", sdk.isPaidLikePaymentStatus],
        ["PAYMENT_DOMAIN_STATUSES", sdk.PAYMENT_DOMAIN_STATUSES],
        ["PAID_LIKE_PAYMENT_STATUSES", sdk.PAID_LIKE_PAYMENT_STATUSES],
        ["successFromRefundOutcome", sdk.successFromRefundOutcome],
        ["inferRefundOperationOutcome", sdk.inferRefundOperationOutcome],
        ["mapGatewayRefundToOperationResult", sdk.mapGatewayRefundToOperationResult],
        // Phase 7 typed webhook / PaymentEvent model
        ["STABLE_PAYMENT_EVENT_TYPES", sdk.STABLE_PAYMENT_EVENT_TYPES],
        ["PAYMENT_EVENT_SCHEMA_VERSION", sdk.PAYMENT_EVENT_SCHEMA_VERSION],
        ["isStablePaymentEventType", sdk.isStablePaymentEventType],
        ["isPaymentEvent", sdk.isPaymentEvent],
        ["isPaymentSucceededEvent", sdk.isPaymentSucceededEvent],
        ["isPaymentFailedEvent", sdk.isPaymentFailedEvent],
        ["isRefundCompletedEvent", sdk.isRefundCompletedEvent],
        ["isProviderUnmappedEvent", sdk.isProviderUnmappedEvent],
        ["WEBHOOK_PAYLOAD_SECRET_KEYS", sdk.WEBHOOK_PAYLOAD_SECRET_KEYS],
        ["redactWebhookPayloadSecrets", sdk.redactWebhookPayloadSecrets],
        ["stableStringifyForHash", sdk.stableStringifyForHash],
        ["hashWebhookPayload", sdk.hashWebhookPayload],
        ["encryptRawWebhookPayload", sdk.encryptRawWebhookPayload],
        ["stripRawFromPaymentEvent", sdk.stripRawFromPaymentEvent],
        ["toPersistedPaymentEventEnvelope", sdk.toPersistedPaymentEventEnvelope],
        ["assertNoSecretsInEnvelope", sdk.assertNoSecretsInEnvelope],
        ["buildProviderEventMetadata", sdk.buildProviderEventMetadata],
        ["paymentFromWebhookEvent", sdk.paymentFromWebhookEvent],
        ["webhookEventToPaymentEvent", sdk.webhookEventToPaymentEvent],
        ["attachPaymentEvent", sdk.attachPaymentEvent],
        ["mapProviderEventTypeToStable", sdk.mapProviderEventTypeToStable],
        ["STRIPE_EVENT_TYPE_MAP", sdk.STRIPE_EVENT_TYPE_MAP],
        ["STRIPE_UNMAPPED_EVENT_TYPES", sdk.STRIPE_UNMAPPED_EVENT_TYPES],
        ["MOYASAR_EVENT_TYPE_MAP", sdk.MOYASAR_EVENT_TYPE_MAP],
        ["PAYPAL_EVENT_TYPE_MAP", sdk.PAYPAL_EVENT_TYPE_MAP],
        ["PAYMOB_TOKEN_EVENT_TYPES", sdk.PAYMOB_TOKEN_EVENT_TYPES],
        // Phase 20 OperationContext + redacting telemetry
        ["createOperationContext", sdk.createOperationContext],
        ["finalizeOperationContext", sdk.finalizeOperationContext],
        ["operationContextToTelemetryData", sdk.operationContextToTelemetryData],
      ];

      expect(runtimeExports).toHaveLength(148);
      for (const [exportName, value] of runtimeExports) {
        expect(value, exportName).toBeDefined();
        expect(sdk).toHaveProperty(exportName);
      }
      expect(sdk.PaymentClient).toBe(PaymentClient);
      expect(typeof sdk.noopLogger.debug).toBe("function");
      expect(typeof sdk.DEFAULT_RETRY_CONFIG.maxAttempts).toBe("number");
    });
  });

  describe("PaymentClient constructability", () => {
    it("is constructible with minimal moyasar config", () => {
      const client = new PaymentClient({
        moyasar: { secretKey: "sk_test_phase0_mock_secret" },
        defaultGateway: "moyasar",
      });
      expect(client).toBeInstanceOf(PaymentClient);
      expect(client.hasGateway("moyasar")).toBe(true);
      expect(client.configuredGateways()).toEqual(["moyasar"]);
    });

    it("constructs with each GatewayName config shape (mock secrets)", () => {
      const configs: Array<{
        name: GatewayName;
        config: ConstructorParameters<typeof PaymentClient>[0];
      }> = [
        {
          name: "moyasar",
          config: {
            moyasar: { secretKey: "sk_test_mock_moyasar" },
            defaultGateway: "moyasar",
          },
        },
        {
          name: "paypal",
          config: {
            paypal: {
              clientId: "paypal_client_id_mock",
              clientSecret: "paypal_client_secret_mock",
              sandbox: true,
            },
            defaultGateway: "paypal",
          },
        },
        {
          name: "paymob",
          config: {
            paymob: { secretKey: "paymob_secret_mock", publicKey: "pub_mock" },
            defaultGateway: "paymob",
          },
        },
        {
          name: "stripe",
          config: {
            stripe: {
              secretKey: "sk_test_mock_stripe",
              webhookSecret: "whsec_mock",
            },
            defaultGateway: "stripe",
          },
        },
      ];

      for (const { name, config } of configs) {
        const client = new PaymentClient(config);
        expect(client.hasGateway(name)).toBe(true);
        expect(client.configuredGateways()).toContain(name);
        // gateway() resolves without throwing for a configured name
        expect(client.gateway(name).name).toBe(name);
      }
    });

    it("constructs a multi-gateway client with all four gateways", () => {
      const client = new PaymentClient({
        moyasar: { secretKey: "sk_test_mock" },
        paypal: {
          clientId: "id_mock",
          clientSecret: "secret_mock",
        },
        paymob: { secretKey: "paymob_secret_mock" },
        stripe: { secretKey: "sk_test_stripe_mock" },
        defaultGateway: "moyasar",
      });
      expect(client.configuredGateways().sort()).toEqual(
        ["moyasar", "paymob", "paypal", "stripe"].sort(),
      );
    });
  });

  describe("createPaymentClient plugin path", () => {
    it("constructs from built-in adapter factories", () => {
      const client = sdk.createPaymentClient({
        gateways: {
          moyasar: sdk.moyasarGateway({ secretKey: "sk_test_mock_moyasar" }),
          stripe: sdk.stripeGateway({ secretKey: "sk_test_mock_stripe" }),
        },
        defaultGateway: "moyasar",
      });
      expect(client.hasGateway("moyasar")).toBe(true);
      expect(client.hasGateway("stripe")).toBe(true);
      expect(client.gateway("moyasar").name).toBe("moyasar");
      expect(client.gateway("stripe").name).toBe("stripe");
    });

    it("constructs from a built registry", () => {
      const registry = sdk
        .createGatewayRegistry()
        .register(sdk.stripeGateway({ secretKey: "sk_test_reg" }))
        .build();
      const client = sdk.createPaymentClient({
        registry,
        defaultGateway: "stripe",
      });
      expect(client.configuredGateways()).toEqual(["stripe"]);
    });
  });

  describe("error classes constructability", () => {
    it("constructs PaymentError and subclasses with instanceof PaymentError", () => {
      const cases: PaymentError[] = [
        new PaymentError("base", "BASE_CODE", 500),
        new PaymentAbortedError("aborted by hook"),
        new GatewayNotConfiguredError("moyasar"),
        new OperationNotSupportedError("moyasar", "voidPayment"),
        new InvalidWebhookError("bad signature"),
        new GatewayApiError("upstream failed", "stripe", { status: 502 }),
        new CardDeclinedError("declined"),
        new InsufficientFundsError("nsf"),
        new AuthenticationError("auth failed"),
        new RateLimitError("stripe", 30),
        new ResourceNotFoundError("missing"),
        new InvalidRequestError("invalid field"),
        new NetworkError("timeout"),
      ];

      for (const err of cases) {
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(PaymentError);
        expect(typeof err.message).toBe("string");
        expect(typeof err.code).toBe("string");
        expect(typeof err.statusCode).toBe("number");
      }

      expect(new PaymentAbortedError().name).toBe("PaymentAbortedError");
      expect(new GatewayNotConfiguredError("paypal").code).toBe(
        "GATEWAY_NOT_CONFIGURED",
      );
      expect(new RateLimitError("paypal", 12).retryAfterSeconds).toBe(12);

      const opErr = new OperationNotSupportedError("moyasar", "voidPayment", {
        capability: "voids",
        claimedSupport: false,
      });
      expect(opErr.gatewayName).toBe("moyasar");
      expect(opErr.operation).toBe("voidPayment");
      expect(opErr.capability).toBe("voids");
      expect(opErr.claimedSupport).toBe(false);
    });
  });

  describe("runtime helpers", () => {
    it("redact and noopLogger are usable", () => {
      const redacted = redact({ secretKey: "sk_live_xxx", amount: 10 });
      expect(redacted).toBeDefined();
      // noopLogger must accept all levels without throwing
      noopLogger.debug("d");
      noopLogger.info("i");
      noopLogger.warn("w");
      noopLogger.error("e");
      const wrapped = createRedactingLogger(noopLogger);
      expect(typeof wrapped.info).toBe("function");
    });

    it("withRetry, fingerprintParams, InMemoryIdempotencyStore work", async () => {
      const result = await withRetry(async () => 42, {
        isRetryable: () => false,
        config: { maxAttempts: 1 },
      });
      expect(result).toBe(42);
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBeGreaterThan(0);
      expect(parseRetryAfterSeconds(new Headers())).toBeUndefined();

      const fp = fingerprintParams({ a: 1, b: "x" });
      expect(typeof fp).toBe("string");
      expect(fp.length).toBeGreaterThan(0);

      const store = new InMemoryIdempotencyStore();
      store.set("k1", {
        fingerprint: "fp",
        status: "completed",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });
      expect(store.get("k1")?.status).toBe("completed");
      store.delete("k1");
      expect(store.get("k1")).toBeUndefined();
    });

    it("Moyasar source type guards work", () => {
      const card: CreditCardSource = {
        type: "creditcard",
        name: "Test User",
        number: "4111111111111111",
        cvc: "123",
        month: 12,
        year: 2030,
      };
      expect(isCreditCardSource(card)).toBe(true);
      expect(isCardTokenSource({ type: "token", token: "tok_x" })).toBe(true);
      expect(isApplePaySource({ type: "applepay", token: "ap_tok" })).toBe(
        true,
      );
      expect(
        isSamsungPaySource({ type: "samsungpay", token: "sp_tok" }),
      ).toBe(true);
      expect(isStcPaySource({ type: "stcpay", mobile: "05xxxxxxxx" })).toBe(
        true,
      );
    });

    it("money helpers convert major units via bigint", () => {
      const m = sdk.money("10.50", "SAR");
      expect(sdk.isMoney(m)).toBe(true);
      expect(m.amount).toBe("10.50");
      expect(m.currency).toBe("SAR");
      expect(sdk.toMinorUnits(m)).toBe(1050n);
      expect(sdk.fromMinorUnits(1050n, "SAR").amount).toBe("10.50");
      expect(sdk.minorAmountToNumber(1050n)).toBe(1050);
      expect(sdk.getCurrencyExponent("JPY")).toBe(0);
      expect(sdk.normalizeCurrencyCode("sar")).toBe("SAR");
      expect(sdk.formatMoney(m)).toBe("10.50 SAR");
      // Deprecated number path still works for clean decimals
      expect(sdk.normalizeAmountInput(10.5, "SAR").amount).toBe("10.50");
    });

    it("HooksManager and gateway classes are constructible", () => {
      const hooks = new HooksManager();
      expect(hooks).toBeInstanceOf(HooksManager);

      const moyasar = new MoyasarGateway(
        { secretKey: "sk_test_mock" },
        hooks,
        noopLogger,
      );
      const paypal = new PayPalGateway(
        {
          clientId: "id",
          clientSecret: "secret",
          sandbox: true,
        },
        hooks,
        noopLogger,
      );
      const paymob = new PaymobGateway(
        { secretKey: "paymob_secret" },
        hooks,
        noopLogger,
      );
      const stripe = new StripeGateway(
        { secretKey: "sk_test_stripe" },
        hooks,
        noopLogger,
      );

      expect(moyasar).toBeInstanceOf(BaseGateway);
      expect(paypal).toBeInstanceOf(BaseGateway);
      expect(paymob).toBeInstanceOf(BaseGateway);
      expect(stripe).toBeInstanceOf(BaseGateway);

      // Phase 3 Stream B: built-ins declare conservative capability claims
      for (const gw of [moyasar, paypal, paymob, stripe]) {
        expect(gw.capabilities).toBeDefined();
        expect(Object.isFrozen(gw.capabilities)).toBe(true);
        expect(typeof gw.supports).toBe("function");
        expect(gw.supports("payments")).toBe(true);
        expect(gw.supports("refunds")).toBe(true);
        expect(gw.supports("voids")).toBe(true);
        expect(gw.supports("providerRecurring")).toBe(false);
        expect(gw.supports("disputes")).toBe(false);
        expect(gw.supports("paymentLinks")).toBe(false);
      }
      expect(stripe.supports("hostedCheckout")).toBe(true);
      expect(moyasar.supports("hostedCheckout")).toBe(false);
      expect(paypal.supports("hostedCheckout")).toBe(false);
      expect(paymob.supports("hostedCheckout")).toBe(false);
      expect(moyasar.supports("marketplaceSplits")).toBe(true);
      expect(stripe.supports("marketplaceSplits")).toBe(false);
      expect(moyasar.name).toBe("moyasar");
      expect(paypal.name).toBe("paypal");
      expect(paymob.name).toBe("paymob");
      expect(stripe.name).toBe("stripe");
    });
  });
});
