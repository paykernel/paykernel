import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { PaymobGateway } from "./paymob.gateway";
import { HooksManager } from "../../hooks/hooks.manager";
import {
  AuthenticationError,
  GatewayApiError,
  InvalidRequestError,
  InvalidWebhookError,
  InsufficientFundsError,
  NetworkError,
  PaymentError,
  RateLimitError,
  ResourceNotFoundError,
} from "../../errors";
import type { PaymobConfig, PaymobIdempotencyRecord, PaymobIdempotencyStore } from "../../types/config.types";
import type { HookContext } from "../../hooks/hooks.types";
import type { CreatePaymentParams } from "../../types/payment.types";
import type { PaymobCardTokenWebhookPayload, PaymobWebhookPayload } from "../../types/webhook.types";
import {
  assertNoSecretsInEnvelope,
  toPersistedPaymentEventEnvelope,
} from "../../types/payment-event";
import type { Logger } from "../../utils/logger";
import { money } from "../../utils/money";
import { isPaidOutcome } from "../../types/operation-result";

const PAYMOB_TEST_CONFIG: PaymobConfig = {
  secretKey: "sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  publicKey: "pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  hmacSecret: "test_hmac_secret_key",
  region: "ksa",
  integrationId: "123456",
};

/** Legacy post-pay only (apiKey, no secretKey) — exercises /api/auth/tokens path. */
const PAYMOB_ACTION_CONFIG: PaymobConfig = {
  apiKey: "api_key_xxxxxxxxxxxxxxxxxxxxxxxx",
  region: "ksa",
};

/** Both secretKey and apiKey — secretKey Token auth must be preferred. */
const PAYMOB_BOTH_KEYS_CONFIG: PaymobConfig = {
  ...PAYMOB_TEST_CONFIG,
  apiKey: "api_key_xxxxxxxxxxxxxxxxxxxxxxxx",
};

const PAYMOB_AUTH_CONFIG: PaymobConfig = {
  ...PAYMOB_TEST_CONFIG,
  authIntegrationId: "auth-card",
};

const PAYMOB_LEGACY_CONFIG: PaymobConfig = {
  apiKey: "legacy_api_key_xxxxxxxxxxxxxxxxxxxxxxxx",
  region: "eg",
  integrationId: "654321",
  iframeId: "998877",
};

const VALID_CREATE_PARAMS: CreatePaymentParams = {
  amount: 100,
  currency: "SAR",
  callbackUrl: "https://example.com/webhook",
  returnUrl: "https://example.com/success",
  orderId: "order_123",
  metadata: {
    paymentId: "payment_123",
    tenantId: "tenant_123",
    email: "customer@example.com",
    firstName: "Mohammed",
    lastName: "Ali",
    phone: "+966500000000",
  },
};

let hooksManager: HooksManager;
let gateway: PaymobGateway;
let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }>;

class MemoryIdempotencyStore implements PaymobIdempotencyStore {
  readonly records = new Map<string, PaymobIdempotencyRecord>();

  reserve(key: string, record: PaymobIdempotencyRecord): PaymobIdempotencyRecord | undefined {
    const existing = this.records.get(key);
    if (existing) {
      return existing;
    }
    this.records.set(key, record);
    return undefined;
  }

  get(key: string): PaymobIdempotencyRecord | undefined {
    return this.records.get(key);
  }

  set(key: string, record: PaymobIdempotencyRecord): void {
    this.records.set(key, record);
  }

  delete(key: string): void {
    this.records.delete(key);
  }
}

class ExpiredThenContendedIdempotencyStore implements PaymobIdempotencyStore {
  readonly deleted: string[] = [];
  reserveCalls = 0;

  async reserve(_key: string, record: PaymobIdempotencyRecord): Promise<PaymobIdempotencyRecord | undefined> {
    this.reserveCalls += 1;
    if (this.reserveCalls === 1) {
      return {
        ...record,
        status: "completed",
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000,
        result: { gatewayId: "expired_completed" },
      };
    }

    return {
      ...record,
      status: "in_progress",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
  }

  get(_key: string): PaymobIdempotencyRecord | undefined {
    return undefined;
  }

  set(_key: string, _record: PaymobIdempotencyRecord): void {
    // Not used by this regression test.
  }

  delete(key: string): void {
    this.deleted.push(key);
  }
}

class FailingSetIdempotencyStore extends MemoryIdempotencyStore {
  setCalls = 0;

