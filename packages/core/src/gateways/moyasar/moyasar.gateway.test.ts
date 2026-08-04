import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HooksManager } from "../../hooks/hooks.manager";
import {
  AuthenticationError,
  CardDeclinedError,
  InvalidRequestError,
  InvalidWebhookError,
  NetworkError,
  PaymentAbortedError,
  RateLimitError,
  ResourceNotFoundError,
} from "../../errors";
import type { PaymentHooks } from "../../hooks/hooks.types";
import type { MoyasarConfig } from "../../types/config.types";
import {
  assertNoSecretsInEnvelope,
  toPersistedPaymentEventEnvelope,
} from "../../types/payment-event";
import { MoyasarGateway } from "./moyasar.gateway";
import { InMemoryIdempotencyStore } from "../../utils/idempotency";
import { money } from "../../utils/money";

const CONFIG: MoyasarConfig = {
  secretKey: "sk_test_unit",
  webhookSecret: "webhook_secret",
};

const PAYMENT_ID = "760878ec-d1d3-5f72-9056-191683f55872";
const MISSING_PAYMENT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const originalFetch = globalThis.fetch;

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function createGateway(
  config: MoyasarConfig = CONFIG,
  hooks: PaymentHooks = {},
): MoyasarGateway {
  return new MoyasarGateway(config, new HooksManager(hooks));
}

function paymentResponse(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: PAYMENT_ID,
    status: "paid",
    amount: 10000,
    fee: 250,
    currency: "SAR",
    refunded: 0,
    captured: 10000,
    amount_format: "100.00 SAR",
    fee_format: "2.50 SAR",
    refunded_format: "0.00 SAR",
    captured_format: "100.00 SAR",
    ip: "127.0.0.1",
    created_at: "2026-05-21T10:00:00Z",
    updated_at: "2026-05-21T10:00:00Z",
    refunded_at: null,
    captured_at: "2026-05-21T10:00:00Z",
    voided_at: null,
    description: "Payment",
    invoice_id: null,
    callback_url: "https://example.com/callback",
    metadata: {},
    source: {
      type: "token",
      transaction_url: null,
    },
    ...overrides,
  };
}

function mockFetchJson(body: unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function mockFetchError(error: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    throw error;
  }) as typeof fetch;
}