  set(_key: string, _record: PaymobIdempotencyRecord): void {
    this.setCalls += 1;
    throw new Error("idempotency store write failed");
  }
}

/** Fresh store with atomic reserve() — required for capture/refund/void. */
function withMutationFence(config: PaymobConfig = PAYMOB_ACTION_CONFIG): PaymobConfig {
  return { ...config, idempotencyStore: new MemoryIdempotencyStore() };
}

let mutationKeySeq = 0;
function nextMutationKey(label = "mut"): string {
  mutationKeySeq += 1;
  return `${label}_${mutationKeySeq}`;
}

function createMockWebhookPayload(
  overrides: Partial<PaymobWebhookPayload["obj"]> = {},
): PaymobWebhookPayload {
  return {
    type: "TRANSACTION",
    obj: {
      id: 123456789,
      pending: false,
      success: true,
      amount_cents: 10000,
      currency: "SAR",
      created_at: "2024-12-31T12:00:00Z",
      is_auth: false,
      is_capture: false,
      is_void: false,
      is_refund: false,
      is_standalone_payment: true,
      has_parent_transaction: false,
      error_occured: false,
      is_3d_secure: true,
      integration_id: 123456,
      profile_id: 789,
      owner: 302852,
      source_data: {
        type: "card",
        pan: "2346",
        sub_type: "MADA",
      },
      order: {
        id: 987654,
        merchant_order_id: "order_abc123",
      },
      transaction_id: "txn_xyz789",
      data_message: "Approved",
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 200): Response {
  return new Response("", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(status = 200): Response {
  return new Response("<html><body>upstream</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

/** Logger that records warn/error calls as [message, context?] tuples. */
function fakeClock(startMs: number): {
  now(): Date;
  nowMs(): number;
  advance(ms: number): void;
} {
  let current = startMs;
  return {
    now: () => new Date(current),
    nowMs: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

function captureLogger(sink: unknown[][]): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: (message: string, context?: Record<string, unknown>) => {
      sink.push(context === undefined ? [message] : [message, context]);
    },
    error: (message: string, context?: Record<string, unknown>) => {
      sink.push(context === undefined ? [message] : [message, context]);
    },
  };
}

function mockFetchSequence(...responses: Array<Response | Error>): void {
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    const response = responses[index++];
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error("Unexpected fetch call");
    }
    return response;
  }) as typeof fetch;
}

function signPayload(payload: PaymobWebhookPayload, hmacSecret = PAYMOB_TEST_CONFIG.hmacSecret!): string {
  const dataString = (gateway as unknown as {
    buildHmacString(obj: PaymobWebhookPayload["obj"]): string;
  }).buildHmacString(payload.obj);

  return createHmac("sha512", hmacSecret).update(dataString).digest("hex");
}

function signCardTokenPayload(
  payload: PaymobCardTokenWebhookPayload,
  hmacSecret = PAYMOB_TEST_CONFIG.hmacSecret!,
): string {
  const dataString = (gateway as unknown as {
    buildCardTokenHmacString(obj: PaymobCardTokenWebhookPayload["obj"]): string;
  }).buildCardTokenHmacString(payload.obj);

  return createHmac("sha512", hmacSecret).update(dataString).digest("hex");
}

function signRedirectPayload(
  payload: Record<string, unknown>,
  hmacSecret = PAYMOB_TEST_CONFIG.hmacSecret!,
): string {
  const dataString = (gateway as unknown as {
    buildRedirectHmacString(obj: Record<string, unknown>): string;
  }).buildRedirectHmacString(payload);

  return createHmac("sha512", hmacSecret).update(dataString).digest("hex");
}

describe("PaymobGateway", () => {
  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  beforeEach(() => {
    fetchCalls = [];
    hooksManager = new HooksManager({});
    gateway = new PaymobGateway(withMutationFence(PAYMOB_TEST_CONFIG), hooksManager);
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Configuration", () => {
    it("uses KSA base URL by default", () => {
      const ksaGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: undefined } as PaymobConfig,
        hooksManager,
      );

      expect((ksaGateway as any).baseUrl).toBe("https://ksa.paymob.com");
    });

    it("uses Egypt base URL for eg region", () => {
      const egGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      expect((egGateway as any).baseUrl).toBe("https://accept.paymob.com");
    });

    it("uses custom base URL without trailing slash", () => {
      const customGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, baseUrl: "https://custom.paymob.com/" },
        hooksManager,
      );

      expect((customGateway as any).baseUrl).toBe("https://custom.paymob.com");
    });

    it("uses current UAE base URL", () => {
      const aeGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: "ae" },
        hooksManager,
      );

      expect((aeGateway as any).baseUrl).toBe("https://uae.paymob.com");
    });

    it("warns when secretKey is set without hmacSecret", () => {
      const warnings: unknown[][] = [];
      new PaymobGateway(
        {
          secretKey: "sk_test_no_hmac",
          publicKey: "pk_test_no_hmac",
          region: "ksa",
          integrationId: "123456",
        },
        hooksManager,
        captureLogger(warnings),
      );

      expect(warnings.some((entry) =>
        String(entry[0]).includes("hmacSecret") && String(entry[0]).includes("fail closed"),
      )).toBe(true);
    });

    it("warns when the idempotency store lacks atomic reserve()", () => {
      const warnings: unknown[][] = [];
      const storeWithoutReserve: PaymobIdempotencyStore = {
        get: () => undefined,
        set: () => {},
        delete: () => {},
      };
      new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore: storeWithoutReserve },
        hooksManager,
        captureLogger(warnings),
      );

      expect(warnings.some((entry) =>
        String(entry[0]).includes("atomic reserve"),
      )).toBe(true);
    });

    it("does not warn about atomic reserve when the store implements reserve()", () => {
      const warnings: unknown[][] = [];
      new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore: new MemoryIdempotencyStore() },
        hooksManager,
        captureLogger(warnings),
      );

      expect(warnings.some((entry) =>
        String(entry[0]).includes("atomic reserve"),
      )).toBe(false);
    });

    it("does not warn about missing hmacSecret when hmacSecret is configured", () => {
      const warnings: unknown[][] = [];
      new PaymobGateway(
        PAYMOB_TEST_CONFIG,
        hooksManager,
        captureLogger(warnings),
      );

      expect(warnings.some((entry) => String(entry[0]).includes("hmacSecret"))).toBe(false);
    });
  });

  describe("createPayment", () => {
    it("creates an Intention payment with Token auth, payment methods, and safe redirect handling", async () => {
      mockFetchSequence(jsonResponse({
        id: "pi_test_123",
        client_secret: "csk_test_123",
        status: "intended",
      }));

      const result = await gateway.createPayment(VALID_CREATE_PARAMS);
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(fetchCalls[0]!.url).toBe("https://ksa.paymob.com/v1/intention/");
      expect(fetchCalls[0]!.init!.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Token ${PAYMOB_TEST_CONFIG.secretKey}`,
      });
      expect(requestBody.amount).toBe(10000);
      expect(requestBody.payment_methods).toEqual([123456]);
      expect(requestBody.billing_data.email).toBe("customer@example.com");
      expect(requestBody.redirection_url).toBe("https://example.com/success");
      expect(result.gatewayId).toBe("pi_test_123");
      expect(result.redirectUrl).toBe(
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&clientSecret=csk_test_123",
      );
      expect(result.nextAction).toEqual({
        type: "redirect",
        checkoutUrl: result.redirectUrl,
        intentionId: "pi_test_123",
        clientSecret: "csk_test_123",
        paymentKeys: undefined,
      });
      // Phase 6: intention checkout is requires_action, never succeeded
      expect(result.outcome).toBe("requires_action");
      expect(result.outcome).not.toBe("succeeded");
      expect(result.success).toBe(true);
      expect(result.status).toBe("pending");
      expect(result.references?.providerObjectId).toBe("pi_test_123");
    });

    it("uses ISO minor units for OMR instead of assuming two decimals", async () => {
      const omGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: "om", integrationId: 158 },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_omr_123", client_secret: "oman_csk_test_123" }));

      await omGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 20.125,
        currency: "OMR",
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(fetchCalls[0]!.url).toBe("https://oman.paymob.com/v1/intention/");
      expect(requestBody.amount).toBe(20125);
    });

    it("rejects Paymob amounts below the currency minor unit before sending requests", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 0.004,
        currency: "SAR",
      })).rejects.toThrow(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects Paymob amounts with more precision than the currency supports", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 10.001,
        currency: "SAR",
      })).rejects.toThrow(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("accepts Money amount input for createPayment", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_money_123", client_secret: "csk_money_123" }));

      await gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: money("10.50", "SAR"),
        currency: "SAR",
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.amount).toBe(1050);
    });

    it("normalizes currency to uppercase before sending Intention requests", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        currency: "sar",
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.currency).toBe("SAR");
      expect(requestBody.amount).toBe(10000);
    });

    it("encodes Unified Checkout query parameters", async () => {
      const encodedGateway = new PaymobGateway(
        {
          ...PAYMOB_TEST_CONFIG,
          publicKey: "pk_test_with/+==",
        },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_with/+==" }));

      const result = await encodedGateway.createPayment(VALID_CREATE_PARAMS);

      expect(result.redirectUrl).toBe(
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk_test_with%2F%2B%3D%3D&clientSecret=csk_test_with%2F%2B%3D%3D",
      );
    });

    it("preserves Paymob payment method aliases instead of turning them into NaN", async () => {
      const aliasGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, integrationId: "card" },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await aliasGateway.createPayment(VALID_CREATE_PARAMS);
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.payment_methods).toEqual(["card"]);
    });

    it("warns when per-payment callbacks are used with explicit non-card aliases", async () => {
      const warnings: unknown[][] = [];
      const warnGateway = new PaymobGateway(
        PAYMOB_TEST_CONFIG,
        hooksManager,
        captureLogger(warnings),
      );
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await warnGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        paymobPaymentMethods: ["wallet"],
      });

      expect(warnings.some((entry) =>
        String(entry[0]).includes("notification_url/redirection_url"),
      )).toBe(true);
    });

    it("uses the configured auth integration when capture is false", async () => {
      const authGateway = new PaymobGateway(PAYMOB_AUTH_CONFIG, hooksManager);
      mockFetchSequence(jsonResponse({ id: "pi_auth_123", client_secret: "csk_auth_123" }));

      await authGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        capture: false,
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.payment_methods).toEqual(["auth-card"]);
      expect(requestBody.is_auth).toBe(true);
      expect(requestBody.payment_type).toBe("AUTH");
    });

    it("sets is_auth true and payment_type AUTH on Intention body when capture is false (dual auth model)", async () => {
      const authGateway = new PaymobGateway(PAYMOB_AUTH_CONFIG, hooksManager);
      mockFetchSequence(jsonResponse({ id: "pi_auth_456", client_secret: "csk_auth_456" }));

      await authGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        capture: false,
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.is_auth).toBe(true);
      expect(requestBody.payment_type).toBe("AUTH");
      expect(requestBody.payment_methods).toEqual(["auth-card"]);
    });

    it("does not set is_auth or payment_type on Intention body for normal capture payments", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gateway.createPayment(VALID_CREATE_PARAMS);
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.is_auth).toBeUndefined();
      expect(requestBody.payment_type).toBeUndefined();
    });

    it("does not fall back to sale integrationId when capture is false and authIntegrationId is missing", async () => {
      // PAYMOB_TEST_CONFIG has integrationId but no authIntegrationId — must not
      // silently settle via the sale integration (PAYMOB-4).
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        capture: false,
      })).rejects.toThrow(GatewayApiError);
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        capture: false,
      })).rejects.toThrow(/authIntegrationId|integration-driven/i);
      expect(fetchCalls).toHaveLength(0);
    });

    it("fails loudly when capture is false and neither authIntegrationId nor integrationId is configured", async () => {
      const noIntegrationGateway = new PaymobGateway(
        {
          secretKey: PAYMOB_TEST_CONFIG.secretKey,
          publicKey: PAYMOB_TEST_CONFIG.publicKey,
          hmacSecret: PAYMOB_TEST_CONFIG.hmacSecret,
          region: "ksa",
        },
        hooksManager,
      );

      await expect(noIntegrationGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        capture: false,
      })).rejects.toThrow(GatewayApiError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("applies currencyExponentOverrides for minor-unit conversion", async () => {
      const overrideGateway = new PaymobGateway(
        {
          ...PAYMOB_TEST_CONFIG,
          region: "om",
          // Force OMR to 2 decimals instead of ISO 3 for accounts that document it.
          currencyExponentOverrides: { OMR: 2 },
        },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_omr_override", client_secret: "oman_csk_override" }));

      await overrideGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 20.12,
        currency: "OMR",
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.amount).toBe(2012);
    });

    it("applies case-insensitive currencyExponentOverrides keys", async () => {
      const overrideGateway = new PaymobGateway(
        {
          ...PAYMOB_TEST_CONFIG,
          region: "om",
          // Lowercase key must still apply (shared getCurrencyExponent lookup).
          currencyExponentOverrides: { omr: 2 },
        },
        hooksManager,
      );
      mockFetchSequence(
        jsonResponse({ id: "pi_omr_ci", client_secret: "oman_csk_ci" }),
      );

      await overrideGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 20.12,
        currency: "OMR",
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);
      expect(requestBody.amount).toBe(2012);
    });

    it("throws when currencyExponentOverrides value is invalid", async () => {
      const overrideGateway = new PaymobGateway(
        {
          ...PAYMOB_TEST_CONFIG,
          region: "om",
          currencyExponentOverrides: { OMR: -1 },
        },
        hooksManager,
      );

      await expect(
        overrideGateway.createPayment({
          ...VALID_CREATE_PARAMS,
          amount: 20.12,
          currency: "OMR",
        }),
      ).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("uses idempotencyKey as special_reference when no payment/order reference is provided", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gateway.createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/webhook",
        idempotencyKey: "idem_123",
        paymobBillingData: {
          email: "customer@example.com",
          firstName: "Mohammed",
          lastName: "Ali",
          phone: "+966500000000",
        },
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.special_reference).toBe("idem_123");
      expect(requestBody.extras.idempotencyKey).toBe("idem_123");
    });

    it("allows Paymob Intention creation without per-payment notification_url", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gateway.createPayment({
        amount: 100,
        currency: "SAR",
        paymobBillingData: {
          email: "customer@example.com",
          firstName: "Mohammed",
          lastName: "Ali",
          phone: "+966500000000",
        },
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.notification_url).toBeUndefined();
    });

    it("treats malformed successful Intention responses as indeterminate (PAYMOB-2)", async () => {
      mockFetchSequence(jsonResponse({ status: "intended" }));

      const result = await gateway.createPayment(VALID_CREATE_PARAMS);
      expect(result.outcome).toBe("indeterminate");
      expect(result.reconciliationRequired).toBe(true);
    });

    it("keeps the idempotency fence after Intention HTTP 200 with empty id (PAYMOB-2)", async () => {
      mockFetchSequence(
        jsonResponse({}),
        jsonResponse({ id: "pi_second", client_secret: "csk_second" }),
      );
      const params = {
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "intention_200_empty_id",
      };

      const first = await gateway.createPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(first.reconciliationRequired).toBe(true);

      await expect(gateway.createPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(1);
    });

    it("keeps the idempotency fence after Intention HTTP 200 with missing checkout URL (PAYMOB-2)", async () => {
      mockFetchSequence(
        jsonResponse({ id: "pi_no_url" }),
        jsonResponse({ id: "pi_second", client_secret: "csk_second" }),
      );
      const params = {
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "intention_200_missing_url",
      };

      const first = await gateway.createPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(first.reconciliationRequired).toBe(true);

      await expect(gateway.createPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(1);
    });

    it("rejects invalid billing metadata before sending Paymob requests", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        metadata: {
          ...VALID_CREATE_PARAMS.metadata,
          email: "not-an-email",
        },
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("does not send fake billing data when required customer fields are missing", async () => {
      await expect(
        gateway.createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/webhook",
        }),
      ).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("requires both secretKey and publicKey for Intention checkout", async () => {
      const incompleteGateway = new PaymobGateway(
        { secretKey: "sk_test_only", region: "ksa", integrationId: "123456" },
        hooksManager,
      );

      await expect(incompleteGateway.createPayment(VALID_CREATE_PARAMS)).rejects.toThrow(GatewayApiError);
    });

    it("creates a legacy iframe payment with apiKey, integrationId, and iframeId", async () => {
      const legacyGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 777 }),
        jsonResponse({ token: "payment_key_123" }),
      );

      const result = await legacyGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        currency: "EGP",
      });

      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://accept.paymob.com/api/auth/tokens",
        "https://accept.paymob.com/api/ecommerce/orders",
        "https://accept.paymob.com/api/acceptance/payment_keys",
      ]);
      // S19-PAYMOB-LEGACY-ID: ecommerce order id stays on orderId / nextAction only.
      expect(result.gatewayId).not.toBe("777");
      expect(result.gatewayId).not.toMatch(/^\d+$/);
      expect(result.gatewayId).toBe("legacy:777");
      expect(result.gatewayObjectId).toBeUndefined();
      expect(result.orderId).toBe("777");
      expect(result.nextAction).toEqual({
        type: "redirect",
        checkoutUrl: result.redirectUrl,
        orderId: "777",
        paymentToken: "payment_key_123",
      });
      expect(result.redirectUrl).toBe(
        "https://accept.paymob.com/api/acceptance/iframes/998877?payment_token=payment_key_123",
      );

      fetchCalls = [];
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      await expect(
        actionGateway.getPayment({ gatewayPaymentId: result.gatewayId }),
      ).rejects.toThrow(InvalidRequestError);
      await expect(
        actionGateway.refundPayment({
          gatewayPaymentId: result.gatewayId,
          idempotencyKey: nextMutationKey(),
        }),
      ).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("URL-encodes legacy iframe payment tokens", async () => {
      const legacyGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 777 }),
        jsonResponse({ token: "payment/key+123==" }),
      );

      const result = await legacyGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        currency: "EGP",
      });

      expect(result.redirectUrl).toBe(
        "https://accept.paymob.com/api/acceptance/iframes/998877?payment_token=payment%2Fkey%2B123%3D%3D",
      );
    });

    it("keeps the idempotency fence after legacy HTTP 200 missing payment token (PAYMOB-FENCE-3)", async () => {
      const legacyGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 777 }),
        jsonResponse({}),
        jsonResponse({ token: "payment_key_retry" }),
      );
      const params = {
        ...VALID_CREATE_PARAMS,
        currency: "EGP",
        idempotencyKey: "legacy_200_missing_token",
      };

      const first = await legacyGateway.createPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(first.reconciliationRequired).toBe(true);

      await expect(legacyGateway.createPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://accept.paymob.com/api/auth/tokens",
        "https://accept.paymob.com/api/ecommerce/orders",
        "https://accept.paymob.com/api/acceptance/payment_keys",
      ]);
    });

    it("keeps the create fence after legacy Orders 200 then Payment Keys 408 (NEW-PAYMOB-4XX)", async () => {
      const legacyGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 777 }),
        jsonResponse({ message: "Request Timeout" }, 408),
        jsonResponse({ token: "auth_token_retry" }),
        jsonResponse({ id: 888 }),
        jsonResponse({ token: "payment_key_second_order" }),
      );
      const params = {
        ...VALID_CREATE_PARAMS,
        currency: "EGP",
        idempotencyKey: "legacy_orders_200_payment_keys_408",
      };

      const first = await legacyGateway.createPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(first.reconciliationRequired).toBe(true);

      await expect(legacyGateway.createPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://accept.paymob.com/api/auth/tokens",
        "https://accept.paymob.com/api/ecommerce/orders",
        "https://accept.paymob.com/api/acceptance/payment_keys",
      ]);
      expect(
        fetchCalls.filter((call) => call.url.endsWith("/api/ecommerce/orders")),
      ).toHaveLength(1);
    });

    it("keeps the idempotency fence after legacy HTTP 200 missing order id (PAYMOB-FENCE-3)", async () => {
      const legacyGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({}),
        jsonResponse({ id: 888 }),
        jsonResponse({ token: "payment_key_retry" }),
      );
      const params = {
        ...VALID_CREATE_PARAMS,
        currency: "EGP",
        idempotencyKey: "legacy_200_missing_order_id",
      };

      const first = await legacyGateway.createPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(first.reconciliationRequired).toBe(true);

      await expect(legacyGateway.createPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://accept.paymob.com/api/auth/tokens",
        "https://accept.paymob.com/api/ecommerce/orders",
      ]);
    });

    it("rejects whitespace-only Paymob payment method overrides", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        paymobPaymentMethods: ["   "],
      })).rejects.toThrow(InvalidRequestError);
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        paymobIntegrationId: "   ",
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("payment management APIs", () => {
    it("requires secretKey or apiKey for capture/refund/void/getPayment", async () => {
      const noCredsGateway = new PaymobGateway(
        withMutationFence({ region: "ksa", hmacSecret: "test_hmac" } as PaymobConfig),
        hooksManager,
      );

      await expect(noCredsGateway.capturePayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() })).rejects.toThrow(PaymentError);
      await expect(noCredsGateway.refundPayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() })).rejects.toThrow(PaymentError);
      await expect(noCredsGateway.voidPayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() })).rejects.toThrow(PaymentError);
      await expect(noCredsGateway.getPayment({ gatewayPaymentId: "123456789" })).rejects.toThrow(PaymentError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("uses secretKey Token auth for capture without apiKey or body auth_token", async () => {
      // Default gateway has secretKey only (no apiKey).
      mockFetchSequence(
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 5000 }),
      );

      const result = await gateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/capture",
      ]);
      expect(fetchCalls[0]!.init!.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Token ${PAYMOB_TEST_CONFIG.secretKey}`,
      });
      expect(fetchCalls[1]!.init!.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Token ${PAYMOB_TEST_CONFIG.secretKey}`,
      });
      const captureBody = JSON.parse(fetchCalls[1]!.init!.body as string);
      expect(captureBody).toEqual({
        transaction_id: 123456789,
        amount_cents: 5000,
      });
      expect(typeof captureBody.transaction_id).toBe("number");
      // Partial capture is open money — not outcome-succeeded / not isPaidOutcome
      expect(result.status).toBe("partially_captured");
      expect(result.outcome).toBe("requires_action");
      expect(result.success).toBe(true);
      expect(isPaidOutcome(result)).toBe(false);
      // PAYMOB-2: gatewayId is the parent payment/txn id (not child capture response id).
      expect(result.gatewayId).toBe("123456789");
      expect(result.references?.providerObjectId).toBe("123456789");
      // Distinct child capture txn id is dual-written on captureId only.
      expect(result.captureId).toBe("123");
      expect(result.references?.relatedIds?.captureId).toBe("123");
      expect(result.currency).toBe("SAR");
      expect(captureBody.auth_token).toBeUndefined();
    });

    it("uses secretKey Token auth for refund, void, and getPayment without apiKey", async () => {
      mockFetchSequence(
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
        jsonResponse({ id: 123, success: true }),
        jsonResponse({
          id: 123456789,
          success: true,
          pending: false,
          amount_cents: 10000,
          currency: "SAR",
        }),
      );

      await gateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });
      await gateway.voidPayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() });
      await gateway.getPayment({ gatewayPaymentId: "123456789" });

      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
        "https://ksa.paymob.com/api/acceptance/void_refund/void",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
      ]);

      const refundBody = JSON.parse(fetchCalls[1]!.init!.body as string);
      expect(refundBody.auth_token).toBeUndefined();
      expect(refundBody).toEqual({
        transaction_id: 123456789,
        amount_cents: 5000,
      });
      expect(typeof refundBody.transaction_id).toBe("number");

      const voidBody = JSON.parse(fetchCalls[2]!.init!.body as string);
      expect(voidBody).toEqual({ transaction_id: 123456789 });
      expect(typeof voidBody.transaction_id).toBe("number");

      for (const call of fetchCalls) {
        expect(call.init!.headers).toEqual({
          "Content-Type": "application/json",
          Authorization: `Token ${PAYMOB_TEST_CONFIG.secretKey}`,
        });
      }
    });

    it("prefers secretKey Token auth over apiKey when both are configured", async () => {
      const bothGateway = new PaymobGateway(withMutationFence(PAYMOB_BOTH_KEYS_CONFIG), hooksManager);
      mockFetchSequence(
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 10000 }),
      );

      await bothGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 100,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(fetchCalls.some((call) => call.url.endsWith("/api/auth/tokens"))).toBe(false);
      expect(fetchCalls[1]!.init!.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Token ${PAYMOB_BOTH_KEYS_CONFIG.secretKey}`,
      });
      const captureBody = JSON.parse(fetchCalls[1]!.init!.body as string);
      expect(captureBody.auth_token).toBeUndefined();
    });

    it("falls back to legacy apiKey auth_token path when secretKey is missing", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 5000 }),
      );

      await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/capture",
      ]);
      expect(fetchCalls[1]!.init!.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer auth_token_123",
      });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);
      expect(captureBody).toEqual({
        auth_token: "auth_token_123",
        transaction_id: 123456789,
        amount_cents: 5000,
      });
      expect(typeof captureBody.transaction_id).toBe("number");
    });

    it("wraps auth network failures as NetworkError", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(new Error("socket closed"));

      await expect(actionGateway.capturePayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() })).rejects.toThrow(NetworkError);
    });

    it("maps failed refund responses to failed results", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: false, pending: false }),
      );

      const result = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("failed");
      expect(result.status).toBe("failed");
    });

    it("maps pending refund responses to pending even when success is true", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, pending: true }),
      );

      const result = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("pending");
      expect(result.status).toBe("pending");
      // PAYMOB-1: pending must not invent totalRefunded (do not over-book ledger).
      expect(result.totalRefunded).toBeUndefined();
    });

    it("omits totalRefunded on pending refund even when body/prior would invent a total (PAYMOB-1)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        // Prior refunded 20; this request 30 — old bug would invent totalRefunded=50 while pending.
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 2000, currency: "SAR" }),
        jsonResponse({
          id: 999002,
          success: true,
          pending: true,
          // Body may even claim a cumulative — still must not ledger while pending.
          refunded_amount_cents: 5000,
          currency: "SAR",
        }),
      );

      const result = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 30,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.outcome).toBe("pending");
      expect(result.status).toBe("pending");
      expect(result.success).toBe(true);
      expect(result.totalRefunded).toBeUndefined();
      expect(result.gatewayRefundId).toBe("999002");
    });

    it("does not complete a refund 200 success with refunded_amount_cents 0 (NEW-PAYMOB-REFUND-0)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 999003, success: true, refunded_amount_cents: 0, currency: "SAR" }),
      );

      const result = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.status).toBe("pending");
      expect(result.outcome).toBe("pending");
      expect(result.status).not.toBe("completed");
      expect(result.outcome).not.toBe("succeeded");
      expect(result.totalRefunded).toBeUndefined();
      expect(result.totalRefunded).not.toBe(0);
      expect(result.gatewayRefundId).toBe("999003");
    });

    it("estimates totalRefunded when refund body omits refunded_amount_cents (PAYMOB-3)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 2000, currency: "SAR" }),
        // Success body has a distinct refund txn id but no cumulative refunded total.
        jsonResponse({ id: 999001, success: true, currency: "SAR" }),
      );

      const result = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 30,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      // prior 20 + this 30 = 50 major units
      expect(result.totalRefunded).toBe(50);
      // PAYMOB-4: gatewayRefundId is the refund txn id — not the payment id.
      expect(result.gatewayRefundId).toBe("999001");
      expect(result.gatewayRefundId).not.toBe("123456789");
      expect(result.status).toBe("completed");
    });

    it("rejects refund responses missing refund transaction id as indeterminate (PAYMOB-1/4)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ success: true, refunded_amount_cents: 5000, currency: "SAR" }),
      );

      // HTTP 200 + missing refund id: post-submit indeterminate result, not GatewayApiError.
      const missingId = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });
      expect(missingId.outcome).toBe("indeterminate");
      expect(missingId.reconciliationRequired).toBe(true);
    });

    it("derives full capture amount from transaction inquiry when amount is omitted", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 2500, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 10000 }),
      );

      await actionGateway.capturePayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/capture",
      ]);
      expect(captureBody.amount_cents).toBe(7500);
    });

    it("derives action amounts from wrapped transaction inquiry responses", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          type: "TRANSACTION",
          obj: {
            id: 123,
            amount_cents: "10000",
            captured_amount: "2500",
            currency: "SAR",
          },
        }),
        jsonResponse({ id: 123, success: true, captured_amount: 10000 }),
      );

      await actionGateway.capturePayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(captureBody.amount_cents).toBe(7500);
    });

    it("derives remaining refund amount from transaction inquiry when amount is omitted", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 2000, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 10000 }),
      );

      const result = await actionGateway.refundPayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() });
      const refundBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(refundBody.amount_cents).toBe(8000);
      expect(result.totalRefunded).toBe(100);
      expect(result.outcome).toBe("succeeded");
      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
    });

    it("deduplicates management calls with the same idempotency key", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_idem_123",
      };
      const first = await actionGateway.refundPayment(params);
      const second = await actionGateway.refundPayment(params);

      expect(first).toBe(second);
      expect(first.totalRefunded).toBe(50);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("deduplicates concurrent management calls with the same idempotency key", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_concurrent_idem_123",
      };
      const [first, second] = await Promise.all([
        actionGateway.refundPayment(params),
        actionGateway.refundPayment(params),
      ]);

      expect(first).toBe(second);
      expect(first.totalRefunded).toBe(50);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("keeps idempotency keys blocked after network failures on mutating calls", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        new Error("socket closed after gateway accepted request"),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_unknown_123",
      };

      const first = await actionGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("does not FIFO-evict unknown or completed fences under cache pressure (PAYMOB-3 / NEW-PAYMOB-TTL)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      // Seed an unknown fence via indeterminate network failure after POST
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        new Error("socket closed after gateway accepted request"),
      );
      const unknownParams = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_unknown_fence_under_pressure",
      };
      const unknownFirst = await actionGateway.refundPayment(unknownParams);
      expect(unknownFirst.outcome).toBe("indeterminate");

      // Fill the in-memory map to capacity with completed mutation fences.
      // Completed refund/capture/void keys are not evictable (NEW-PAYMOB-TTL).
      const cache = (actionGateway as unknown as {
        idempotencyCache: Map<string, { fingerprint: string; createdAt: number; status?: string }>;
      }).idempotencyCache;
      const limit = 1_000;
      for (let i = 0; cache.size < limit; i++) {
        cache.set(`refundPayment:pad_completed_${i}`, {
          fingerprint: `fp_${i}`,
          createdAt: Date.now(),
          status: "completed",
        });
      }
      expect(cache.size).toBe(limit);

      // New key at capacity: refuse rather than evict a completed refund fence
      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 10,
        currency: "SAR",
        idempotencyKey: "refund_new_under_pressure",
      })).rejects.toThrow(/full of in-flight, unknown, or completed mutation fences/i);
      expect(fetchCalls.filter((call) => call.url.endsWith("/void_refund/refund"))).toHaveLength(1);

      // Unknown fence still blocks retry (no double-apply)
      await expect(actionGateway.refundPayment(unknownParams)).rejects.toThrow(InvalidRequestError);
    });

    it("fingerprints Date params with the shared Date tag (NEW-PAYMOB-FP)", () => {
      const fp = (gateway as unknown as {
        fingerprintParams(value: unknown): string;
      }).fingerprintParams.bind(gateway);
      const at = new Date("2026-01-15T12:00:00.000Z");

      // Stored fingerprint is a sha256 of the Date-tagged canonical form, not
      // raw stringify (S19-FINGERPRINT). Date vs ISO string still differ.
      expect(fp({ at })).toMatch(/^[0-9a-f]{64}$/);
      expect(fp({ at })).not.toBe(fp({ at: "2026-01-15T12:00:00.000Z" }));
    });

    it("stamps idempotency createdAt/expiresAt from this.clock.nowMs() (P610-CLK-2)", async () => {
      const fixedMs = 1_700_000_000_000;
      const clock = fakeClock(fixedMs);
      const store = new MemoryIdempotencyStore();
      const clockGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore: store },
        hooksManager,
        undefined,
        { clock },
      );
      mockFetchSequence(jsonResponse({ id: "pi_clock_123", client_secret: "csk_clock_123" }));

      await clockGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_clock_stamp",
      });

      const record = store.records.get("createPayment:create_clock_stamp");
      expect(record?.createdAt).toBe(fixedMs);
      expect(record?.expiresAt).toBe(fixedMs + 24 * 60 * 60 * 1_000);
      expect(record?.createdAt).not.toBe(Date.now());
    });

    it("does not prune completed idempotency fences as a free key (NEW-PAYMOB-TTL)", async () => {
      const ttlMs = 24 * 60 * 60 * 1_000;
      const clock = fakeClock(5_000_000_000_000);
      const clockGateway = new PaymobGateway(
        PAYMOB_TEST_CONFIG,
        hooksManager,
        undefined,
        { clock },
      );
      const cache = (clockGateway as unknown as {
        idempotencyCache: Map<string, { fingerprint: string; createdAt: number; status?: string }>;
      }).idempotencyCache;
      cache.set("createPayment:old_completed_clock", {
        fingerprint: "fp_old",
        createdAt: clock.nowMs() - ttlMs - 1,
        status: "completed",
      });

      mockFetchSequence(jsonResponse({ id: "pi_prune_clock", client_secret: "csk_prune_clock" }));
      await clockGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_trigger_clock_prune",
      });

      expect(cache.has("createPayment:old_completed_clock")).toBe(true);
    });

    it("never prunes in_progress or unknown idempotency fences (P610-CLK-3)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      const cache = (actionGateway as unknown as {
        idempotencyCache: Map<string, { fingerprint: string; createdAt: number; status?: string }>;
      }).idempotencyCache;
      cache.set("refundPayment:ancient_unknown", {
        fingerprint: JSON.stringify({
          amount: 50,
          currency: "SAR",
          gatewayPaymentId: "123456789",
          idempotencyKey: "ancient_unknown",
        }),
        createdAt: 0,
        status: "unknown",
      });
      cache.set("refundPayment:ancient_in_progress", {
        fingerprint: "fp_in_progress",
        createdAt: 0,
        status: "in_progress",
      });
      cache.set("createPayment:ancient_completed", {
        fingerprint: "fp_completed",
        createdAt: 0,
        status: "completed",
      });

      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 456, success: true, refunded_amount_cents: 1000 }),
      );
      await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 10,
        currency: "SAR",
        idempotencyKey: "refund_trigger_prune",
      });

      expect(cache.has("refundPayment:ancient_unknown")).toBe(true);
      expect(cache.has("refundPayment:ancient_in_progress")).toBe(true);
      expect(cache.has("createPayment:ancient_completed")).toBe(true);

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "ancient_unknown",
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.filter((call) => call.url.endsWith("/void_refund/refund"))).toHaveLength(1);
    });

    it("refuses new idempotency keys when cache is full of non-evictable fences (PAYMOB-3)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      const cache = (actionGateway as unknown as {
        idempotencyCache: Map<string, { fingerprint: string; createdAt: number; status?: string }>;
      }).idempotencyCache;
      for (let i = 0; i < 1_000; i++) {
        cache.set(`refundPayment:unknown_pad_${i}`, {
          fingerprint: `ufp_${i}`,
          createdAt: Date.now(),
          status: "unknown",
        });
      }

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 10,
        currency: "SAR",
        idempotencyKey: "refund_when_cache_full_unknown",
      })).rejects.toThrow(/full of in-flight, unknown, or completed mutation fences/i);
      // Must not call Paymob (fail-closed before mutate)
      expect(fetchCalls).toHaveLength(0);
    });

    it("keeps the idempotency fence after refund POST HTTP 429 (NEW-PAYMOB-2)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ detail: "Too many requests" }, 429),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_429_after_post",
      };

      const first = await actionGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("keeps the idempotency fence after refund POST HTTP 408 (NEW-PAYMOB-4XX)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ detail: "Request Timeout" }, 408),
        jsonResponse({ token: "auth_token_retry" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 999, success: true, refunded_amount_cents: 5000, currency: "SAR" }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_408_after_post",
      };

      const first = await actionGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
      expect(
        fetchCalls.filter((call) => call.url.endsWith("/void_refund/refund")),
      ).toHaveLength(1);
    });

    it("keeps idempotency keys blocked after Paymob 5xx responses on mutating calls", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ message: "upstream timeout" }, 500),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_unknown_500",
      };

      const first = await actionGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("does not block idempotency retries when preflight auth fails before mutation", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        new Error("auth network down"),
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_retry_after_auth_failure",
      };

      await expect(actionGateway.refundPayment(params)).rejects.toThrow(NetworkError);
      const result = await actionGateway.refundPayment(params);

      expect(result.status).toBe("completed");
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("rejects idempotency key reuse with different parameters", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_idem_123",
      });

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 60,
        currency: "SAR",
        idempotencyKey: "refund_idem_123",
      })).rejects.toThrow(InvalidRequestError);
    });

    it("can replay idempotent results across gateway instances with a shared store", async () => {
      const idempotencyStore = new MemoryIdempotencyStore();
      const firstGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore },
        hooksManager,
      );
      const secondGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      const first = await firstGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_idem_123",
      });
      const second = await secondGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_idem_123",
      });

      expect(second).toEqual(first);
      expect(fetchCalls).toHaveLength(1);
    });

    it("refuses same-key refund after an expired durable unknown fence (PAYMOB-FENCE-1)", async () => {
      const ttlMs = 24 * 60 * 60 * 1_000;
      const clock = fakeClock(1_700_000_000_000);
      const idempotencyStore = new MemoryIdempotencyStore();
      const firstGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
        undefined,
        { clock },
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        new Error("socket closed after gateway accepted request"),
        jsonResponse({ token: "auth_token_456" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 999, success: true, refunded_amount_cents: 5000 }),
      );
      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "expired_unknown_refund",
      };

      const first = await firstGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(idempotencyStore.records.get("refundPayment:expired_unknown_refund")?.status).toBe(
        "unknown",
      );

      clock.advance(ttlMs + 1);
      const secondGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
        undefined,
        { clock },
      );

      await expect(secondGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(idempotencyStore.records.get("refundPayment:expired_unknown_refund")?.status).toBe(
        "unknown",
      );
      expect(fetchCalls.filter((call) => call.url.endsWith("/void_refund/refund"))).toHaveLength(1);
    });

    it("treats an expired durable in_progress fence as unknown and does not re-reserve (PAYMOB-FENCE-1)", async () => {
      const clock = fakeClock(1_700_000_000_000);
      const deleted: string[] = [];
      const store: PaymobIdempotencyStore = {
        reserveCalls: 0,
        async reserve(_key: string, record: PaymobIdempotencyRecord) {
          this.reserveCalls += 1;
          return {
            ...record,
            status: "in_progress",
            createdAt: clock.nowMs() - 25 * 60 * 60 * 1000,
            expiresAt: clock.nowMs() - 1,
          };
        },
        get: () => undefined,
        set: () => {},
        delete: (key: string) => {
          deleted.push(key);
        },
      } as PaymobIdempotencyStore & { reserveCalls: number };
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore: store },
        hooksManager,
        undefined,
        { clock },
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 999, success: true, refunded_amount_cents: 5000 }),
      );

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "expired_in_progress_refund",
      })).rejects.toThrow(/unknown gateway outcome/i);
      expect((store as PaymobIdempotencyStore & { reserveCalls: number }).reserveCalls).toBe(1);
      expect(deleted).toEqual([]);
      expect(fetchCalls).toHaveLength(0);
    });

    it("throws when idempotencyStore lacks reserve() on mutations (PAYMOB-TOCTOU)", async () => {
      const storeWithoutReserve: PaymobIdempotencyStore = {
        get: () => undefined,
        set: () => {},
        delete: () => {},
      };
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore: storeWithoutReserve },
        hooksManager,
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 999, success: true, refunded_amount_cents: 5000 }),
      );

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "no_reserve_refund",
      })).rejects.toThrow(/requires idempotencyStore\.reserve/);
      expect(fetchCalls).toHaveLength(0);
    });

    it("fails closed when capture/refund/void omit idempotencyKey (I2-PAYMOB-MUTATION-FENCE)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 999, success: true, refunded_amount_cents: 5000 }),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
      })).rejects.toThrow(/requires idempotencyKey/);
      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
      })).rejects.toThrow(/requires idempotencyKey/);
      await expect(actionGateway.voidPayment({
        gatewayPaymentId: "123456789",
      })).rejects.toThrow(/requires idempotencyKey/);
      expect(fetchCalls).toHaveLength(0);
    });

    it("fails closed when mutations have a key but no idempotencyStore (I2-PAYMOB-MUTATION-FENCE)", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 999, success: true, refunded_amount_cents: 5000 }),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "no_store_capture",
      })).rejects.toThrow(/requires paymob\.idempotencyStore and idempotencyKey/);
      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "no_store_refund",
      })).rejects.toThrow(/requires paymob\.idempotencyStore and idempotencyKey/);
      await expect(actionGateway.voidPayment({
        gatewayPaymentId: "123456789",
        idempotencyKey: "no_store_void",
      })).rejects.toThrow(/requires paymob\.idempotencyStore and idempotencyKey/);
      expect(fetchCalls).toHaveLength(0);
    });

    it("replays an expired completed fence instead of delete+re-reserve (NEW-PAYMOB-TTL)", async () => {
      const idempotencyStore = new ExpiredThenContendedIdempotencyStore();
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore },
        hooksManager,
      );

      const result = await actionGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_expired_race",
      });

      expect(result).toEqual({ gatewayId: "expired_completed" });
      expect(idempotencyStore.reserveCalls).toBe(1);
      expect(idempotencyStore.deleted).toEqual([]);
      expect(fetchCalls).toHaveLength(0);
    });

    it("does not re-enter a mutation after a completed fence TTL elapses (NEW-PAYMOB-TTL)", async () => {
      const ttlMs = 24 * 60 * 60 * 1_000;
      const clock = fakeClock(1_700_000_000_000);
      const idempotencyStore = new MemoryIdempotencyStore();
      const firstGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
        undefined,
        { clock },
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );
      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "expired_completed_refund",
      };

      const first = await firstGateway.refundPayment(params);
      expect(first.status).toBe("completed");
      expect(first.totalRefunded).toBe(50);

      clock.advance(ttlMs + 1);
      const secondGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
        undefined,
        { clock },
      );
      const second = await secondGateway.refundPayment(params);

      expect(second).toEqual(first);
      expect(fetchCalls.filter((call) => call.url.endsWith("/void_refund/refund"))).toHaveLength(1);
      expect(idempotencyStore.records.get("refundPayment:expired_completed_refund")?.status).toBe(
        "completed",
      );
    });

    it("does not fail a completed Paymob mutation when the shared idempotency result write fails", async () => {
      const warnings: unknown[][] = [];
      const idempotencyStore = new FailingSetIdempotencyStore();
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
        captureLogger(warnings),
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_store_write_fails_after_success",
      };
      const first = await actionGateway.refundPayment(params);
      const second = await actionGateway.refundPayment(params);

      expect(first.status).toBe("completed");
      expect(second).toBe(first);
      expect(idempotencyStore.setCalls).toBe(1);
      expect(warnings[0]?.[0]).toContain("Failed to persist refundPayment idempotency record");
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("keeps local unknown-outcome protection when the shared idempotency unknown write fails", async () => {
      const warnings: unknown[][] = [];
      const idempotencyStore = new FailingSetIdempotencyStore();
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
        captureLogger(warnings),
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        new Error("socket closed after gateway accepted request"),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_unknown_store_write_fails",
      };

      const first = await actionGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(idempotencyStore.setCalls).toBe(1);
      expect(warnings[0]?.[0]).toContain("Failed to persist refundPayment idempotency record");
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("rejects explicit action amounts above the remaining transaction amount", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 9000, currency: "SAR" }),
      );

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 20,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
      ]);
    });

    it.each([
      {
        label: "capture when is_captured without positive captured_amount",
        inquiry: {
          id: 123,
          amount_cents: 10000,
          is_captured: true,
          // captured_amount missing — terminal flag without total
          currency: "SAR",
        },
        op: "capture" as const,
      },
      {
        label: "refund when is_refunded without positive refunded_amount",
        inquiry: {
          id: 123,
          amount_cents: 10000,
          captured_amount: 10000,
          is_refunded: true,
          // refunded_amount_cents missing / 0
          refunded_amount_cents: 0,
          currency: "SAR",
        },
        op: "refund" as const,
      },
      {
        label: "refund when is_captured without positive captured_amount",
        inquiry: {
          id: 123,
          amount_cents: 10000,
          is_captured: true,
          currency: "SAR",
        },
        op: "refund" as const,
      },
    ])(
      "PAYMOB-2: refuses remaining $label (no mutate POST)",
      async ({ inquiry, op }) => {
        const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
        mockFetchSequence(
          jsonResponse({ token: "auth_token_123" }),
          jsonResponse(inquiry),
        );

        if (op === "capture") {
          await expect(
            actionGateway.capturePayment({
              gatewayPaymentId: "123456789",
              amount: 10,
              currency: "SAR",
              idempotencyKey: nextMutationKey(),
            }),
          ).rejects.toThrow(/no remaining amount is available/i);
        } else {
          await expect(
            actionGateway.refundPayment({
              gatewayPaymentId: "123456789",
              idempotencyKey: nextMutationKey(),
            }),
          ).rejects.toThrow(/no remaining amount is available/i);
        }
        // Fail-closed at remaining math — inquiry only, no capture/refund POST.
        expect(fetchCalls.map((call) => call.url)).toEqual([
          "https://ksa.paymob.com/api/auth/tokens",
          "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        ]);
      },
    );

    it("rejects explicit action currency that differs from the transaction currency", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 10,
        currency: "OMR",
        idempotencyKey: nextMutationKey(),
      })).rejects.toThrow(InvalidRequestError);
    });

    it("derives remaining refund amount from captured amount after partial capture", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123,
          amount_cents: 10000,
          currency: "SAR",
          captured_amount: 4000,
          refunded_amount_cents: 1000,
        }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 4000 }),
      );

      await actionGateway.refundPayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() });
      const refundBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(refundBody.amount_cents).toBe(3000);
    });

    it("rejects refunding uncaptured authorizations and directs callers to void", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123,
          success: true,
          amount_cents: 10000,
          captured_amount: 0,
          currency: "SAR",
          is_auth: true,
          is_capture: false,
          is_captured: false,
        }),
      );

      await expect(actionGateway.refundPayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() }))
        .rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
      ]);
    });

    it.each([
      {
        label: "refund pending sale",
        op: "refund" as const,
        inquiry: {
          id: 123,
          success: false,
          pending: true,
          amount_cents: 10000,
          currency: "SAR",
        },
      },
      {
        label: "refund failed sale",
        op: "refund" as const,
        inquiry: {
          id: 123,
          success: false,
          pending: false,
          amount_cents: 10000,
          currency: "SAR",
        },
      },
      {
        label: "capture pending sale",
        op: "capture" as const,
        inquiry: {
          id: 123,
          success: false,
          pending: true,
          amount_cents: 10000,
          currency: "SAR",
        },
      },
      {
        label: "capture failed sale",
        op: "capture" as const,
        inquiry: {
          id: 123,
          success: false,
          pending: false,
          amount_cents: 10000,
          currency: "SAR",
        },
      },
    ])(
      "refuses $label before POST (S19-PAYMOB-REFUND-UNPAID)",
      async ({ op, inquiry }) => {
        const actionGateway = new PaymobGateway(
          withMutationFence(PAYMOB_TEST_CONFIG),
          hooksManager,
        );
        mockFetchSequence(jsonResponse(inquiry));

        if (op === "refund") {
          await expect(
            actionGateway.refundPayment({
              gatewayPaymentId: "123456789",
              idempotencyKey: nextMutationKey(),
            }),
          ).rejects.toThrow(InvalidRequestError);
        } else {
          await expect(
            actionGateway.capturePayment({
              gatewayPaymentId: "123456789",
              idempotencyKey: nextMutationKey(),
            }),
          ).rejects.toThrow(InvalidRequestError);
        }

        expect(
          fetchCalls.filter(
            (call) =>
              call.url.endsWith("/void_refund/refund") ||
              call.url.endsWith("/api/acceptance/capture"),
          ),
        ).toHaveLength(0);
        expect(fetchCalls).toHaveLength(1);
        expect(fetchCalls[0]!.url).toBe(
          "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        );
      },
    );

    it("converts OMR action amounts and response amounts with three decimal places", async () => {
      const actionGateway = new PaymobGateway(
        { ...withMutationFence(), region: "om" },
        hooksManager,
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 50000, captured_amount: 0, currency: "OMR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 20125 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 20.125,
        currency: "OMR",
        idempotencyKey: nextMutationKey(),
      });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(captureBody.amount_cents).toBe(20125);
      expect(result.capturedAmount).toBe(20.125);
    });

    it("uses transaction currency when an explicit action amount omits currency", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 50000, currency: "OMR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 20125 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 20.125,
        idempotencyKey: nextMutationKey(),
      });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(fetchCalls[1]!.url).toBe("https://ksa.paymob.com/api/acceptance/transactions/123456789");
      expect(captureBody.amount_cents).toBe(20125);
      expect(result.capturedAmount).toBe(20.125);
    });

    it("rejects transaction inquiry responses that include money without currency", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, success: true, amount_cents: 10000 }),
      );

      await expect(actionGateway.getPayment({ gatewayPaymentId: "123456789" }))
        .rejects.toThrow(GatewayApiError);
    });

    it("normalizes wrapped transaction inquiry responses for getPayment", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          type: "TRANSACTION",
          obj: {
            id: "123456789",
            success: "true",
            pending: "false",
            amount_cents: "10000",
            captured_amount: "4000",
            refunded_amount_cents: "1000",
            currency: "SAR",
          },
        }),
      );

      const result = await actionGateway.getPayment({ gatewayPaymentId: "123456789" });

      expect(result.gatewayId).toBe("123456789");
      // refunded_amount_cents takes priority over captured_amount for status mapping
      expect(result.status).toBe("partially_refunded");
      // PAYMOB-3: currency accompanies major-unit amount fields (no naked majors)
      expect(result.currency).toBe("SAR");
      expect(result.amount).toBe(100);
      expect(result.capturedAmount).toBe(40);
      expect(result.refundedAmount).toBe(10);
    });

    it("dedupes concurrent legacy auth requests with a single in-flight token fetch", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 1, amount_cents: 100, currency: "SAR" }),
        jsonResponse({ id: 2, amount_cents: 100, currency: "SAR" }),
      );

      // Two concurrent inquiries should share one auth request.
      await Promise.all([
        actionGateway.getPayment({ gatewayPaymentId: "111111111" }),
        actionGateway.getPayment({ gatewayPaymentId: "222222222" }),
      ]);

      const authCalls = fetchCalls.filter((call) =>
        call.url.endsWith("/api/auth/tokens"),
      );
      expect(authCalls).toHaveLength(1);
    });

    it("expires non-JWT legacy auth cache using this.clock.nowMs() TTL (P610-CLK-2)", async () => {
      const clock = fakeClock(1_700_000_000_000);
      const actionGateway = new PaymobGateway(
        PAYMOB_ACTION_CONFIG,
        hooksManager,
        undefined,
        { clock },
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_not_a_jwt" }),
        jsonResponse({ id: 1, amount_cents: 100, currency: "SAR" }),
        jsonResponse({ id: 2, amount_cents: 100, currency: "SAR" }),
        jsonResponse({ token: "auth_token_refreshed" }),
        jsonResponse({ id: 3, amount_cents: 100, currency: "SAR" }),
      );

      await actionGateway.getPayment({ gatewayPaymentId: "111111111" });
      await actionGateway.getPayment({ gatewayPaymentId: "222222222" });
      expect(fetchCalls.filter((call) => call.url.endsWith("/api/auth/tokens"))).toHaveLength(1);

      clock.advance(50 * 60 * 1000 + 1);
      await actionGateway.getPayment({ gatewayPaymentId: "333333333" });

      expect(fetchCalls.filter((call) => call.url.endsWith("/api/auth/tokens"))).toHaveLength(2);
    });

    it("reuses a cached token derived from the JWT expiry across calls", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      // JWT with an exp claim ~1 hour in the future.
      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const payload = btoa(JSON.stringify({ exp }));
      const jwt = `${header}.${payload}.sig`;

      mockFetchSequence(
        jsonResponse({ token: jwt }),
        jsonResponse({ id: 1, amount_cents: 100, currency: "SAR" }),
        jsonResponse({ id: 2, amount_cents: 100, currency: "SAR" }),
      );

      await actionGateway.getPayment({ gatewayPaymentId: "111111111" });
      await actionGateway.getPayment({ gatewayPaymentId: "222222222" });

      const authCalls = fetchCalls.filter((call) =>
        call.url.endsWith("/api/auth/tokens"),
      );
      // Second call reuses the cached token (valid per JWT exp), no re-auth.
      expect(authCalls).toHaveLength(1);
    });

    it("returns Paymob payment status via transaction inquiry", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123456789,
          success: true,
          pending: false,
          amount_cents: 10000,
          currency: "SAR",
        }),
      );

      await expect(actionGateway.getPaymentStatus("123456789")).resolves.toBe("paid");
    });

    it("empty HTTP 200 inquiry is GatewayApiError, not declined (S19-PAYMOB-JSON)", async () => {
      const actionGateway = new PaymobGateway(
        withMutationFence(PAYMOB_TEST_CONFIG),
        hooksManager,
      );
      mockFetchSequence(emptyResponse());

      const inquiry = actionGateway.getPayment({ gatewayPaymentId: "123456789" });
      await expect(inquiry).rejects.toBeInstanceOf(GatewayApiError);
      await expect(inquiry).rejects.not.toMatchObject({ outcome: "declined" });
      expect(fetchCalls).toHaveLength(1);
    });

    it("non-JSON HTTP 200 inquiry is GatewayApiError, not declined (S19-PAYMOB-JSON)", async () => {
      const actionGateway = new PaymobGateway(
        withMutationFence(PAYMOB_TEST_CONFIG),
        hooksManager,
      );
      mockFetchSequence(htmlResponse());

      const inquiry = actionGateway.getPayment({ gatewayPaymentId: "123456789" });
      await expect(inquiry).rejects.toBeInstanceOf(GatewayApiError);
      await expect(inquiry).rejects.toThrow(/invalid JSON/i);
      expect(fetchCalls).toHaveLength(1);
    });

    it("empty-object HTTP 200 inquiry is GatewayApiError, not declined (S19-PAYMOB-JSON)", async () => {
      const actionGateway = new PaymobGateway(
        withMutationFence(PAYMOB_TEST_CONFIG),
        hooksManager,
      );
      mockFetchSequence(jsonResponse({}));

      const inquiry = actionGateway.getPayment({ gatewayPaymentId: "123456789" });
      await expect(inquiry).rejects.toBeInstanceOf(GatewayApiError);
      await expect(inquiry).rejects.toThrow(/missing transaction data/i);
      expect(fetchCalls).toHaveLength(1);
    });

    it("inquiry missing success is fail-closed (not paid / not isPaidOutcome)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123456789,
          // success omitted — must not default true
          pending: false,
          amount_cents: 10000,
          currency: "SAR",
        }),
      );

      const result = await actionGateway.getPayment({ gatewayPaymentId: "123456789" });
      expect(result.status).toBe("failed");
      expect(result.outcome).toBe("declined");
      expect(isPaidOutcome(result)).toBe(false);
      expect(result.success).toBe(false);
    });

    it("authorized inquiry is not isPaidOutcome (hold may be outcome-succeeded)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123456789,
          success: true,
          pending: false,
          is_auth: true,
          is_capture: false,
          is_captured: false,
          amount_cents: 10000,
          currency: "SAR",
        }),
      );

      const result = await actionGateway.getPayment({ gatewayPaymentId: "123456789" });
      expect(result.status).toBe("authorized");
      expect(result.outcome).toBe("succeeded");
      expect(isPaidOutcome(result)).toBe(false);
    });

    it("partially_captured inquiry is not isPaidOutcome and not outcome-succeeded", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123456789,
          success: true,
          pending: false,
          amount_cents: 10000,
          captured_amount: 4000,
          currency: "SAR",
        }),
      );

      const result = await actionGateway.getPayment({ gatewayPaymentId: "123456789" });
      expect(result.status).toBe("partially_captured");
      expect(result.outcome).toBe("requires_action");
      expect(isPaidOutcome(result)).toBe(false);
      expect(result.success).toBe(true);
    });

    it("is_captured without positive captured_amount is not paid / not isPaidOutcome (PAYMOB-1)", async () => {
      // is_captured true + missing captured_amount must not fall through to paid
      const missingGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123456789,
          success: true,
          pending: false,
          is_auth: true,
          is_capture: false,
          is_captured: true,
          amount_cents: 10000,
          currency: "SAR",
        }),
      );
      const missing = await missingGateway.getPayment({ gatewayPaymentId: "123456789" });
      expect(missing.status).toBe("processing");
      expect(missing.status).not.toBe("paid");
      expect(isPaidOutcome(missing)).toBe(false);
      expect(missing.outcome).toBe("requires_action");
      // Must not invent full order amount as settled captured total
      expect(missing.capturedAmount).toBeUndefined();

      // is_captured true + captured_amount: 0
      const zeroGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123456790,
          success: true,
          pending: false,
          is_captured: true,
          captured_amount: 0,
          amount_cents: 10000,
          currency: "SAR",
        }),
      );
      const zero = await zeroGateway.getPayment({ gatewayPaymentId: "123456790" });
      expect(zero.status).toBe("processing");
      expect(zero.status).not.toBe("paid");
      expect(isPaidOutcome(zero)).toBe(false);
      expect(zero.outcome).toBe("requires_action");
    });

    it("rejects intention IDs for transaction lookup with a clear error", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);

      await expect(actionGateway.getPayment({ gatewayPaymentId: "pi_test_123" }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.getPayment({ gatewayPaymentId: "pi_test_123" })).rejects.toThrow(
        /transaction ID from a verified Paymob webhook.*not the intention ID returned by createPayment/i,
      );
      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects intention IDs for capture, refund, and void before calling Paymob", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);

      await expect(actionGateway.capturePayment({ gatewayPaymentId: "pi_test_123", idempotencyKey: nextMutationKey() }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.capturePayment({ gatewayPaymentId: "pi_test_123", idempotencyKey: nextMutationKey() })).rejects.toThrow(
        /Store transaction id \(obj\.id\) from the processed callback/i,
      );
      await expect(actionGateway.refundPayment({ gatewayPaymentId: "pi_test_123", idempotencyKey: nextMutationKey() }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.voidPayment({ gatewayPaymentId: "pi_test_123", idempotencyKey: nextMutationKey() }))
        .rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects non-numeric Paymob transaction IDs before calling Paymob", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);

      await expect(actionGateway.capturePayment({ gatewayPaymentId: "order_123", idempotencyKey: nextMutationKey() }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.refundPayment({ gatewayPaymentId: "txn_123", idempotencyKey: nextMutationKey() }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.voidPayment({ gatewayPaymentId: "abc", idempotencyKey: nextMutationKey() }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.getPayment({ gatewayPaymentId: "missing_txn" }))
        .rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("maps successful partial capture responses to partially_captured", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, amount_cents: 10000, captured_amount: 4000 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 40,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.status).toBe("partially_captured");
      expect(result.capturedAmount).toBe(40);
      expect(result.currency).toBe("SAR");
      expect(result.outcome).toBe("requires_action");
      expect(isPaidOutcome(result)).toBe(false);
      // PAYMOB-2: parent gatewayId preferred over child capture response id.
      expect(result.gatewayId).toBe("123456789");
      expect(result.captureId).toBe("123");
    });

    it("prefers parent gatewayId over child capture txn id (PAYMOB-2)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123456789, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        // Capture response id is a distinct child capture transaction.
        jsonResponse({ id: 888001, success: true, captured_amount: 10000, currency: "SAR" }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 100,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.gatewayId).toBe("123456789");
      expect(result.gatewayId).not.toBe("888001");
      expect(result.captureId).toBe("888001");
      expect(result.references?.providerObjectId).toBe("123456789");
      expect(result.references?.relatedIds?.captureId).toBe("888001");
    });

    it("reports cumulative capturedAmount when capture response omits captured_amount after prior partial", async () => {
      // PAYMOB-2 (stream) / PAYMOB-4 (audit): use this-request amount + inquiry prior,
      // not response amount_cents (may be order total and would overstate).
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 4000, currency: "SAR" }),
        // Response omits cumulative captured_amount; amount_cents is order total (misleading).
        jsonResponse({ id: 123, success: true, amount_cents: 10000 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 25,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.status).toBe("partially_captured");
      // Prior 40 + this request 25 = 65 cumulative (not 40+100 from amount_cents)
      expect(result.capturedAmount).toBe(65);
      expect(isPaidOutcome(result)).toBe(false);
    });

    it("does not map capture success to paid without positive captured total (PAYMOB-1)", async () => {
      // Explicit captured_amount: 0
      const zeroGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, amount_cents: 10000, captured_amount: 0 }),
      );
      const zero = await zeroGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });
      expect(zero.status).toBe("processing");
      expect(zero.status).not.toBe("paid");
      expect(isPaidOutcome(zero)).toBe(false);
      expect(zero.outcome).not.toBe("succeeded");
      expect(zero.capturedAmount).toBe(0);

      // Sparse success body with no amounts — estimate from this-request + inquiry prior
      const sparseGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, is_capture: true }),
      );
      const sparse = await sparseGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });
      // prior 0 + requested 50 = 50 → partially_captured (honest estimate), not false full paid with 0
      expect(sparse.status).toBe("partially_captured");
      expect(sparse.capturedAmount).toBe(50);
      expect(isPaidOutcome(sparse)).toBe(false);
    });

    it("maps pending capture mutation to pending and omits capturedAmount (PAYMOB-4)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({
          id: 123,
          success: true,
          pending: true,
          captured_amount: 5000,
          currency: "SAR",
        }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.status).toBe("pending");
      expect(result.outcome).toBe("requires_action");
      expect(isPaidOutcome(result)).toBe(false);
      // Symmetric with refund: do not ledger cumulative while pending
      expect(result.capturedAmount).toBeUndefined();
    });

    it("uses transaction inquiry totals to map partial captures when capture response omits amount_cents", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 4000 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 40,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.status).toBe("partially_captured");
      expect(result.capturedAmount).toBe(40);
    });

    it("rejects malformed successful action responses as indeterminate (PAYMOB-1)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123 }),
      );

      // HTTP 200 + missing success is post-submit indeterminate, not GatewayApiError.
      const malformed = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "capture_malformed_body_200",
      });
      expect(malformed.outcome).toBe("indeterminate");
      expect(malformed.reconciliationRequired).toBe(true);
    });

    it("treats empty or non-JSON HTTP 200 capture as indeterminate (S19-PAYMOB-JSON)", async () => {
      const emptyGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        emptyResponse(),
      );

      const emptyBody = await emptyGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "capture_200_empty_body",
      });
      expect(emptyBody.outcome).toBe("indeterminate");
      expect(emptyBody.reconciliationRequired).toBe(true);
      expect(emptyBody.outcome).not.toBe("declined");
      expect(emptyBody.status).not.toBe("failed");

      const htmlGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        htmlResponse(),
      );
      const htmlBody = await htmlGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "capture_200_html_body",
      });
      expect(htmlBody.outcome).toBe("indeterminate");
      expect(htmlBody.reconciliationRequired).toBe(true);
    });

    it("keeps idempotency fence after HTTP 200 + malformed capture body (PAYMOB-1)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        // HTTP 200 empty-ish body after accepted capture
        jsonResponse({}),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "capture_200_malformed_fence",
      };

      const first = await actionGateway.capturePayment(params);
      expect(first.outcome).toBe("indeterminate");
      // Second attempt must be blocked — fence retained (no double capture).
      await expect(actionGateway.capturePayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/capture",
      ]);
    });

    it("keeps idempotency fence after HTTP 200 + missing refund id (PAYMOB-1)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        // HTTP 200 with success but no refund transaction id
        jsonResponse({ success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_200_missing_id_fence",
      };

      const first = await actionGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("keeps idempotency fence after HTTP 200 + non-boolean success on void (PAYMOB-1)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, success: "not-a-boolean" }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        idempotencyKey: "void_200_bad_success_fence",
      };

      const first = await actionGateway.voidPayment(params);
      expect(first.outcome).toBe("indeterminate");
      await expect(actionGateway.voidPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/void_refund/void",
      ]);
    });

    it("coerces string success and string money fields on capture/refund mutations (PAYMOB-4)", async () => {
      const captureGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({
          id: 888001,
          success: "true",
          captured_amount: "4000",
          currency: "SAR",
        }),
      );

      const capture = await captureGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 40,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });
      expect(capture.status).toBe("partially_captured");
      expect(capture.capturedAmount).toBe(40);
      expect(capture.gatewayId).toBe("123456789");

      const refundGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_456" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({
          id: 999002,
          success: "true",
          refunded_amount_cents: "2500",
          currency: "SAR",
        }),
      );

      const refund = await refundGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 25,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      });
      expect(refund.status).toBe("completed");
      expect(refund.totalRefunded).toBe(25);
      expect(refund.gatewayRefundId).toBe("999002");
    });

    it("maps pending void to pending/requires_action not cancelled (NEW-PAYMOB-VOID-P)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, success: true, pending: true }),
      );

      const result = await actionGateway.voidPayment({ gatewayPaymentId: "123456789", idempotencyKey: nextMutationKey() });

      expect(result.status).toBe("pending");
      expect(result.outcome).toBe("requires_action");
      expect(result.status).not.toBe("cancelled");
      expect(isPaidOutcome(result)).toBe(false);
    });

    it("keeps parent gatewayId on void even when response id differs (PAYMOB-3)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 777888, success: true }),
      );

      const result = await actionGateway.voidPayment({
        gatewayPaymentId: "123456789",
        idempotencyKey: nextMutationKey(),
      });

      expect(result.gatewayId).toBe("123456789");
      expect(result.gatewayId).not.toBe("777888");
      expect(result.status).toBe("cancelled");
    });

    it("maps Paymob API errors safely when raw message is not a string", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ message: ["authentication failed"] }, 400),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      })).rejects.toThrow(AuthenticationError);
    });

    it("maps Paymob 401 responses to AuthenticationError", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(jsonResponse({ detail: "Invalid token" }, 401));

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        idempotencyKey: nextMutationKey(),
      })).rejects.toThrow(AuthenticationError);
    });

    it("maps Paymob 404 and 429 responses to operational error types", async () => {
      const notFoundGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(jsonResponse({ token: "auth_token_123" }, 200), jsonResponse({ message: "Not found" }, 404));

      await expect(notFoundGateway.getPayment({ gatewayPaymentId: "404404" }))
        .rejects.toThrow(ResourceNotFoundError);

      const rateLimitedGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(jsonResponse({ detail: "Too many requests" }, 429));

      await expect(rateLimitedGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        idempotencyKey: nextMutationKey(),
      })).rejects.toThrow(RateLimitError);
    });

    it("maps insufficient-funds Paymob messages to InsufficientFundsError", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ message: "Insufficient funds" }, 400),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: nextMutationKey(),
      })).rejects.toThrow(InsufficientFundsError);
    });

    it("keeps the idempotency fence when caller aborts after Intention POST (PAYMOB-FENCE-2)", async () => {
      const controller = new AbortController();
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        controller.abort();
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      }) as typeof fetch;

      const params = {
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "intention_abort_after_post",
        signal: controller.signal,
      };
      const first = await gateway.createPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(first.reconciliationRequired).toBe(true);

      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "intention_abort_after_post",
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(1);
    });

    it("keeps the idempotency fence when caller aborts after refund POST (PAYMOB-FENCE-2)", async () => {
      const actionGateway = new PaymobGateway(withMutationFence(), hooksManager);
      const controller = new AbortController();
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        fetchCalls.push({ url, init });
        if (url.endsWith("/api/auth/tokens")) {
          return jsonResponse({ token: "auth_token_123" });
        }
        if (url.includes("/api/acceptance/transactions/")) {
          return jsonResponse({
            id: 123,
            amount_cents: 5000,
            refunded_amount_cents: 0,
            currency: "SAR",
          });
        }
        controller.abort();
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      }) as typeof fetch;

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_abort_after_post",
        signal: controller.signal,
      };
      const first = await actionGateway.refundPayment(params);
      expect(first.outcome).toBe("indeterminate");
      expect(first.reconciliationRequired).toBe(true);

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_abort_after_post",
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.filter((call) => call.url.endsWith("/void_refund/refund"))).toHaveLength(1);
    });

    it("aborts Paymob requests when the configured timeout is exceeded", async () => {
      const timeoutGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, timeoutMs: 1 },
        hooksManager,
      );
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(_input), init });
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }) as typeof fetch;

      const timedOut = await timeoutGateway.createPayment(VALID_CREATE_PARAMS);
      expect(timedOut.outcome).toBe("indeterminate");
      expect(timedOut.reconciliationRequired).toBe(true);
    });

    it("keeps the request timeout until the response body is consumed (P610-ABT-4)", async () => {
      const timeoutGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, timeoutMs: 40 },
        hooksManager,
      );
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(_input), init });
        const encoder = new TextEncoder();
        const body = JSON.stringify({ id: "pi_slow_body", client_secret: "csk_slow_body" });
        return new Response(
          new ReadableStream({
            start(controller) {
              const timer = setTimeout(() => {
                controller.enqueue(encoder.encode(body));
                controller.close();
              }, 250);
              init?.signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
              });
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }) as typeof fetch;

      const hungBody = await timeoutGateway.createPayment(VALID_CREATE_PARAMS);
      expect(hungBody.outcome).toBe("indeterminate");
      expect(hungBody.reconciliationRequired).toBe(true);
    });
  });

  describe("verifyWebhook", () => {
    it("fails closed when no HMAC secret is configured", () => {
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined } as PaymobConfig,
        hooksManager,
      );

      expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(false);
    });

    it("allows unverified webhooks only when explicitly configured", () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined, allowUnverifiedWebhooks: true } as PaymobConfig,
        hooksManager,
      );

      try {
        expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(true);
        expect(gatewayNoSecret.verifyWebhook({ arbitrary: "payload" })).toBe(false);
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("refuses unverified webhooks outside explicit local/test environments", () => {
      const previousNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined, allowUnverifiedWebhooks: true } as PaymobConfig,
        hooksManager,
      );

      try {
        expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(false);
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("refuses unverified webhooks in production even when explicitly configured", () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined, allowUnverifiedWebhooks: true } as PaymobConfig,
        hooksManager,
      );

      try {
        expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(false);
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("verifies a valid HMAC signature using a timing-safe comparison", () => {
      const payload = createMockWebhookPayload();
      const signature = signPayload(payload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);
      expect(gateway.verifyWebhook(payload, "invalid_signature")).toBe(false);
    });

    it("fails closed instead of throwing when HMAC input is not a string", () => {
      const payload = createMockWebhookPayload();

      expect(gateway.verifyWebhook(payload, ["not", "a", "string"] as unknown as string)).toBe(false);
    });

    it("matches Paymob's documented transaction HMAC field order", () => {
      const payload = createMockWebhookPayload();
      const dataString = (gateway as unknown as {
        buildHmacString(obj: PaymobWebhookPayload["obj"]): string;
      }).buildHmacString(payload.obj);

      expect(dataString).toBe(
        "100002024-12-31T12:00:00ZSARfalsefalse123456789123456truefalsefalsefalsetruefalse987654302852false2346MADAcardtrue",
      );
    });

    it("verifies card token callbacks with their separate HMAC fields", () => {
      const payload: PaymobCardTokenWebhookPayload = {
        type: "TOKEN",
        obj: {
          id: 9988,
          token: "tok_saved_card_123",
          masked_pan: "512345xxxxxx2346",
          merchant_id: 302852,
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          order_id: "order_abc123",
          next_payment_intention: "pi_next_123",
        },
      };
      const signature = signCardTokenPayload(payload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);
    });

    it("matches Paymob's documented card-token HMAC concatenation sample", () => {
      const payload: PaymobCardTokenWebhookPayload = {
        type: "TOKEN",
        obj: {
          id: 8555026,
          token: "e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab",
          masked_pan: "xxxx-xxxx-xxxx-2346",
          merchant_id: 246628,
          card_subtype: "MasterCard",
          created_at: "2024-11-13T12:32:23.859982",
          email: "test@test.com",
          order_id: "264064419",
          user_added: false,
          next_payment_intention: "pi_test_2a9c29ead1734ce8ad09ae4936019992",
        },
      };
      const dataString = (gateway as unknown as {
        buildCardTokenHmacString(obj: PaymobCardTokenWebhookPayload["obj"]): string;
      }).buildCardTokenHmacString(payload.obj);

      expect(dataString).toBe(
        "MasterCard2024-11-13T12:32:23.859982test@test.com8555026xxxx-xxxx-xxxx-2346246628264064419e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab",
      );
    });

    it("verifies redirection callbacks with flat query-style fields", () => {
      const payload = {
        amount_cents: "10000",
        created_at: "2024-12-31T12:00:00Z",
        currency: "SAR",
        error_occured: "false",
        has_parent_transaction: "false",
        id: "123456789",
        integration_id: "123456",
        is_3d_secure: "true",
        is_auth: "false",
        is_capture: "false",
        is_refunded: "false",
        is_standalone_payment: "true",
        is_voided: "false",
        order: "987654",
        owner: "302852",
        pending: "false",
        source_data_pan: "2346",
        source_data_sub_type: "MADA",
        source_data_type: "card",
        success: "true",
        merchant_order_id: "payment_123",
      };
      const signature = signRedirectPayload(payload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);
    });

    it("accepts order_id as an alias for order.id in redirect HMAC fields", () => {
      const payload = {
        amount_cents: "10000",
        created_at: "2024-12-31T12:00:00Z",
        currency: "SAR",
        error_occured: "false",
        has_parent_transaction: "false",
        id: "123456789",
        integration_id: "123456",
        is_3d_secure: "true",
        is_auth: "false",
        is_capture: "false",
        is_refunded: "false",
        is_standalone_payment: "true",
        is_voided: "false",
        order_id: "987654",
        owner: "302852",
        pending: "false",
        source_data_pan: "2346",
        source_data_sub_type: "MADA",
        source_data_type: "card",
        success: "true",
        merchant_order_id: "payment_123",
      };
      const signature = signRedirectPayload(payload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);

      const dataString = (gateway as unknown as {
        buildRedirectHmacString(obj: Record<string, unknown>): string;
      }).buildRedirectHmacString(payload);
      // order.id slot should resolve from order_id alias.
      expect(dataString).toContain("987654");
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses successful payment webhook", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload());

      expect(event.id).toBe("123456789");
      expect(event.gateway).toBe("paymob");
      expect(event.gatewayPaymentId).toBe("123456789");
      // PAYMOB-1: merchant_order_id / extras are unsigned — never copy into paymentId.
      expect(event.paymentId).toBeUndefined();
      expect(event.status).toBe("paid");
      expect(event.amount).toBe(100);
      expect(event.currency).toBe("SAR");
      expect(event.timestamp.toISOString()).toBe("2024-12-31T12:00:00.000Z");
    });

    it("parses processed callbacks with stringified Paymob numbers and booleans", () => {
      const payload = createMockWebhookPayload({
        id: "123456789",
        pending: "false",
        success: "true",
        amount_cents: "10000",
        is_auth: "false",
        is_capture: "false",
        is_void: "false",
        is_refund: "false",
        is_standalone_payment: "true",
        has_parent_transaction: "false",
        error_occured: "false",
        is_3d_secure: "true",
        integration_id: "123456",
      } as Partial<PaymobWebhookPayload["obj"]>);

      const event = gateway.parseWebhookEvent(payload);

      expect(event.gatewayPaymentId).toBe("123456789");
      expect(event.status).toBe("paid");
      expect(event.amount).toBe(100);
    });

    it("prioritizes refund and void flags over success", () => {
      // is_refund alone (is_refunded absent) is HMAC-covered via alias, but
      // refunded_amount_cents is unsigned/stripped — incomplete refund_completed (PAYMOB-2).
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: true,
        is_refunded: undefined,
      } as Partial<PaymobWebhookPayload["obj"]>));
      // is_refunded current-state: refunded_amount_cents is unsigned → refund_completed
      // (incomplete money; PAYMOB-2/6). Injected amount cannot upgrade to full refunded.
      const currentRefundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        refunded_amount_cents: 10000,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const voidEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_void: true,
        is_voided: undefined,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(refundEvent.status).toBe("refund_completed");
      expect(refundEvent.amount).toBeUndefined();
      expect(currentRefundEvent.status).toBe("refund_completed");
      expect(currentRefundEvent.amount).toBeUndefined();
      expect(voidEvent.status).toBe("cancelled");
    });

    it("ignores forged is_refund / is_void next to signed current-state false (I1-PAYMOB-UNSIGNED-ACTION)", () => {
      // HMAC binds is_refunded ?? is_refund. When is_refunded is present (false),
      // is_refund is unsigned — even with signed has_parent_transaction.
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: true,
        is_refunded: false,
        has_parent_transaction: true,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const refundWithoutParent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: true,
        is_refunded: false,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const voidEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_void: true,
        is_voided: false,
        has_parent_transaction: true,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(refundEvent.status).toBe("paid");
      expect(refundEvent.status).not.toBe("refund_completed");
      expect(refundEvent.stableType).toBe("payment.succeeded");
      expect(refundWithoutParent.status).toBe("paid");
      expect(refundWithoutParent.stableType).toBe("payment.succeeded");
      expect(voidEvent.status).toBe("paid");
      expect(voidEvent.status).not.toBe("cancelled");
      expect(voidEvent.stableType).toBe("payment.succeeded");
    });

    it("maps child refund/void from signed has_parent_transaction + signed flag only (I1-PAYMOB-UNSIGNED-ACTION)", () => {
      const childRefundAlias = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: true,
        is_refunded: undefined,
        has_parent_transaction: true,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const childRefundedState = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        has_parent_transaction: true,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const childVoidAlias = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_void: true,
        is_voided: undefined,
        has_parent_transaction: true,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(childRefundAlias.status).toBe("refund_completed");
      expect(childRefundAlias.stableType).not.toBe("payment.succeeded");
      expect(childRefundedState.status).toBe("refund_completed");
      expect(childVoidAlias.status).toBe("cancelled");
    });

    it("does not map HMAC-covered error_occured + success to payment.succeeded (PAYMOB-3)", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        error_occured: true,
      }));

      expect(event.status).not.toBe("paid");
      expect(event.status).toBe("failed");
      expect(event.stableType).not.toBe("payment.succeeded");
      expect(event.stableType).toBe("payment.failed");
      expect(event.event?.type).not.toBe("payment.succeeded");
      expect(event.event?.type).toBe("payment.failed");
    });

    it("does not treat failed refund or void action callbacks as completed states", () => {
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: false,
        is_refund: true,
        is_refunded: undefined,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const voidEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: false,
        is_void: true,
        is_voided: undefined,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(refundEvent.status).toBe("failed");
      expect(voidEvent.status).toBe("failed");
    });

    it("maps signed is_refunded to refund_completed; ignores unsigned capture flags (PAYMOB-2)", () => {
      // refunded_amount_cents is not HMAC-covered — cannot refine partial vs full on webhooks.
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        amount_cents: 10000,
        refunded_amount_cents: 2500,
      }));
      // captured_amount / is_captured are not HMAC-covered — must not drive partial capture
      // status on the webhook path (require inquiry for multi-capture money truth).
      // Plain sale success (no is_capture) still maps paid; unsigned amounts cannot demote.
      const forgedPartialCapture = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        amount_cents: 10000,
        captured_amount: 5000,
        is_captured: true,
      }));
      // Signed is_capture without trusted captured_amount → processing, not paid (PAYMOB-1).
      const captureActionIncomplete = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: true,
        amount_cents: 10000,
        captured_amount: 5000,
        is_captured: true,
      }));

      expect(refundEvent.status).toBe("refund_completed");
      expect(refundEvent.amount).toBeUndefined();
      expect(forgedPartialCapture.status).toBe("paid");
      expect(captureActionIncomplete.status).toBe("processing");
      expect(captureActionIncomplete.status).not.toBe("paid");
      expect(captureActionIncomplete.status).not.toBe("partially_captured");
    });

    it("does not map refund from unsigned refunded_amount_cents alone without signed refund flags", () => {
      const partial = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: false,
        amount_cents: 10000,
        refunded_amount_cents: 2500,
      }));
      const full = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: false,
        amount_cents: 10000,
        refunded_amount_cents: 10000,
      }));

      expect(partial.status).toBe("paid");
      expect(full.status).toBe("paid");
    });

    it("maps is_refunded without refunded_amount_cents to refund_completed not full refunded (PAYMOB-6)", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        amount_cents: 10000,
      }));

      expect(event.status).toBe("refund_completed");
      // PAYMOB-3: incomplete refund snapshot dual-writes refund.pending, not completed.
      expect(event.stableType).toBe("refund.pending");
      // PAYMOB-3: do not publish order total as refund dual-write amount.
      expect(event.amount).toBeUndefined();
    });

    it("does not trust unsigned refunded_amount_cents for full refund completeness (PAYMOB-2)", () => {
      // Attacker with valid is_refunded HMAC cannot upgrade incomplete → full refunded
      // by injecting unsigned refunded_amount_cents / captured_amount.
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        amount_cents: 10000,
        captured_amount: 5000,
        refunded_amount_cents: 10000,
      }));

      expect(event.status).toBe("refund_completed");
      expect(event.status).not.toBe("refunded");
      expect(event.amount).toBeUndefined();
    });

    it("does not trust unsigned refunded_amount_cents for partial refund completeness (PAYMOB-2)", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        amount_cents: 10000,
        captured_amount: 5000,
        refunded_amount_cents: 2500,
      }));

      expect(event.status).toBe("refund_completed");
      expect(event.status).not.toBe("partially_refunded");
      expect(event.amount).toBeUndefined();
    });

    it("maps auth-only callbacks to authorized", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: true,
        is_capture: false,
      }));

      expect(event.status).toBe("authorized");
    });

    it("does not promote auth to paid/partial from unsigned captured_amount or is_captured (PAYMOB-1)", () => {
      const partial = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: true,
        is_capture: false,
        is_captured: false,
        amount_cents: 10000,
        captured_amount: 5000,
      }));
      const full = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: true,
        is_capture: false,
        is_captured: true,
        amount_cents: 10000,
        captured_amount: 10000,
      }));

      expect(partial.status).toBe("authorized");
      expect(full.status).toBe("authorized");
      expect(partial.status === "paid").toBe(false);
      expect(full.status === "paid").toBe(false);
    });

    it("rejects forged unsigned is_captured after valid HMAC of other fields (PAYMOB-1)", () => {
      // Sign a legitimate auth-only payload, then inject unsigned capture flags.
      const base = createMockWebhookPayload({
        success: true,
        is_auth: true,
        is_capture: false,
        is_refunded: false,
        is_voided: false,
      } as Partial<PaymobWebhookPayload["obj"]>);
      const signature = signPayload(base);
      expect(gateway.verifyWebhook(base, signature)).toBe(true);

      const forged: PaymobWebhookPayload = {
        ...base,
        obj: {
          ...base.obj,
          is_captured: true,
          captured_amount: 10000,
        },
      };
      // HMAC still verifies — unsigned fields are outside HMAC_FIELDS.
      expect(gateway.verifyWebhook(forged, signature)).toBe(true);

      const event = gateway.parseWebhookEvent(forged);
      expect(event.status).toBe("authorized");
      expect(event.status).not.toBe("paid");
      expect(event.stableType).toBe("payment.authorized");
    });

    it("rejects forged unsigned is_refund next to signed is_refunded:false after valid HMAC (I1-PAYMOB-UNSIGNED-ACTION)", () => {
      const base = createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: false,
        is_refunded: false,
        is_voided: false,
      } as Partial<PaymobWebhookPayload["obj"]>);
      const signature = signPayload(base);
      expect(gateway.verifyWebhook(base, signature)).toBe(true);

      const forged: PaymobWebhookPayload = {
        ...base,
        obj: {
          ...base.obj,
          refunded_amount_cents: 10000,
          is_refund: true, // present alongside signed is_refunded:false → stripped
        },
      };
      expect(gateway.verifyWebhook(forged, signature)).toBe(true);

      const event = gateway.parseWebhookEvent(forged);
      // Unsigned is_refund must not flip a signed non-refunded sale to refund_completed.
      // Unsigned refunded_amount_cents still cannot invent a refund either (PAYMOB-2).
      expect(event.status).toBe("paid");
      expect(event.status).not.toBe("refund_completed");
      expect(event.status).not.toBe("refunded");
      expect(event.stableType).toBe("payment.succeeded");
    });

    it("rejects forged unsigned refunded_amount_cents completeness after valid is_refunded HMAC (PAYMOB-2)", () => {
      // Sign legitimate is_refunded without amount; inject unsigned completeness.
      const base = createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: false,
        is_refunded: true,
        is_refund: false,
        is_voided: false,
      } as Partial<PaymobWebhookPayload["obj"]>);
      const signature = signPayload(base);
      expect(gateway.verifyWebhook(base, signature)).toBe(true);

      const forgedFull: PaymobWebhookPayload = {
        ...base,
        obj: {
          ...base.obj,
          refunded_amount_cents: 10000,
        },
      };
      const forgedPartial: PaymobWebhookPayload = {
        ...base,
        obj: {
          ...base.obj,
          refunded_amount_cents: 2500,
        },
      };

      expect(gateway.verifyWebhook(forgedFull, signature)).toBe(true);
      expect(gateway.verifyWebhook(forgedPartial, signature)).toBe(true);

      for (const forged of [forgedFull, forgedPartial]) {
        const event = gateway.parseWebhookEvent(forged);
        expect(event.status).toBe("refund_completed");
        expect(event.status).not.toBe("refunded");
        expect(event.status).not.toBe("partially_refunded");
        expect(event.amount).toBeUndefined();
      }
    });

    it("maps signed is_refund action without refunded total to refund_completed not full refunded (PAYMOB-2)", () => {
      // is_refund alone is HMAC-covered via alias when is_refunded is absent, but
      // amount_cents is the charge total — not refund completeness. Fail-closed.
      const base = createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: false,
        is_refunded: undefined,
        is_refund: true,
        is_voided: false,
        amount_cents: 10000,
      } as Partial<PaymobWebhookPayload["obj"]>);
      const signature = signPayload(base);
      expect(gateway.verifyWebhook(base, signature)).toBe(true);

      const withInjectedAmount: PaymobWebhookPayload = {
        ...base,
        obj: {
          ...base.obj,
          refunded_amount_cents: 2500,
        },
      };
      expect(gateway.verifyWebhook(withInjectedAmount, signature)).toBe(true);

      for (const payload of [base, withInjectedAmount]) {
        const event = gateway.parseWebhookEvent(payload);
        expect(event.status).toBe("refund_completed");
        expect(event.status).not.toBe("refunded");
        expect(event.status).not.toBe("partially_refunded");
        expect(event.amount).toBeUndefined();
        expect(event.stableType).toBe("refund.pending");
      }
    });

    it("maps signed is_capture without captured_amount to processing not paid (PAYMOB-1)", () => {
      // Sign legitimate capture action; inject unsigned partial captured_amount.
      // Completeness cannot be proven from webhook — never paid + full amount_cents.
      const base = createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: true,
        is_refunded: false,
        is_voided: false,
        amount_cents: 10000,
      } as Partial<PaymobWebhookPayload["obj"]>);
      const signature = signPayload(base);
      expect(gateway.verifyWebhook(base, signature)).toBe(true);

      const forgedPartial: PaymobWebhookPayload = {
        ...base,
        obj: {
          ...base.obj,
          is_captured: true,
          captured_amount: 5000,
        },
      };
      expect(gateway.verifyWebhook(forgedPartial, signature)).toBe(true);

      for (const payload of [base, forgedPartial]) {
        const event = gateway.parseWebhookEvent(payload);
        expect(event.status).toBe("processing");
        expect(event.status).not.toBe("paid");
        expect(event.status).not.toBe("partially_captured");
        expect(event.stableType).toBe("payment.processing");
        expect(event.stableType).not.toBe("capture.completed");
        expect(event.stableType).not.toBe("payment.succeeded");
        // PAYMOB-1: incomplete capture must not publish full order amount_cents.
        expect(event.amount).toBeUndefined();
      }
    });

    it("omits amount on incomplete capture webhooks (PAYMOB-1)", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: true,
        amount_cents: 10000,
        captured_amount: 5000,
      }));

      expect(event.status).toBe("processing");
      expect(event.amount).toBeUndefined();
      expect(event.currency).toBe("SAR");
      expect(event.stableType).toBe("payment.processing");
      if (event.event?.type === "payment.processing") {
        expect(event.event.payment.amount).toBeUndefined();
      }
    });

    it("does not promote order.id into Phase-7 refundId/captureId (PAYMOB-2)", () => {
      // Mock payload order.id=987654, obj.id=123456789 (distinct child txn).
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: true,
        is_refunded: undefined,
        amount_cents: 10000,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(refundEvent.gatewayPaymentId).toBe("123456789");
      expect(refundEvent.gatewayObjectId).toBeUndefined();
      expect(refundEvent.status).toBe("refund_completed");
      expect(refundEvent.stableType).toBe("refund.pending");
      if (refundEvent.event?.type === "refund.pending") {
        const refs = refundEvent.event.refund.references;
        expect(refs.providerObjectId).toBe("123456789");
        expect(refs.parentId).toBe("987654");
        expect(refs.relatedIds?.orderId).toBe("987654");
        // True refund resource is the emitting txn — never order.id.
        expect(refs.relatedIds?.refundId).toBe("123456789");
        expect(refs.relatedIds?.refundId).not.toBe("987654");
      }

      const captureIncomplete = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: true,
        amount_cents: 10000,
      }));

      expect(captureIncomplete.gatewayObjectId).toBeUndefined();
      expect(captureIncomplete.status).toBe("processing");
      if (captureIncomplete.event?.type === "payment.processing") {
        const refs = captureIncomplete.event.payment.references;
        expect(refs.providerObjectId).toBe("123456789");
        expect(refs.parentId).toBe("987654");
        expect(refs.relatedIds?.orderId).toBe("987654");
        // No capture.completed dual-write without trusted captured_amount — but
        // order.id must still not appear as captureId if present.
        expect(refs.relatedIds?.captureId).not.toBe("987654");
      }

      const paid = gateway.parseWebhookEvent(createMockWebhookPayload());
      expect(paid.gatewayObjectId).toBeUndefined();
      if (paid.event?.type === "payment.succeeded") {
        const refs = paid.event.payment.references;
        expect(refs.parentId).toBe("987654");
        expect(refs.relatedIds?.orderId).toBe("987654");
        expect(refs.relatedIds?.refundId).toBeUndefined();
        expect(refs.relatedIds?.captureId).toBeUndefined();
      }
    });

    it("parses webhook amounts with the currency minor unit", () => {
      const omGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: "om" },
        hooksManager,
      );
      const event = omGateway.parseWebhookEvent(createMockWebhookPayload({
        amount_cents: 20125,
        currency: "OMR",
      }));

      expect(event.amount).toBe(20.125);
    });

    it("does not trust unsigned payment_key_claims extras for paymentId (PAYMOB-1)", () => {
      const payload = createMockWebhookPayload({
        payment_key_claims: {
          extra: { paymentId: "payment_from_extra" },
        },
      });

      expect(gateway.parseWebhookEvent(payload).paymentId).toBeUndefined();
      expect(gateway.parseWebhookEvent(payload).gatewayPaymentId).toBe("123456789");
    });

    it("does not trust unsigned creation_extras for paymentId (PAYMOB-1)", () => {
      const payload = createMockWebhookPayload({
        payment_key_claims: {
          extra: {
            creation_extras: { paymentId: "payment_from_creation_extras" },
          },
        },
      });

      expect(gateway.parseWebhookEvent(payload).paymentId).toBeUndefined();
      expect(gateway.parseWebhookEvent(payload).gatewayPaymentId).toBe("123456789");
    });

    it("parses card token callbacks as setup events", () => {
      const payload: PaymobCardTokenWebhookPayload = {
        type: "TOKEN",
        obj: {
          id: 9988,
          token: "tok_saved_card_123",
          masked_pan: "512345xxxxxx2346",
          merchant_id: 302852,
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          order_id: "order_abc123",
          next_payment_intention: "pi_next_123",
        },
      };

      const event = gateway.parseWebhookEvent(payload);

      expect(event.status).toBe("setup_completed");
      expect(event.paymentId).toBeUndefined();
      // PAYMOB-2: HMAC-covered order_id only — never unsigned next_payment_intention.
      expect(event.gatewayPaymentId).toBe("order_abc123");
      expect(event.gatewayPaymentId).not.toBe("pi_next_123");
      expect(event.gatewayObjectId).toBe("9988");
      expect(event.gatewayToken).toBe("tok_saved_card_123");
    });

    it("TOKEN without next_payment_intention uses signed order_id (PAYMOB-2)", () => {
      const payload: PaymobCardTokenWebhookPayload = {
        type: "TOKEN",
        obj: {
          id: 9988,
          token: "tok_saved_card_123",
          masked_pan: "512345xxxxxx2346",
          merchant_id: 302852,
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          order_id: "order_hmac_only_456",
        },
      };

      const event = gateway.parseWebhookEvent(payload);

      expect(event.status).toBe("setup_completed");
      expect(event.gatewayPaymentId).toBe("order_hmac_only_456");
      expect(event.gatewayObjectId).toBe("9988");
      expect(event.gatewayToken).toBe("tok_saved_card_123");
    });

    it("TOKEN falls back to signed token id when order_id is absent (PAYMOB-2)", () => {
      const payload = {
        type: "TOKEN",
        obj: {
          id: 5544,
          token: "tok_no_order",
          masked_pan: "512345xxxxxx2346",
          merchant_id: 302852,
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          // next_payment_intention present but unsigned — must not bind
          next_payment_intention: "pi_victim_intention",
        },
      };

      const event = gateway.parseWebhookEvent(payload);
      expect(event.gatewayPaymentId).toBe("5544");
      expect(event.gatewayPaymentId).not.toBe("pi_victim_intention");
    });

    it("verifies and parses TOKEN callbacks with string digits for id and merchant_id", () => {
      const payload = {
        type: "TOKEN",
        obj: {
          id: "9988",
          token: "tok_saved_card_123",
          masked_pan: "512345xxxxxx2346",
          merchant_id: "302852",
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          order_id: "order_abc123",
          next_payment_intention: "pi_next_123",
        },
      };
      const signature = signCardTokenPayload(payload as PaymobCardTokenWebhookPayload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);

      const event = gateway.parseWebhookEvent(payload);
      expect(event.status).toBe("setup_completed");
      expect(event.gatewayObjectId).toBe("9988");
      expect(event.gatewayToken).toBe("tok_saved_card_123");
      // PAYMOB-2: signed order_id, not unsigned next_payment_intention.
      expect(event.gatewayPaymentId).toBe("order_abc123");
      expect(event.gatewayPaymentId).not.toBe("pi_next_123");
    });

    it("parses redirection callbacks without treating gateway order IDs as internal IDs", () => {
      const payload = {
        id: "123456789",
        pending: "false",
        success: "true",
        amount_cents: "10000",
        currency: "SAR",
        created_at: "2024-12-31T12:00:00Z",
        merchant_order_id: "payment_123",
      };

      const event = gateway.parseWebhookEvent(payload);

      // TRANSACTION_RESPONSE distinguishes redirect callbacks from processed TRANSACTION webhooks.
      // Callers must not fulfill orders on redirect-only events.
      expect(event.type).toBe("TRANSACTION_RESPONSE");
      // WEBHOOKS-1: redirect event.id is type-qualified so inbox keys do not
      // collide with the later processed TRANSACTION on the same txn id.
      expect(event.id).toBe("123456789:redirect");
      // merchant_order_id is unsigned — correlate via signed gatewayPaymentId only.
      expect(event.paymentId).toBeUndefined();
      expect(event.gatewayPaymentId).toBe("123456789");
      expect(event.status).toBe("processing");
      expect(event.status).not.toBe("paid");
      expect(event.amount).toBe(100);
      // Dual-write must not look fulfillment-ready on redirect success alone.
      expect(event.stableType).toBe("payment.processing");
      expect(event.event?.type).toBe("payment.processing");
      expect(event.stableType).not.toBe("payment.succeeded");
    });

    it("forces TRANSACTION_RESPONSE even when redirect supplies type=TRANSACTION (PAYMOB-3)", () => {
      // type is not HMAC-bound on browser callbacks; trusting it would skip demotion.
      const payload = {
        id: "123456789",
        type: "TRANSACTION",
        pending: "false",
        success: "true",
        amount_cents: "10000",
        currency: "SAR",
        created_at: "2024-12-31T12:00:00Z",
      };

      const event = gateway.parseWebhookEvent(payload);

      expect(event.type).toBe("TRANSACTION_RESPONSE");
      expect(event.type).not.toBe("TRANSACTION");
      expect(event.id).toBe("123456789:redirect");
      expect(event.status).toBe("processing");
      expect(event.status).not.toBe("paid");
      // Settlement arms must stay demoted — never look fulfillment-ready on redirect.
      expect(event.stableType).toBe("payment.processing");
      expect(event.stableType).not.toBe("payment.succeeded");
      expect(event.event?.type).toBe("payment.processing");
    });

    it("qualifies redirect event.id so it does not collide with processed TRANSACTION (WEBHOOKS-1)", () => {
      const redirect = gateway.parseWebhookEvent({
        id: "123456789",
        pending: "false",
        success: "true",
        amount_cents: "10000",
        currency: "SAR",
        created_at: "2024-12-31T12:00:00Z",
      });
      const processed = gateway.parseWebhookEvent(createMockWebhookPayload({ id: 123456789 }));

      expect(processed.id).toBe("123456789");
      expect(redirect.id).toBe("123456789:redirect");
      expect(redirect.id).not.toBe(processed.id);
      expect(redirect.gatewayPaymentId).toBe("123456789");
      expect(processed.gatewayPaymentId).toBe("123456789");
      expect(redirect.type).toBe("TRANSACTION_RESPONSE");
      expect(processed.type).toBe("TRANSACTION");
    });

    it("rejects Paymob callbacks with invalid timestamps instead of using the current time", () => {
      expect(() => gateway.parseWebhookEvent(createMockWebhookPayload({
        created_at: "not-a-date",
      }))).toThrow(InvalidWebhookError);
    });

    it("does not default a missing webhook type to TRANSACTION fulfillment", () => {
      const payload = createMockWebhookPayload();
      const { type: _omittedType, ...withoutType } = payload;
      void _omittedType;

      const event = gateway.parseWebhookEvent(withoutType);

      expect(event.type).not.toBe("TRANSACTION");
      expect(event.stableType).not.toBe("payment.succeeded");
      expect(event.event?.type).toBe("provider.unmapped");
      expect(event.stableType).toBeUndefined();
    });

    it("Phase 7 dual-write: success TRANSACTION → payment.succeeded", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload());

      expect(event.type).toBe("TRANSACTION");
      expect(event.status).toBe("paid");
      expect(event.schemaVersion).toBe("1");
      expect(event.stableType).toBe("payment.succeeded");
      expect(event.event?.schemaVersion).toBe("1");
      expect(event.event?.type).toBe("payment.succeeded");
      expect(event.provider?.eventType).toBe("TRANSACTION");
      expect(event.payloadHash).toBeDefined();

      const envelope = toPersistedPaymentEventEnvelope(event.event!, {
        payloadHash: event.payloadHash,
      });
      assertNoSecretsInEnvelope(envelope);
    });

    it("Phase 7 dual-write: fail / void / refund / TOKEN stable types", () => {
      const failed = gateway.parseWebhookEvent(
        createMockWebhookPayload({ success: false, pending: false }),
      );
      expect(failed.status).toBe("failed");
      expect(failed.stableType).toBe("payment.failed");
      expect(failed.event?.type).toBe("payment.failed");

      const voided = gateway.parseWebhookEvent(
        createMockWebhookPayload({
          success: true,
          is_void: true,
          is_voided: undefined,
        } as Partial<PaymobWebhookPayload["obj"]>),
      );
      expect(voided.stableType).toBe("payment.cancelled");

      const refunded = gateway.parseWebhookEvent(
        createMockWebhookPayload({
          success: true,
          is_refund: true,
          is_refunded: undefined,
        } as Partial<PaymobWebhookPayload["obj"]>),
      );
      // Incomplete refund_completed (no trusted refunded total) dual-writes refund.pending
      // so Phase-7-only handlers do not treat the refund entity as terminal (PAYMOB-3).
      expect(refunded.status).toBe("refund_completed");
      expect(refunded.stableType).toBe("refund.pending");
      expect(refunded.event?.type).toBe("refund.pending");
      expect(refunded.amount).toBeUndefined();

      const token = gateway.parseWebhookEvent({
        type: "TOKEN",
        obj: {
          id: 9988,
          token: "tok_saved_card_123",
          masked_pan: "512345xxxxxx2346",
          merchant_id: 302852,
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          order_id: "order_abc123",
          next_payment_intention: "pi_next_123",
        },
      });
      expect(token.stableType).toBe("payment_method.setup_completed");
      expect(token.event?.type).toBe("payment_method.setup_completed");
      if (token.event?.type === "payment_method.setup_completed") {
        expect(token.event.setup.token).toBe("tok_saved_card_123");
      }
    });

    it("Phase 7 dual-write: signed is_refunded + unsigned amount → refund.pending incomplete (PAYMOB-3)", () => {
      // Unsigned refunded_amount_cents cannot choose partial vs full (PAYMOB-2).
      const partialInject = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        amount_cents: 10000,
        refunded_amount_cents: 2500,
      }));
      const fullInject = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        amount_cents: 10000,
        refunded_amount_cents: 10000,
      }));

      for (const event of [partialInject, fullInject]) {
        expect(event.status).toBe("refund_completed");
        // PAYMOB-3: incomplete money → refund.pending dual-write (not completed).
        expect(event.stableType).toBe("refund.pending");
        expect(event.event?.type).toBe("refund.pending");
        expect(event.provider?.eventType).toBe("TRANSACTION");
        // PAYMOB-3: omit order total as refund amount on incomplete snapshots.
        expect(event.amount).toBeUndefined();
      }
    });

    it("Phase 7 dual-write: unsigned amount-only refund stays payment.succeeded (fail-closed)", () => {
      // Without signed refund flags, refunded_amount_cents must not flip status.
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: false,
        amount_cents: 10000,
        captured_amount: 5000,
        refunded_amount_cents: 5000,
      }));

      expect(event.status).toBe("paid");
      expect(event.stableType).toBe("payment.succeeded");
      expect(event.stableType).not.toBe("refund.completed");
    });

    it("Phase 7 dual-write: is_auth + unsigned captured_amount stays payment.authorized", () => {
      // Unsigned captured_amount must not promote auth → paid/partial on webhook path.
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: true,
        is_capture: false,
        is_captured: false,
        amount_cents: 10000,
        captured_amount: 5000,
      }));

      expect(event.status).toBe("authorized");
      expect(event.stableType).toBe("payment.authorized");
      expect(event.stableType).not.toBe("payment.succeeded");
      expect(event.event?.type).toBe("payment.authorized");
    });

    it("Phase 7 dual-write: is_capture signed true without captured_amount → processing (PAYMOB-1)", () => {
      // is_capture is HMAC-covered but captured_amount is unsigned/stripped — cannot
      // prove full vs partial capture. Fail-closed: processing, not paid / capture.completed.
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: false,
        is_capture: true,
        amount_cents: 10000,
        captured_amount: 5000,
      }));

      expect(event.status).toBe("processing");
      expect(event.status).not.toBe("paid");
      expect(event.status).not.toBe("partially_captured");
      expect(event.stableType).toBe("payment.processing");
      expect(event.stableType).not.toBe("capture.completed");
      expect(event.stableType).not.toBe("payment.succeeded");
      expect(event.event?.type).toBe("payment.processing");
      // PAYMOB-1: omit amount on incomplete capture (symmetric with incomplete refunds).
      expect(event.amount).toBeUndefined();
      if (event.event?.type === "payment.processing") {
        expect(event.event.payment.amount).toBeUndefined();
        // PAYMOB-2: order.id is parent only — not gatewayObjectId / captureId.
        expect(event.gatewayObjectId).toBeUndefined();
        expect(event.event.payment.references.parentId).toBe("987654");
        expect(event.event.payment.references.relatedIds?.orderId).toBe("987654");
        expect(event.event.payment.references.relatedIds?.captureId).not.toBe("987654");
      }
    });

    it("Phase 7 dual-write: failed is_refund action is payment.failed not refund.completed", () => {
      // Align dual-write with mapTransactionStatus: failed refund action is failed.
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: false,
        is_refund: true,
        is_refunded: undefined,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(event.status).toBe("failed");
      expect(event.stableType).toBe("payment.failed");
      expect(event.event?.type).toBe("payment.failed");
    });

    it("redirect callbacks ignore unsigned capture/refund amounts (PAYMOB-5 fail-closed)", () => {
      const payload = {
        id: "123456789",
        pending: "false",
        success: "true",
        amount_cents: "10000",
        currency: "SAR",
        created_at: "2024-12-31T12:00:00Z",
        is_auth: "true",
        is_capture: "false",
        is_refunded: "false",
        is_voided: "false",
        // Unsigned / not mapped from redirect query even if present
        captured_amount: "5000",
        is_captured: "true",
        refunded_amount_cents: "2500",
        merchant_order_id: "payment_123",
      };

      const event = gateway.parseWebhookEvent(payload);
      expect(event.type).toBe("TRANSACTION_RESPONSE");
      // Unsigned amounts/is_captured must not promote auth → paid/partial.
      // S19-PAYMOB-REDIR-STATUS: envelope status matches dual-write processing.
      expect(event.status).toBe("processing");
      expect(event.status).not.toBe("paid");
      expect(event.status).not.toBe("authorized");
      // AUTH redirect is browser-only (PAYMOB-AUTH-REDIR): dual-write is
      // processing, same as sale redirect.
      expect(event.stableType).toBe("payment.processing");
      expect(event.stableType).not.toBe("payment.authorized");
      expect(event.stableType).not.toBe("payment.succeeded");
      expect(event.stableType).not.toBe("capture.completed");
    });
  });

  describe("Lifecycle Hooks", () => {
    it("executes beforeCreatePayment hook", async () => {
      let hookCalled = false;
      let hookGateway: string | undefined;
      let hookOperation: string | undefined;

      const hooksWithBefore = new HooksManager({
        beforeCreatePayment: async (ctx: HookContext<CreatePaymentParams>) => {
          hookCalled = true;
          hookGateway = ctx.gateway;
          hookOperation = ctx.operation;
          return { proceed: true };
        },
      });

      const gatewayWithHooks = new PaymobGateway(PAYMOB_TEST_CONFIG, hooksWithBefore);
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gatewayWithHooks.createPayment(VALID_CREATE_PARAMS);

      expect(hookCalled).toBe(true);
      expect(hookGateway).toBe("paymob");
      expect(hookOperation).toBe("createPayment");
    });

    it("aborts void when hook returns proceed false", async () => {
      const hooksWithAbort = new HooksManager({
        onBefore: async () => ({ proceed: false, abortReason: "Void blocked by security check" }),
      });
      const gatewayWithAbort = new PaymobGateway(withMutationFence(), hooksWithAbort);

      await expect(
        gatewayWithAbort.voidPayment({ gatewayPaymentId: "test_id", idempotencyKey: nextMutationKey() }),
      ).rejects.toThrow("Void blocked by security check");
    });
  });
});