function mockFetchSequence(
  ...responses: Array<{ body: unknown; status?: number } | Error>
): void {
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    const next = responses[index++];
    if (next === undefined) {
      throw new Error("Unexpected fetch call");
    }
    if (next instanceof Error) {
      throw next;
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function lastRequestBody(): Record<string, any> {
  const body = fetchCalls.at(-1)?.init?.body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string);
}

function lastRequestBodyOrUndefined(): unknown {
  const body = fetchCalls.at(-1)?.init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

beforeEach(() => {
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MoyasarGateway", () => {
  describe("createPayment", () => {
    it("maps capture false to Moyasar source.manual for token payments", async () => {
      mockFetchJson(paymentResponse({ status: "authorized", captured: 0 }));

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        capture: false,
        moyasarSource: {
          type: "token",
          token: "token_test_123",
        },
      });

      const body = lastRequestBody();
      expect(body.amount).toBe(10000);
      expect(body.callback_url).toBe("https://example.com/callback");
      expect(body.source).toEqual({
        type: "token",
        token: "token_test_123",
        manual: true,
      });
    });

    it("rejects raw credit card sources before sending cardholder data to the backend API", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          moyasarSource: {
            type: "creditcard",
            name: "Saleh Ali",
            number: "4111111111111111",
            month: 12,
            year: 2029,
            cvc: "123",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("lets manualCapture override capture false", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 50,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        capture: false,
        moyasarSource: {
          type: "token",
          token: "token_test_123",
          manualCapture: false,
        },
      });

      expect(lastRequestBody().source.manual).toBe(false);
    });

    it("requires callbackUrl for token payments", async () => {
      await expect(
        createGateway().createPayment({
          amount: 10,
          currency: "SAR",
          moyasarSource: {
            type: "token",
            token: "token_test_123",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("requires a Moyasar source before making an API request", async () => {
      await expect(
        createGateway().createPayment({
          amount: 10,
          currency: "SAR",
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("marks API-successful failed payments as unsuccessful", async () => {
      mockFetchJson(
        paymentResponse({
          status: "failed",
          source: {
            type: "token",
            message: "Declined",
            transaction_url: null,
          },
        }),
        201,
      );

      const result = await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        moyasarSource: {
          type: "token",
          token: "token_test_123",
        },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.outcome).toBe("declined");
      expect(result.references?.providerObjectId).toBe(result.gatewayId);
      expect(result.decline?.message).toBe("Declined");
    });

    it("marks unmapped provider statuses as unsuccessful (success false)", async () => {
      const warnings: string[] = [];
      const logger = {
        debug() {},
        info() {},
        warn: (message: string) => warnings.push(message),
        error() {},
      };
      mockFetchJson(
        paymentResponse({
          status: "totally_unknown_status",
        }),
        201,
      );

      const result = await new MoyasarGateway(
        CONFIG,
        new HooksManager(),
        logger,
      ).createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        moyasarSource: {
          type: "token",
          token: "token_test_123",
        },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(warnings.some((w) => w.includes("Unmapped payment status"))).toBe(
        true,
      );
    });

    it("marks abandoned payments as unsuccessful", async () => {
      mockFetchJson(
        paymentResponse({
          status: "abandoned",
        }),
        201,
      );

      const result = await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        moyasarSource: {
          type: "token",
          token: "token_test_123",
        },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
    });

    it("does not require callbackUrl for STC Pay and returns OTP nextAction", async () => {
      mockFetchJson(
        paymentResponse({
          status: "initiated",
          captured: 0,
          source: {
            type: "stcpay",
            transaction_url: "https://api.moyasar.com/stc/otp",
          },
        }),
      );

      const result = await createGateway().createPayment({
        amount: 75,
        currency: "SAR",
        moyasarSource: {
          type: "stcpay",
          mobile: "0512345678",
        },
      });

      const body = lastRequestBody();
      expect(body.callback_url).toBeUndefined();
      expect(result.redirectUrl).toBeUndefined();
      expect(result.nextAction).toEqual({
        type: "stcpay_otp",
        transactionUrl: "https://api.moyasar.com/stc/otp",
        method: "POST",
        parameter: "otp_value",
      });
      // Phase 6: OTP challenge is requires_action, never succeeded
      expect(result.outcome).toBe("requires_action");
      expect(result.outcome).not.toBe("succeeded");
      expect(result.success).toBe(true); // 0.x dual-write: API ok
      expect(result.references?.providerObjectId).toBe(result.gatewayId);
      expect(result.references?.providerNativeStatus).toBe("initiated");
    });

    it("accepts Moyasar's documented local STC Pay mobile number without plus prefix", async () => {
      mockFetchJson(
        paymentResponse({
          status: "initiated",
          captured: 0,
          source: {
            type: "stcpay",
            transaction_url: "https://api.moyasar.com/stc/otp",
          },
        }),
      );

      await createGateway().createPayment({
        amount: 75,
        currency: "SAR",
        moyasarSource: {
          type: "stcpay",
          mobile: "966512345678",
        },
      });

      expect(lastRequestBody().source.mobile).toBe("966512345678");
    });

    it("rejects metadata that cannot be represented safely in Moyasar metadata", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          moyasarSource: {
            type: "stcpay",
            mobile: "0512345678",
          },
          metadata: {
            nested: { id: "not-supported" },
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects non-string metadata values before sending the request", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          moyasarSource: {
            type: "stcpay",
            mobile: "0512345678",
          },
          metadata: {
            customerId: 123,
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("validates final metadata after adding order correlation keys", async () => {
      const metadata: Record<string, string> = {};
      for (let index = 0; index < 29; index += 1) {
        metadata[`key${index}`] = `value${index}`;
      }

      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          orderId: "order_123",
          moyasarSource: {
            type: "stcpay",
            mobile: "0512345678",
          },
          metadata,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("uses currency minor units for create response mapping", async () => {
      mockFetchJson(
        paymentResponse({
          amount: 1234,
          fee: 12,
          captured: 1234,
          refunded: 0,
          currency: "KWD",
        }),
      );

      const result = await createGateway().createPayment({
        amount: 1.234,
        currency: "KWD",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
      });

      expect(lastRequestBody().amount).toBe(1234);
      expect(result.amount).toBe(1.234);
      expect(result.fee).toBe(0.012);
      expect(result.capturedAmount).toBe(1.234);
    });

    it("accepts Money amount input for createPayment (bigint minor conversion)", async () => {
      mockFetchJson(paymentResponse({ amount: 1050, currency: "SAR" }));

      const result = await createGateway().createPayment({
        amount: money("10.50", "SAR"),
        currency: "SAR",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
      });

      expect(lastRequestBody().amount).toBe(1050);
      expect(result.amount).toBe(10.5);
    });

    it("rejects Money amounts with excess currency precision", async () => {
      await expect(
        createGateway().createPayment({
          // Money-shaped input (not pre-validated by money()) so gateway conversion rejects.
          amount: { amount: "10.999", currency: "SAR" },
          currency: "SAR",
          moyasarSource: {
            type: "applepay",
            token: "encrypted_token",
          },
        }),
      ).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("maps decrypted Apple Pay fields to Moyasar API names", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        moyasarSource: {
          type: "applepay",
          dpan: "4111111111111111",
          month: 12,
          year: 2029,
          cryptogram: "cryptogram",
          deviceId: "device123",
          lastFour: "1111",
          eci: "05",
        },
      });

      expect(lastRequestBody().source).toEqual({
        type: "applepay",
        number: "4111111111111111",
        month: 12,
        year: 2029,
        cryptogram: "cryptogram",
        device_id: "device123",
        last_four: "1111",
        eci: "05",
      });
    });

    it("rejects invalid Apple Pay shape with InvalidRequestError (not GatewayApiError)", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          moyasarSource: {
            type: "applepay",
            // Neither encrypted token nor decrypted DPAN fields
          } as any,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects capture:false for decrypted Apple Pay (DPAN) sources", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          capture: false,
          moyasarSource: {
            type: "applepay",
            dpan: "4111111111111111",
            month: 12,
            year: 2029,
            cryptogram: "cryptogram",
            deviceId: "device123",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects capture:false for STC Pay sources", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          capture: false,
          moyasarSource: {
            type: "stcpay",
            mobile: "0512345678",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("uppercases currency on create payment requests", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "sar",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
      });

      expect(lastRequestBody().currency).toBe("SAR");
    });

    it("converts split amounts from major units to Moyasar minor units", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        idempotencyKey: "a1168bd1-47a4-4b97-8a50-dd5caaccacf2",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
        splits: [
          {
            amount: 50, // major units → 5000 halalas
            recipient_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            reference: "split_1",
            fee_source: true,
          },
        ],
        recipient: {
          first_name: "Saleh",
          last_name: "Ali",
          address: "Riyadh",
        },
        sender: {
          account: {
            funds_source: "01",
            number: "123456789",
          },
          first_name: "Sara",
          last_name: "Ali",
          address: "Riyadh",
          country_code: "SA",
          id_type: "NTID",
          id: "1234567890",
          phone_number: "0512345678",
        },
      });

      const body = lastRequestBody();
      expect(body.given_id).toBe("a1168bd1-47a4-4b97-8a50-dd5caaccacf2");
      expect(body.splits).toEqual([
        {
          amount: 5000,
          recipient_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          reference: "split_1",
          fee_source: true,
        },
      ]);
      expect(body.recipient.first_name).toBe("Saleh");
      expect(body.sender.account.funds_source).toBe("01");
    });

    it("converts negative split amounts to minor units when reverse splits are used", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
        splits: [
          {
            amount: 120,
            recipient_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          },
          {
            amount: -20,
            recipient_id: "4fa85f64-5717-4562-b3fc-2c963f66afa6",
          },
        ],
      });

      expect(lastRequestBody().splits.map((s: { amount: number }) => s.amount)).toEqual([
        12000,
        -2000,
      ]);
    });

    it("copies orderId into Moyasar metadata for webhook correlation", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        orderId: "order_123",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
        metadata: {
          customerId: "customer_456",
        },
      });

      expect(lastRequestBody().metadata).toEqual({
        customerId: "customer_456",
        orderId: "order_123",
        paymentId: "order_123",
      });
    });

    it("does not overwrite explicit metadata order correlation fields", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        orderId: "order_123",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
        metadata: {
          orderId: "external_order",
          paymentId: "payment_789",
        },
      });

      expect(lastRequestBody().metadata).toEqual({
        orderId: "external_order",
        paymentId: "payment_789",
      });
    });

    it("requires Moyasar idempotencyKey to be a UUID", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          idempotencyKey: "order_123",
          moyasarSource: {
            type: "applepay",
            token: "encrypted_token",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects legacy tokenId values that do not match Moyasar token format", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          tokenId: "bad_token",
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects amounts below one minor unit", async () => {
      await expect(
        createGateway().createPayment({
          amount: 0.001,
          currency: "SAR",
          moyasarSource: {
            type: "applepay",
            token: "encrypted_token",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects amounts with unsupported currency precision", async () => {
      await expect(
        createGateway().createPayment({
          amount: 1.235,
          currency: "SAR",
          moyasarSource: {
            type: "applepay",
            token: "encrypted_token",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("capturePayment and refundPayment", () => {
    it("uses provided currency minor units for partial capture", async () => {
      mockFetchJson(paymentResponse({ currency: "KWD", amount: 1234, captured: 1234 }));

      await createGateway().capturePayment({
        gatewayPaymentId: PAYMENT_ID,
        amount: 1.234,
        currency: "KWD",
      });

      expect(fetchCalls[0]?.url).toBe(
        `https://api.moyasar.com/v1/payments/${PAYMENT_ID}/capture`,
      );
      expect(lastRequestBody().amount).toBe(1234);
    });

    it("requires currency for partial captures instead of defaulting to SAR", async () => {
      await expect(
        createGateway().capturePayment({
          gatewayPaymentId: PAYMENT_ID,
          amount: 1.234,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("omits request body and Content-Type for full capture", async () => {
      mockFetchJson(paymentResponse({ status: "captured" }));

      await createGateway().capturePayment({
        gatewayPaymentId: PAYMENT_ID,
      });

      expect(lastRequestBodyOrUndefined()).toBeUndefined();
      const headers = fetchCalls[0]?.init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBeUndefined();
    });

    it("maps refund totals using response currency minor units", async () => {
      mockFetchJson(
        paymentResponse({
          status: "refunded",
          currency: "KWD",
          amount: 1234,
          refunded: 1234,
          refunded_at: "2026-05-21T10:05:00Z",
        }),
      );

      const result = await createGateway().refundPayment({
        gatewayPaymentId: PAYMENT_ID,
        amount: 1.234,
        currency: "KWD",
      });

      expect(lastRequestBody().amount).toBe(1234);
      expect(result.status).toBe("completed");
      expect(result.outcome).toBe("succeeded");
      expect(result.success).toBe(true);
      expect(result.totalRefunded).toBe(1.234);
      expect(result.refundedAt).toEqual(new Date("2026-05-21T10:05:00Z"));
    });

    it("marks partial refunds completed even when provider status is still paid", async () => {
      mockFetchJson(
        paymentResponse({
          status: "paid",
          amount: 10000,
          captured: 10000,
          refunded: 4000,
          refunded_at: "2026-05-21T10:05:00Z",
        }),
      );

      const result = await createGateway().refundPayment({
        gatewayPaymentId: PAYMENT_ID,
        amount: 40,
        currency: "SAR",
      });

      expect(result.status).toBe("completed");
      expect(result.outcome).toBe("succeeded");
      expect(result.success).toBe(true);
      expect(result.totalRefunded).toBe(40);
    });

    it("maps getPayment partial refund amounts to partially_refunded", async () => {
      mockFetchJson(
        paymentResponse({
          status: "paid",
          amount: 10000,
          captured: 10000,
          refunded: 2500,
        }),
      );

      const result = await createGateway().getPayment({
        gatewayPaymentId: PAYMENT_ID,
      });

      expect(result.status).toBe("partially_refunded");
      expect(result.refundedAmount).toBe(25);
    });

    it("maps Moyasar verified status to setup_completed (not authorized)", async () => {
      mockFetchJson(
        paymentResponse({
          status: "verified",
          amount: 0,
          captured: 0,
          refunded: 0,
        }),
      );

      const result = await createGateway().getPayment({
        gatewayPaymentId: PAYMENT_ID,
      });

      expect(result.status).toBe("setup_completed");
    });

    it("maps partial capture amounts to partially_captured", async () => {
      mockFetchJson(
        paymentResponse({
          status: "authorized",
          amount: 10000,
          captured: 3000,
          refunded: 0,
        }),
      );

      const result = await createGateway().capturePayment({
        gatewayPaymentId: PAYMENT_ID,
        amount: 30,
        currency: "SAR",
      });

      expect(result.status).toBe("partially_captured");
      expect(result.capturedAmount).toBe(30);
    });

    it("requires currency for partial refunds instead of defaulting to SAR", async () => {
      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: PAYMENT_ID,
          amount: 1.234,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("omits request body and Content-Type for full refund", async () => {
      mockFetchJson(paymentResponse({ status: "refunded" }));

      await createGateway().refundPayment({
        gatewayPaymentId: PAYMENT_ID,
      });

      expect(lastRequestBodyOrUndefined()).toBeUndefined();
      const headers = fetchCalls[0]?.init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBeUndefined();
    });

    it("omits Content-Type for void (empty body)", async () => {
      mockFetchJson(paymentResponse({ status: "voided" }));

      await createGateway().voidPayment({
        gatewayPaymentId: PAYMENT_ID,
      });

      expect(lastRequestBodyOrUndefined()).toBeUndefined();
      const headers = fetchCalls[0]?.init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBeUndefined();
    });

    it("keeps Moyasar validation error details when error fields are not arrays", async () => {
      mockFetchJson(
        {
          type: "invalid_request_error",
          message: "Invalid request",
          errors: {
            amount: "must be a positive integer",
          },
        },
        400,
      );

      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: PAYMENT_ID,
        }),
      ).rejects.toThrow("amount: must be a positive integer");
    });

    it("maps Moyasar documented invalid_request errors to InvalidRequestError", async () => {
      mockFetchJson(
        {
          type: "invalid_request",
          message: "Invalid request",
          errors: {
            amount: ["must be positive"],
          },
        },
        400,
      );

      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: PAYMENT_ID,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
    });

    it("maps Moyasar not-found responses to ResourceNotFoundError", async () => {
      mockFetchJson(
        {
          type: "record_not_found",
          message: "Payment was not found",
          errors: null,
        },
        404,
      );

      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: MISSING_PAYMENT_ID,
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("maps 3ds_auth_error to CardDeclinedError (not AuthenticationError)", async () => {
      mockFetchJson(
        {
          type: "3ds_auth_error",
          message: "3DS authentication failed",
          errors: null,
        },
        400,
      );

      let caught: unknown;
      try {
        await createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          moyasarSource: { type: "token", token: "token_abc" },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CardDeclinedError);
      expect(caught).not.toBeInstanceOf(AuthenticationError);
      expect((caught as CardDeclinedError).message).toBe(
        "3DS authentication failed",
      );
    });

    it("keeps authentication_error as AuthenticationError", async () => {
      mockFetchJson(
        {
          type: "authentication_error",
          message: "Invalid secret key",
          errors: null,
        },
        401,
      );

      await expect(
        createGateway().getPayment({ gatewayPaymentId: PAYMENT_ID }),
      ).rejects.toBeInstanceOf(AuthenticationError);
    });
  });

  describe("confirmStcPayOtp", () => {
    it("posts otp_value to the Moyasar STC Pay transaction URL", async () => {
      const transactionUrl =
        "https://api.moyasar.com/v1/stc_pays/6187b1f9-ihn2-457b-a8bc-e2j5c808ff94/proceed?otp_token=abc";
      mockFetchJson(
        paymentResponse({
          status: "paid",
          source: {
            type: "stcpay",
            transaction_url: transactionUrl,
          },
        }),
      );

      const result = await createGateway().confirmStcPayOtp({
        transactionUrl,
        otpValue: "123456",
      });

      expect(fetchCalls[0]?.url).toBe(transactionUrl);
      expect(fetchCalls[0]?.init?.headers).not.toHaveProperty("Authorization");
      expect(lastRequestBody()).toEqual({ otp_value: "123456" });
      expect(result.status).toBe("paid");
      expect(result.outcome).toBe("succeeded");
      expect(result.references?.providerObjectId).toBe(result.gatewayId);
    });

    it("runs global lifecycle hooks for OTP confirmation", async () => {
      const transactionUrl =
        "https://api.moyasar.com/v1/stc_pays/6187b1f9-ihn2-457b-a8bc-e2j5c808ff94/proceed?otp_token=abc";
      const operations: string[] = [];
      mockFetchJson(
        paymentResponse({
          status: "paid",
          source: {
            type: "stcpay",
            transaction_url: transactionUrl,
          },
        }),
      );

      await createGateway(CONFIG, {
        onBefore: (ctx) => {
          operations.push(`before:${ctx.operation}`);
          return { proceed: true };
        },
        onAfter: (ctx) => {
          operations.push(`after:${ctx.operation}`);
          return { proceed: true };
        },
      }).confirmStcPayOtp({
        transactionUrl,
        otpValue: "123456",
      });

      expect(operations).toEqual([
        "before:confirmStcPayOtp",
        "after:confirmStcPayOtp",
      ]);
    });

    it("rejects non-Moyasar STC Pay transaction URLs", async () => {
      await expect(
        createGateway().confirmStcPayOtp({
          transactionUrl: "https://example.com/v1/stc_pays/abc/proceed",
          otpValue: "123456",
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("getPayment", () => {
    it("validates gatewayPaymentId before fetching", async () => {
      await expect(
        createGateway().getPayment({ gatewayPaymentId: "" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects non-UUID Moyasar payment IDs before making API requests", async () => {
      await expect(
        createGateway().getPayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      await expect(
        createGateway().capturePayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      await expect(
        createGateway().refundPayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      await expect(
        createGateway().voidPayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("maps fetch failures to NetworkError", async () => {
      mockFetchError(new Error("offline"));

      await expect(
        createGateway().getPayment({ gatewayPaymentId: PAYMENT_ID }),
      ).rejects.toBeInstanceOf(NetworkError);
    });

    it("aborts requests that exceed the configured timeout", async () => {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        throw new Error("unreachable");
      }) as typeof fetch;

      await expect(
        createGateway({ ...CONFIG, timeoutMs: 1 }).getPayment({
          gatewayPaymentId: PAYMENT_ID,
        }),
      ).rejects.toBeInstanceOf(NetworkError);
    });

    it("rejects getPayment with pre-aborted signal without hanging", async () => {
      const controller = new AbortController();
      controller.abort();

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        if (init?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return new Response(JSON.stringify(paymentResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      await expect(
        createGateway().getPayment({
          gatewayPaymentId: PAYMENT_ID,
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(PaymentAbortedError);
    });

    it("aborts mid-flight createPayment when caller signal fires", async () => {
      const controller = new AbortController();

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
          setTimeout(() => controller.abort(), 5);
        });
        throw new Error("unreachable");
      }) as typeof fetch;

      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          moyasarSource: { type: "token", token: "token_test_abc" },
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(PaymentAbortedError);
    });

    it("keeps timeout NetworkError when no caller signal is provided", async () => {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        throw new Error("unreachable");
      }) as typeof fetch;

      await expect(
        createGateway({ ...CONFIG, timeoutMs: 1 }).createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          moyasarSource: { type: "token", token: "token_test_abc" },
        }),
      ).rejects.toBeInstanceOf(NetworkError);
    });

    it("does not strip signal through Moyasar schema validation before HTTP", async () => {
      let sawSignal = false;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        sawSignal = init?.signal instanceof AbortSignal;
        return new Response(JSON.stringify(paymentResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const controller = new AbortController();
      await createGateway().getPayment({
        gatewayPaymentId: PAYMENT_ID,
        signal: controller.signal,
      });
      expect(sawSignal).toBe(true);
    });
  });

  describe("webhooks", () => {
    it("fails closed when webhookSecret is not configured", () => {
      const gateway = createGateway({ secretKey: "sk_test_unit" });

      expect(
        gateway.verifyWebhook({
          secret_token: "anything",
        }),
      ).toBe(false);
    });

    it("verifies secret_token exactly", () => {
      const gateway = createGateway();

      expect(gateway.verifyWebhook({ secret_token: "webhook_secret" })).toBe(true);
      expect(gateway.verifyWebhook({ secret_token: "wrong" })).toBe(false);
      expect(gateway.verifyWebhook({})).toBe(false);
      expect(gateway.verifyWebhook(null)).toBe(false);
    });

    it.each([
      // Same length as "webhook_secret" (14 chars) but different content
      ["an equal-length token with different content", "webhook_secreX"],
      // Longer than the configured secret (length-guard padded comparison)
      ["a token longer than the configured secret", "webhook_secret_extra"],
      // Shorter / empty tokens
      ["a shorter token", "webhook"],
      ["an empty token", ""],
    ])("rejects %s timing-safely", (_label, secretToken) => {
      expect(createGateway().verifyWebhook({ secret_token: secretToken })).toBe(
        false,
      );
    });

    it("rejects non-string tokens timing-safely", () => {
      expect(createGateway().verifyWebhook({ secret_token: 123 })).toBe(false);
    });

    it("rejects malformed webhook payloads during parsing", () => {
      expect(() => createGateway().parseWebhookEvent({})).toThrow(
        InvalidWebhookError,
      );
    });

    it("parses Moyasar underscore event names and currency minor units", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 1234,
          currency: "KWD",
          metadata: {
            paymentId: "internal_123",
          },
        },
      });

      expect(event.type).toBe("payment_paid");
      expect(event.status).toBe("paid");
      expect(event.amount).toBe(1.234);
      expect(event.paymentId).toBe("internal_123");
      expect(event.gatewayPaymentId).toBe(PAYMENT_ID);
    });

    it("strips secret_token from webhook rawPayload", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
        },
      });

      expect(event.rawPayload).toEqual({
        id: "wh_123",
        type: "payment_paid",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
        },
      });
      expect(
        (event.rawPayload as Record<string, unknown>).secret_token,
      ).toBeUndefined();
    });

    it("maps verified webhook status to setup_completed", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_verified",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "verified",
          amount: 0,
          currency: "SAR",
        },
      });

      expect(event.status).toBe("setup_completed");
    });

    it("sets livemode true when webhook envelope live is true", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        live: true,
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
        },
      });

      expect(event.livemode).toBe(true);
    });

    it("sets livemode false when webhook envelope live is false", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        live: false,
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
        },
      });

      expect(event.livemode).toBe(false);
    });

    it("maps partial refund amounts on webhooks to partially_refunded", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_refunded",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
          refunded: 2500,
          captured: 10000,
        },
      });

      expect(event.status).toBe("partially_refunded");
    });

    it("maps unmapped provider statuses to failed (fail-closed)", () => {
      const warnings: string[] = [];
      const logger = {
        debug() {},
        info() {},
        warn: (message: string) => warnings.push(message),
        error() {},
      };
      const gateway = new MoyasarGateway(CONFIG, new HooksManager(), logger);

      const event = gateway.parseWebhookEvent({
        id: "wh_123",
        type: "payment_unknown",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "totally_unknown_status",
          amount: 10000,
          currency: "SAR",
        },
      });

      expect(event.status).toBe("failed");
      expect(warnings.some((w) => w.includes("Unmapped payment status"))).toBe(
        true,
      );
    });

    it("falls back to metadata.orderId when paymentId is absent", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
          metadata: {
            orderId: "order_123",
          },
        },
      });

      expect(event.paymentId).toBe("order_123");
    });

    it("maps Moyasar abandoned webhooks to failed status", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_abandoned",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "abandoned",
          amount: 10000,
          currency: "SAR",
          metadata: {
            paymentId: "internal_123",
          },
        },
      });

      expect(event.type).toBe("payment_abandoned");
      expect(event.status).toBe("failed");
    });

    it("normalizes Moyasar's documented failed webhook event spelling", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_faild",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "failed",
          amount: 10000,
          currency: "SAR",
          metadata: {
            paymentId: "internal_123",
          },
        },
      });

      expect(event.type).toBe("payment_failed");
      expect(event.status).toBe("failed");
    });

    it("rejects card_auth_* webhooks instead of mapping them as payments", () => {
      expect(() =>
        createGateway().parseWebhookEvent({
          id: "wh_card_auth",
          type: "card_auth_authenticated",
          secret_token: "webhook_secret",
          created_at: "2026-05-21T10:00:00Z",
          data: {
            id: "ca_2a1b3c4d",
            status: "authenticated",
            amount: 10000,
            currency: "SAR",
          },
        }),
      ).toThrow(InvalidWebhookError);

      expect(() =>
        createGateway().parseWebhookEvent({
          id: "wh_card_auth_fail",
          type: "card_auth_failed",
          secret_token: "webhook_secret",
          created_at: "2026-05-21T10:00:00Z",
          data: {
            id: "ca_2a1b3c4d",
            status: "failed",
            amount: 10000,
            currency: "SAR",
          },
        }),
      ).toThrow(InvalidWebhookError);
    });

    it("Phase 7 dual-write: payment_paid → payment.succeeded + redacted envelope", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_phase7_paid",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        live: false,
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
          metadata: { paymentId: "internal_123" },
        },
      });

      expect(event.type).toBe("payment_paid");
      expect(event.schemaVersion).toBe("1");
      expect(event.stableType).toBe("payment.succeeded");
      expect(event.event).toBeDefined();
      expect(event.event?.schemaVersion).toBe("1");
      expect(event.event?.type).toBe("payment.succeeded");
      expect(event.provider?.eventType).toBe("payment_paid");
      expect(event.provider?.eventId).toBe("wh_phase7_paid");
      expect(event.provider?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.provider?.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.payloadHash).toBeDefined();
      expect(
        (event.rawPayload as Record<string, unknown>).secret_token,
      ).toBeUndefined();

      const envelope = toPersistedPaymentEventEnvelope(event.event!, {
        payloadHash: event.payloadHash,
      });
      assertNoSecretsInEnvelope(envelope);
      expect(JSON.stringify(envelope)).not.toContain("webhook_secret");
      expect(JSON.stringify(envelope)).not.toContain("secret_token");
    });

    it("Phase 7 dual-write: payment_failed / payment_authorized / payment_refunded", () => {
      const failed = createGateway().parseWebhookEvent({
        id: "wh_f",
        type: "payment_faild",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "failed",
          amount: 10000,
          currency: "SAR",
        },
      });
      expect(failed.type).toBe("payment_failed");
      expect(failed.stableType).toBe("payment.failed");
      expect(failed.event?.type).toBe("payment.failed");
      if (failed.event?.type === "payment.failed") {
        expect(failed.event.failure.code).toBeDefined();
      }

      const auth = createGateway().parseWebhookEvent({
        id: "wh_a",
        type: "payment_authorized",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "authorized",
          amount: 10000,
          currency: "SAR",
        },
      });
      expect(auth.stableType).toBe("payment.authorized");
      expect(auth.status).toBe("authorized");

      const refunded = createGateway().parseWebhookEvent({
        id: "wh_r",
        type: "payment_refunded",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "refunded",
          amount: 10000,
          currency: "SAR",
          refunded: 10000,
        },
      });
      expect(refunded.stableType).toBe("refund.completed");
      expect(refunded.event?.type).toBe("refund.completed");
    });
  });

  describe("idempotent mutations", () => {
    it("replays a completed refund without a second API call", async () => {
      const idempotencyStore = new InMemoryIdempotencyStore();
      const gateway = createGateway({ ...CONFIG, idempotencyStore });
      mockFetchJson(paymentResponse({ status: "refunded", refunded: 10000 }));

      const params = {
        gatewayPaymentId: PAYMENT_ID,
        idempotencyKey: "refund-key-1",
      };

      const first = await gateway.refundPayment(params);
      const second = await gateway.refundPayment(params);

      expect(first.status).toBe("completed");
      expect(second).toEqual(first);
      // Only one network call despite two refundPayment invocations.
      expect(fetchCalls).toHaveLength(1);
    });

    it("does not double-refund: a retry after success is a no-op", async () => {
      const idempotencyStore = new InMemoryIdempotencyStore();
      const gateway = createGateway({ ...CONFIG, idempotencyStore });
      mockFetchJson(paymentResponse({ status: "refunded", refunded: 5000 }));

      const params = {
        gatewayPaymentId: PAYMENT_ID,
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund-key-2",
      };

      await gateway.refundPayment(params);
      await gateway.refundPayment(params);
      await gateway.refundPayment(params);

      expect(fetchCalls).toHaveLength(1);
    });

    it("rejects reusing an idempotency key with different parameters", async () => {
      const idempotencyStore = new InMemoryIdempotencyStore();
      const gateway = createGateway({ ...CONFIG, idempotencyStore });
      mockFetchJson(paymentResponse({ status: "refunded", refunded: 5000 }));

      await gateway.refundPayment({
        gatewayPaymentId: PAYMENT_ID,
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund-key-3",
      });

      await expect(
        gateway.refundPayment({
          gatewayPaymentId: PAYMENT_ID,
          amount: 60,
          currency: "SAR",
          idempotencyKey: "refund-key-3",
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
    });

    it("blocks replay after an indeterminate (network) refund failure", async () => {
      const idempotencyStore = new InMemoryIdempotencyStore();
      const gateway = createGateway({ ...CONFIG, idempotencyStore });
      mockFetchError(new Error("socket closed"));

      const params = {
        gatewayPaymentId: PAYMENT_ID,
        idempotencyKey: "refund-key-4",
      };

      await expect(gateway.refundPayment(params)).rejects.toBeInstanceOf(NetworkError);
      // The outcome is unknown, so a retry with the same key is refused rather
      // than risking a double refund.
      await expect(gateway.refundPayment(params)).rejects.toBeInstanceOf(InvalidRequestError);
    });

    it("allows retry after a definite (4xx) refund failure", async () => {
      const idempotencyStore = new InMemoryIdempotencyStore();
      const gateway = createGateway({ ...CONFIG, idempotencyStore });
      mockFetchSequence(
        { body: { type: "invalid_request", message: "bad", errors: null }, status: 400 },
        { body: paymentResponse({ status: "refunded", refunded: 10000 }) },
      );

      const params = {
        gatewayPaymentId: PAYMENT_ID,
        idempotencyKey: "refund-key-5",
      };

      await expect(gateway.refundPayment(params)).rejects.toBeInstanceOf(InvalidRequestError);
      // Definite failure cleared the reservation, so a retry runs the real call.
      const retried = await gateway.refundPayment(params);
      expect(retried.status).toBe("completed");
      expect(fetchCalls).toHaveLength(2);
    });

    it("retries a 5xx error on createPayment when an idempotency key is present", async () => {
      const gateway = createGateway();
      mockFetchSequence(
        { body: { type: "api_error", message: "server error" }, status: 503 },
        { body: paymentResponse() },
      );

      const result = await gateway.createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/cb",
        tokenId: "token_abc",
        idempotencyKey: "8f1e4d2a-1c3b-4a5e-9f60-2b7c8d9e0a11",
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("succeeded");
      expect(result.status).toBe("paid");
      expect(result.references?.providerObjectId).toBe(result.gatewayId);
      expect(fetchCalls).toHaveLength(2);
    });

    it("does not retry createPayment without an idempotency key", async () => {
      const gateway = createGateway();
      mockFetchSequence(
        { body: { type: "api_error", message: "server error" }, status: 503 },
        { body: paymentResponse() },
      );

      await expect(
        gateway.createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/cb",
          tokenId: "token_abc",
        }),
      ).rejects.toBeTruthy();
      // No idempotency key => no retry => exactly one call.
      expect(fetchCalls).toHaveLength(1);
    });
  });

  describe("rate limiting", () => {
    it("preserves Retry-After seconds when mapping 429 to RateLimitError", async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            type: "rate_limit_error",
            message: "Too many requests",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "retry-after": "30",
            },
          },
        )) as typeof fetch;

      const gateway = createGateway();
      let caught: unknown;
      try {
        // No idempotencyKey => no retry => fast, single attempt.
        await gateway.createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          moyasarSource: { type: "token", token: "token_abc" },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(RateLimitError);
      expect((caught as RateLimitError).retryAfterSeconds).toBe(30);
    });
  });

  describe("idempotency store safety", () => {
    const captureWarnings = () => {
      const warnings: string[] = [];
      const logger = {
        debug() {},
        info() {},
        warn: (message: string) => warnings.push(message),
        error() {},
      };
      return { warnings, logger };
    };

    it("warns when no idempotencyStore is configured", () => {
      const { warnings, logger } = captureWarnings();

      new MoyasarGateway(CONFIG, new HooksManager(), logger);

      expect(
        warnings.some(
          (w) =>
            w.includes("No idempotencyStore configured") &&
            w.includes("double refund"),
        ),
      ).toBe(true);
    });

    it("warns when the idempotency store lacks atomic reserve()", () => {
      const { warnings, logger } = captureWarnings();
      const storeWithoutReserve = {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
      };

      new MoyasarGateway(
        { ...CONFIG, idempotencyStore: storeWithoutReserve },
        new HooksManager(),
        logger,
      );

      expect(warnings.some((w) => w.includes("atomic reserve"))).toBe(true);
    });

    it("does not warn when the store implements reserve()", () => {
      const { warnings, logger } = captureWarnings();

      new MoyasarGateway(
        { ...CONFIG, idempotencyStore: new InMemoryIdempotencyStore() },
        new HooksManager(),
        logger,
      );

      expect(warnings.some((w) => w.includes("atomic reserve"))).toBe(false);
      expect(warnings.some((w) => w.includes("No idempotencyStore"))).toBe(
        false,
      );
    });

    it("warns once per mutation when idempotencyKey is set without a store", async () => {
      const { warnings, logger } = captureWarnings();
      const gateway = new MoyasarGateway(CONFIG, new HooksManager(), logger);
      mockFetchJson(paymentResponse({ status: "refunded", refunded: 10000 }));

      await gateway.refundPayment({
        gatewayPaymentId: PAYMENT_ID,
        idempotencyKey: "unguarded-key",
      });

      const mutationWarnings = warnings.filter((w) =>
        w.includes("idempotencyKey but no idempotencyStore"),
      );
      expect(mutationWarnings).toHaveLength(1);
      expect(fetchCalls).toHaveLength(1);
    });
  });
});
