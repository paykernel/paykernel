// file: packages/payments/src/gateways/paymob.gateway.ts

import { BaseGateway } from "../base.gateway";
import type { GatewayRuntimeDeps } from "../../runtime/payment-runtime";
import {
  combineAbortSignals,
  createTimeoutSignal,
  extractAbortSignal,
  mapHttpAbortError,
} from "../../runtime/abort";
import {
  hmacSha512Hex,
  timingSafeEqualHex,
} from "../../runtime/crypto-portable";
import type {
  AmountInput,
  PaymentStatus,
  PaymobCreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
} from "../../types/payment.types";
import {
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  type PaymentOperationOutcome,
  type RefundOperationOutcome,
} from "../../types/operation-result";
import type {
  WebhookEvent,
  PaymobCardTokenWebhookPayload,
  PaymobRedirectWebhookPayload,
  PaymobWebhookPayload,
} from "../../types/webhook.types";
import { attachPaymentEvent } from "../../types/payment-event";
import type { PaymentEvent } from "../../types/payment-event";
import type { ProviderReferences } from "../../types/provider-refs";
import type { ProviderEventMapContext } from "../../types/webhook-event-map";
import type { PaymobConfig, PaymobRegion } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import {
  PaymobCreatePaymentParamsSchema,
  CaptureParamsSchema,
  RefundParamsSchema,
  VoidParamsSchema,
  GetPaymentParamsSchema,
} from "../../types/validation";
import {
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  AuthenticationError,
  NetworkError,
  PaymentAbortedError,
  InvalidRequestError,
  InvalidWebhookError,
  RateLimitError,
  ResourceNotFoundError,
} from "../../errors";
import {
  withRetry,
  parseRetryAfterSeconds,
  extractRetryAfterSeconds,
} from "../../utils/retry";
import type { Logger } from "../../utils/logger";
import { getCurrencyExponent } from "../../utils/currency";
import { fingerprintParams as sharedFingerprintParams } from "../../utils/idempotency";
import {
  fromMinorUnits as sharedFromMinorUnits,
  MoneyAmountError,
  minorAmountToNumber,
  moneyToMajorNumber,
  normalizeAmountInput,
  toMinorUnits as sharedToMinorUnits,
} from "../../utils/money";
import { PAYMOB_CAPABILITIES } from "../builtin-capabilities";

/**
 * Retryable transient errors for safe (idempotent) Paymob requests: network
 * failures and 5xx/429 responses. Mutations are deliberately NOT retried here;
 * they go through the indeterminate-outcome idempotency guard instead.
 */
function isPaymobRetryableError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof GatewayApiError) {
    const status = (error.rawError as { status?: number } | undefined)?.status;
    return typeof status === "number" && (status >= 500 || status === 429);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Base URLs for each Paymob region */
const PAYMOB_BASE_URLS: Record<PaymobRegion, string> = {
  ksa: "https://ksa.paymob.com",
  eg: "https://accept.paymob.com",
  pk: "https://pakistan.paymob.com",
  om: "https://oman.paymob.com",
  ae: "https://uae.paymob.com",
};

const DEFAULT_TIMEOUT_MS = 30_000;
const IDEMPOTENCY_CACHE_LIMIT = 1_000;
const IDEMPOTENCY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const PAYMOB_DEFAULT_CURRENCY_BY_REGION: Record<PaymobRegion, string> = {
  ksa: "SAR",
  eg: "EGP",
  pk: "PKR",
  om: "OMR",
  ae: "AED",
};

/**
 * HMAC fields order per Paymob transaction callback docs.
 * Note: Paymob uses is_refunded/is_voided in callbacks. is_refund/is_void are
 * HMAC aliases when those current-state flags are absent (`readHmacField`).
 * HMAC also covers error_occured and has_parent_transaction (used in status).
 * @see https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac
 */
const HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

const CARD_TOKEN_HMAC_FIELDS = [
  "card_subtype",
  "created_at",
  "email",
  "id",
  "masked_pan",
  "merchant_id",
  "order_id",
  "token",
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Response Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Paymob Intention API response */
interface PaymobIntentionResponse {
  id?: string;
  client_secret?: string;
  payment_keys?: Array<{
    key: string;
    integration: number;
  }>;
  redirect_url?: string;
  checkout_url?: string;
  status?: string;
  message?: string;
  detail?: string;
}

type PaymobPaymentMethod = string | number;

interface PaymobBillingData {
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  country: string;
  city: string;
  street: string;
  building: string;
  apartment: string;
  floor: string;
  postal_code: string;
  state: string;
  shipping_method?: string;
}

/** Paymob legacy order response */
interface PaymobOrderResponse {
  id?: number;
  message?: string;
}

/** Paymob legacy payment key response */
interface PaymobPaymentKeyResponse {
  token?: string;
  message?: string;
}

/** Paymob refund response */
interface PaymobRefundResponse {
  id?: number;
  success?: boolean;
  message?: string;
  pending?: boolean;
  currency?: string;
  refunded_amount_cents?: number;
}

/** Paymob legacy auth response */
interface PaymobAuthResponse {
  token?: string;
  message?: string;
}

/** Paymob capture response */
interface PaymobCaptureResponse {
  id?: number;
  success?: boolean;
  pending?: boolean;
  message?: string;
  currency?: string;
  amount_cents?: number;
  captured_amount?: number;
}

/** Paymob void response */
interface PaymobVoidResponse {
  id?: number;
  success?: boolean;
  pending?: boolean;
  message?: string;
}

interface PaymobTransactionResponse {
  id?: number;
  success?: boolean;
  pending?: boolean;
  amount_cents?: number;
  currency?: string;
  message?: string;
  is_void?: boolean;
  is_refund?: boolean;
  is_voided?: boolean;
  is_refunded?: boolean;
  has_parent_transaction?: boolean;
  error_occured?: boolean;
  refunded_amount_cents?: number;
  captured_amount?: number;
  is_auth?: boolean;
  is_capture?: boolean;
  is_captured?: boolean;
}

interface PaymobResolvedActionAmount {
  amountCents: number;
  currency: string;
  transactionAmountCents: number;
  capturedAmountCents?: number | undefined;
  refundedAmountCents?: number | undefined;
}

type PaymobActionOperation = "capture" | "refund";

interface PaymobIdempotencyCacheEntry<R = unknown> {
  fingerprint: string;
  promise?: Promise<R>;
  createdAt: number;
  /**
   * - in_progress: mutation outstanding (never FIFO-evict)
   * - completed: terminal success result (never evict — Paymob has no native idempotency)
   * - unknown: indeterminate post-mutate outcome (never FIFO-evict)
   */
  status?: "in_progress" | "completed" | "unknown";
}

interface PaymobNormalizedTransactionWebhook {
  type: string;
  rawObj: Record<string, unknown>;
  obj: PaymobTransactionResponse & {
    id: number;
    pending: boolean;
    success: boolean;
    amount_cents: number;
    currency: string;
    created_at?: string;
  };
}

class PaymobIndeterminateNetworkError extends NetworkError {
  constructor(error: NetworkError | Error) {
    const original =
      error instanceof NetworkError ? (error.originalError ?? error) : error;
    super(error.message, original, { afterProviderSubmit: true });
    this.name = "PaymobIndeterminateNetworkError";
  }
}

class PaymobIndeterminateGatewayError extends NetworkError {
  constructor(operation: string, status: number, rawResponse: unknown) {
    super(
      `Paymob ${operation} API returned ${status} after a mutating request; gateway outcome is unknown`,
      rawResponse,
      { afterProviderSubmit: true },
    );
    this.name = "PaymobIndeterminateGatewayError";
  }
}

/**
 * HTTP 200 after a mutating POST with an empty/malformed/unreadable body.
 * Paymob may have accepted the Intention / capture / refund / void; do not
 * release the idempotency fence (same as network/5xx indeterminate paths).
 */
class PaymobIndeterminateResponseError extends NetworkError {
  constructor(operation: string, detail: string, rawResponse: unknown) {
    super(
      `Paymob ${operation} API returned HTTP 200 with an unreadable body; gateway outcome is unknown (${detail})`,
      rawResponse,
      { afterProviderSubmit: true },
    );
    this.name = "PaymobIndeterminateResponseError";
  }
}

function isPaymobIndeterminateError(error: unknown): boolean {
  return (
    error instanceof PaymobIndeterminateNetworkError ||
    error instanceof PaymobIndeterminateGatewayError ||
    error instanceof PaymobIndeterminateResponseError
  );
}

/**
 * HTTP statuses that are not a definite reject after a mutating POST.
 * 408 / 409 / 425 / 429 and 5xx may have applied the money op (NEW-PAYMOB-4XX).
 */
function isPaymobIndeterminateMutationHttpStatus(status: number): boolean {
  return (
    status >= 500 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429
  );
}

/**
 * True when a mutation error must keep the idempotency fence.
 * 408 / 409 / 425 / 429 and RateLimitError after POST are not definite
 * rejects — Paymob may have applied the money op (NEW-PAYMOB-2 / NEW-PAYMOB-4XX).
 */
function shouldRetainPaymobMutationFence(error: unknown): boolean {
  if (isPaymobIndeterminateError(error) || error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof GatewayApiError) {
    const status = (error.rawError as { status?: number } | undefined)?.status;
    return (
      typeof status === "number" &&
      isPaymobIndeterminateMutationHttpStatus(status)
    );
  }
  return false;
}

/**
 * Paymob (Accept) payment gateway implementation
 * Supports Paymob Unified Intention API and legacy iframe checkout.
 * @see https://developers.paymob.com/paymob-docs/integration-paths/apis
 */
export class PaymobGateway extends BaseGateway {
  readonly name = "paymob" as const;

  private readonly paymobConfig: PaymobConfig;
  private readonly baseUrl: string;

  /** Legacy auth token (for Egypt API backward compat) */
  private legacyAuthToken: string | null = null;
  private legacyAuthTokenExpiry: number = 0;
  /** In-flight token fetch, to dedupe concurrent auth requests. */
  private legacyAuthTokenPromise: Promise<string> | null = null;
  private readonly idempotencyCache = new Map<string, PaymobIdempotencyCacheEntry>();

  constructor(
    config: PaymobConfig,
    hooks: HooksManager,
    logger?: Logger,
    runtime?: GatewayRuntimeDeps,
  ) {
    super(config, hooks, logger, PAYMOB_CAPABILITIES, runtime);
    this.paymobConfig = config;
    this.baseUrl = this.resolveBaseUrl(config);
    this.warnIfIdempotencyStoreUnsafe();
    this.warnIfHmacSecretMissing();
  }

  /**
   * When secretKey is configured (live Intention / management traffic) but
   * hmacSecret is absent, webhooks fail closed — verifyWebhook returns false
   * and nothing is verified. Surface this at construction so merchants notice
   * before going to production.
   */
  private warnIfHmacSecretMissing(): void {
    if (this.paymobConfig.secretKey && !this.paymobConfig.hmacSecret) {
      this.logger.warn(
        "[Paymob] secretKey is configured but hmacSecret is missing. " +
          "Webhook verification will fail closed (verifyWebhook returns false) " +
          "until hmacSecret is set, or allowUnverifiedWebhooks is enabled in an " +
          "explicit local/test environment.",
      );
    }
  }

  /**
   * Capture/refund/void **require** a store with atomic `reserve()` and an
   * `idempotencyKey` (see {@link runIdempotentMutation}). Warn so a missing
   * store is visible before the first mutation throws `InvalidRequestError`.
   * Intention create still uses the process-local cache when unkeyed; warn
   * extra in serverless/edge because that cache is per-isolate.
   */
  private warnIfIdempotencyStoreUnsafe(): void {
    const store = this.paymobConfig.idempotencyStore;
    if (!store) {
      this.logger.warn(
        "[Paymob] idempotencyStore is required for capture, refund, and void. " +
          "Those mutations throw InvalidRequestError until paymob.idempotencyStore " +
          "(with atomic reserve()) and idempotencyKey are provided — Paymob has no " +
          "native mutation idempotency (double-refund / double-capture class).",
      );
      if (this.isLikelyServerlessEnvironment()) {
        this.logger.warn(
          "[Paymob] No idempotencyStore configured in a serverless/edge environment. " +
            "The in-memory idempotency cache is per-isolate and wiped frequently, so it " +
            "provides almost no protection against duplicate createPayment keys. Configure " +
            "paymob.idempotencyStore with Redis, a database, or another shared store.",
        );
      }
      return;
    }

    if (!store.reserve) {
      this.logger.warn(
        "[Paymob] idempotencyStore does not implement atomic reserve(). " +
          "Capture, refund, and void will throw until a store with atomic reserve() " +
          "is provided (e.g. Redis SET NX or a SQL unique constraint).",
      );
    }
  }

  private isLikelyServerlessEnvironment(): boolean {
    // Cloudflare Workers expose WebSocketPair and lack a Node process.
    const hasNodeProcess =
      typeof globalThis.process !== "undefined" &&
      !!globalThis.process?.versions?.node;
    if (!hasNodeProcess) {
      return true;
    }

    const env = globalThis.process?.env ?? {};
    return Boolean(
      env.AWS_LAMBDA_FUNCTION_NAME ||
        env.VERCEL ||
        env.VERCEL_ENV ||
        env.FUNCTIONS_WORKER_RUNTIME ||
        env.K_SERVICE || // Google Cloud Run / Functions
        env.LAMBDA_TASK_ROOT ||
        env.NETLIFY,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payment Creation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a Paymob payment using Unified Intention API
   * Falls back to legacy flow for Egypt if apiKey is provided
   */
  async createPayment(
    params: PaymobCreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      return this.executeIdempotent("createPayment", p.idempotencyKey, p, async () => {
        // Use Intention API when secretKey/publicKey are available.
        if (this.paymobConfig.secretKey && this.paymobConfig.publicKey) {
          return this.createPaymentViaIntention(p);
        }

        if (this.paymobConfig.secretKey || this.paymobConfig.publicKey) {
          throw new GatewayApiError(
            "Paymob Intention API requires both secretKey and publicKey",
            "paymob",
            { config: "incomplete_intention_credentials" },
          );
        }

        // Fallback to legacy API for backward compatibility
        if (this.paymobConfig.apiKey) {
          return this.createPaymentViaLegacy(p);
        }

        throw new GatewayApiError(
          "Paymob requires either secretKey/publicKey (Intention API) or apiKey (legacy)",
          "paymob",
          { config: "missing_credentials" },
        );
      });
    }, PaymobCreatePaymentParamsSchema);
  }

  /**
   * Create payment via Paymob Unified Intention API
   * @see https://developers.paymob.com/paymob-docs/integration-paths/apis
   */
  private async createPaymentViaIntention(
    params: PaymobCreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    const endpoint = "/v1/intention/";
    const currency = this.resolveCurrency(params.currency);
    const billingData = this.buildBillingData(params);
    const paymentMethods = this.resolvePaymentMethods(params);
    this.warnIfPerPaymentCallbacksMayBeIgnored(params, paymentMethods);

    const requestBody: Record<string, unknown> = {
      amount: this.toMinorUnits(params.amount, currency),
      currency,
      payment_methods: paymentMethods,
      billing_data: billingData,
      // Use paymentId as special_reference so it appears as merchant_order_id in webhooks
      special_reference: this.resolveSpecialReference(params),
      notification_url: params.callbackUrl,
      // Normalize redirect URL to prevent Paymob adding trailing slash before query params
      redirection_url: this.normalizeRedirectUrl(params.returnUrl),
      // Include paymentId and tenantId in extras - these appear in payment_key_claims.extra
      extras: {
        ...params.metadata,
        paymentId: params.metadata?.paymentId,
        tenantId: params.metadata?.tenantId,
        orderId: (params.metadata?.orderId as string) ?? params.orderId,
        idempotencyKey: params.idempotencyKey,
      },
    };

    // Auth-only: dual model — swap to auth integration (resolvePaymentMethods) AND set is_auth
    // + payment_type AUTH. Paymob auth/capture is primarily integration-driven; these flags
    // document auth-only intent on the Intention request.
    if (params.capture === false) {
      requestBody.is_auth = true;
      requestBody.payment_type = "AUTH";
    }

    const response = await this.fetchPaymobMutation(
      `${this.baseUrl}${endpoint}`,
      this.withCallerSignal(
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Intention API uses simple Token authentication, not HMAC
            Authorization: `Token ${this.paymobConfig.secretKey}`,
          },
          body: JSON.stringify(requestBody),
        },
        params,
      ),
      "Intention",
    );

    const data = await this.parseJson<PaymobIntentionResponse>(response, {
      mutationOperation: "Intention",
    });

    if (!response.ok) {
      this.throwPaymobApiError(
        response,
        data,
        data.message ?? data.detail ?? "Failed to create Paymob intention",
        "Intention",
        { unknownOnServerError: true },
      );
    }

    // PAYMOB-2: HTTP 200 means Paymob may have created a payable intention.
    // Missing id / checkout URL is indeterminate — keep the create fence.
    const gatewayId = this.requireMutationString(
      data.id,
      "Paymob Intention API response is missing id",
      data,
      "Intention",
    );

    // Build redirect URL from response
    const redirectUrl =
      data.redirect_url ??
      data.checkout_url ??
      (data.client_secret
        ? this.buildUnifiedCheckoutUrl(data.client_secret)
        : undefined);

    const checkoutUrl = this.requireMutationString(
      redirectUrl,
      "Paymob Intention API response is missing checkout URL/client_secret",
      data,
      "Intention",
    );

    const nextAction = {
      type: "redirect" as const,
      checkoutUrl,
      intentionId: gatewayId,
      clientSecret: data.client_secret,
      paymentKeys: data.payment_keys,
    };
    // Intention create always needs customer checkout — never paid/succeeded.
    return applyOutcomeToGatewayResult(
      {
        gatewayId,
        gatewayObjectId: gatewayId,
        status: "pending",
        redirectUrl: checkoutUrl,
        nextAction,
        rawResponse: data,
        providerNativeStatus: "intention_pending",
        gateway: "paymob",
      },
      "requires_action",
    );
  }

  /**
   * Create payment via legacy Egypt API (backward compatibility)
   * @deprecated Use Intention API for new integrations
   */
  private async createPaymentViaLegacy(
    params: PaymobCreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    const currency = this.resolveCurrency(params.currency);
    // Match Intention resolvePaymentMethods: auth requires authIntegrationId
    // (or per-request method override). Never fall back to sale integrationId
    // for capture:false — that can settle as a sale integration.
    let integrationId = params.paymobIntegrationId;
    if (integrationId === undefined || integrationId === null) {
      if (params.capture === false) {
        if (this.paymobConfig.authIntegrationId !== undefined && this.paymobConfig.authIntegrationId !== null) {
          integrationId = this.paymobConfig.authIntegrationId;
        }
      } else {
        integrationId = this.paymobConfig.integrationId;
      }
    }
    const iframeId = params.paymobIframeId ?? this.paymobConfig.iframeId;

    if (integrationId === undefined || integrationId === null) {
      if (params.capture === false) {
        throw new GatewayApiError(
          "Paymob capture:false requires paymobIntegrationId, paymobPaymentMethods, or paymob.authIntegrationId because Paymob auth/capture is integration-driven (sale integrationId is not used as a silent fallback)",
          "paymob",
          { config: "missing_auth_integration_id" },
        );
      }
      throw new GatewayApiError(
        "Paymob legacy checkout requires integrationId",
        "paymob",
        { config: "missing_integration_id" },
      );
    }

    if (!iframeId) {
      throw new GatewayApiError(
        "Paymob legacy checkout requires iframeId",
        "paymob",
        { config: "missing_iframe_id" },
      );
    }

    // Step 1: Get auth token
    const token = await this.authenticateLegacy();
    const billingData = this.buildBillingData(params, { includeShippingMethod: true });

    // Step 2: Create order
    const orderResponse = await this.fetchPaymobMutation(
      `${this.baseUrl}/api/ecommerce/orders`,
      this.withCallerSignal(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth_token: token,
            delivery_needed: false,
            amount_cents: this.toMinorUnits(params.amount, currency),
            currency,
            merchant_order_id: this.resolveSpecialReference(params),
            items: [],
          }),
        },
        params,
      ),
      "Orders",
    );

    const orderData = await this.parseJson<PaymobOrderResponse>(orderResponse, {
      mutationOperation: "Orders",
    });

    if (!orderResponse.ok) {
      this.throwPaymobApiError(
        orderResponse,
        orderData,
        orderData.message ?? "Failed to create Paymob order",
        "Orders",
        { unknownOnServerError: true },
      );
    }
    // PAYMOB-FENCE-3: HTTP 200 after the mutating Orders POST may have created
    // the order. Missing id is indeterminate — keep the create fence.
    const orderId = this.requireMutationNumber(
      orderData.id,
      "Paymob Orders API response is missing id",
      orderData,
      "Orders",
    );

    // Step 3: Generate payment key
    const paymentKeyResponse = await this.fetchPaymobMutation(
      `${this.baseUrl}/api/acceptance/payment_keys`,
      this.withCallerSignal(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth_token: token,
            amount_cents: this.toMinorUnits(params.amount, currency),
            expiration: 3600,
            order_id: orderId,
            billing_data: billingData,
            currency,
            integration_id: integrationId,
          }),
        },
        params,
      ),
      "Payment Keys",
    );

    const paymentKeyData = await this.parseJson<PaymobPaymentKeyResponse>(
      paymentKeyResponse,
      { mutationOperation: "Payment Keys" },
    );

    if (!paymentKeyResponse.ok) {
      // NEW-PAYMOB-4XX: Orders HTTP 200 + id already minted a Paymob order.
      // Any Payment Keys 4xx (including 408 / 409 / 425) must keep the create
      // fence — the same key cannot POST a second /api/ecommerce/orders.
      this.throwPaymobApiError(
        paymentKeyResponse,
        paymentKeyData,
        paymentKeyData.message ?? "Failed to generate Paymob payment key",
        "Payment Keys",
        { unknownOnServerError: true, unknownAfterObservedSideEffect: true },
      );
    }
    // PAYMOB-FENCE-3: HTTP 200 after the mutating Payment Keys POST may have
    // issued a payable token. Missing token is indeterminate — keep the fence.
    const paymentToken = this.requireMutationString(
      paymentKeyData.token,
      "Paymob Payment Keys API response is missing token",
      paymentKeyData,
      "Payment Keys",
    );

    // Generate iframe URL
    const iframeUrl = `${this.baseUrl}/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(paymentToken)}`;
    const orderIdStr = String(orderId);
    const nextAction = {
      type: "redirect" as const,
      checkoutUrl: iframeUrl,
      orderId: orderIdStr,
      paymentToken,
    };
    // S19-PAYMOB-LEGACY-ID: the ecommerce order id is digits-only, same shape as
    // a transaction id. Never put it on gatewayId (assertPaymobTransactionId
    // would accept it as transaction_id). Keep it on orderId / nextAction only.
    const gatewayId = `legacy:${orderIdStr}`;
    // Legacy checkout also requires customer action — never paid/succeeded.
    return applyOutcomeToGatewayResult(
      {
        gatewayId,
        orderId: orderIdStr,
        status: "pending",
        redirectUrl: iframeUrl,
        nextAction,
        rawResponse: {
          order: orderData,
          paymentKey: paymentKeyData,
        },
        providerNativeStatus: "legacy_checkout_pending",
        gateway: "paymob",
      },
      "requires_action",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Capture
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Capture an authorized payment
   * @see https://developers.paymob.com/paymob-docs/payments-and-features/managing-payments/6953c994885397a8b1cdb3e3
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async (p) => {
      return this.runIdempotentMutation("capturePayment", p.idempotencyKey, p, async () => {
        this.assertPaymobTransactionId(p.gatewayPaymentId, "capturePayment");
        this.assertPostPayCredentials();
        const resolvedAmount = await this.resolveActionAmountCents(
          p.gatewayPaymentId,
          p.amount,
          "capture",
          p.currency,
          extractAbortSignal(p),
        );

        const mutation = await this.buildPostPayMutation({
          transaction_id: Number(p.gatewayPaymentId),
          amount_cents: resolvedAmount.amountCents,
        });

        const response = await this.fetchPaymobMutation(
          `${this.baseUrl}/api/acceptance/capture`,
          this.withCallerSignal(
            {
              method: "POST",
              headers: mutation.headers,
              body: JSON.stringify(mutation.body),
            },
            p,
          ),
          "Capture",
        );

        const data = await this.parseJson<PaymobCaptureResponse>(response, {
          mutationOperation: "Capture",
        });

        if (!response.ok) {
          this.throwPaymobApiError(
            response,
            data,
            data.message ?? "Failed to capture Paymob payment",
            "Capture",
            { unknownOnServerError: true },
          );
        }

        // PAYMOB-1: HTTP 200 means the mutation may already be applied. Coerce
        // string booleans; missing/invalid success is indeterminate (fence).
        const success = this.requireMutationBoolean(
          data.success,
          "Paymob Capture API response is missing success",
          data,
          "Capture",
        );
        // Prefer provider cumulative `captured_amount` when present (including 0).
        // When omitted, sum THIS REQUEST's amount onto inquiry prior (multi-partial).
        // Do not treat response `amount_cents` as this-op — it may be the order
        // total and would overstate cumulative (PAYMOB-4).
        // PAYMOB-4: coerce string money fields from mutation bodies.
        const currency = this.resolveCurrency(data.currency ?? resolvedAmount.currency);
        const providerCapturedAmountCents = this.parseNumber(data.captured_amount);
        const cumulativeCapturedAmountCents =
          providerCapturedAmountCents !== undefined
            ? providerCapturedAmountCents
            : (resolvedAmount.capturedAmountCents ?? 0) + resolvedAmount.amountCents;
        // PAYMOB-4: honor pending on capture mutation (symmetric with refund).
        const status =
          this.parseBoolean(data.pending) === true
            ? "pending"
            : this.mapCaptureStatus(data, success, {
                transactionAmountCents: resolvedAmount.transactionAmountCents,
                cumulativeCapturedAmountCents,
              });
        // PAYMOB-2: prefer parent payment/txn id for gatewayId so later
        // parent-targeted ops (refund/void/get) keep working. Child capture
        // txn id (when distinct from the parent) is dual-written on captureId.
        const gatewayId = p.gatewayPaymentId;
        const childCaptureId =
          data.id !== undefined && data.id !== null
            ? String(data.id)
            : undefined;
        const captureId =
          childCaptureId !== undefined && childCaptureId !== gatewayId
            ? childCaptureId
            : undefined;
        const outcome = this.mapPaymobOutcome(status, success, {
          pending: this.parseBoolean(data.pending) === true,
        });

        // PAYMOB-4: never ledger cumulative captured while status is pending —
        // align with refund path (pending omits totalRefunded until settled).
        const publishCaptured =
          status !== "pending" && status !== "failed";
        return applyOutcomeToGatewayResult(
          {
            gatewayId,
            ...(captureId !== undefined ? { captureId } : {}),
            status,
            rawResponse: data,
            // Ledger/inventory: publish cumulative only when positive; zero is
            // honest for provider-reported 0 but never implies paid (PAYMOB-1).
            // Always dual-write currency with major-unit money fields.
            ...(publishCaptured && cumulativeCapturedAmountCents > 0
              ? {
                  capturedAmount: this.fromMinorUnits(
                    cumulativeCapturedAmountCents,
                    currency,
                  ),
                  currency,
                }
              : publishCaptured && cumulativeCapturedAmountCents === 0
                ? { capturedAmount: 0, currency }
                : {}),
            providerNativeStatus: success ? "success" : "failed",
            gateway: "paymob",
          },
          outcome,
          outcome === "declined"
            ? {
                decline: {
                  code: "CAPTURE_DECLINED",
                  message: "Paymob capture was declined",
                },
              }
            : undefined,
        );
      });
    }, CaptureParamsSchema);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Void
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Void a same-day transaction
   * @see https://developers.paymob.com/paymob-docs/developers/manage-payment-apis/void
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      return this.runIdempotentMutation("voidPayment", p.idempotencyKey, p, async () => {
        this.assertPaymobTransactionId(p.gatewayPaymentId, "voidPayment");
        this.assertPostPayCredentials();

        const mutation = await this.buildPostPayMutation({
          transaction_id: Number(p.gatewayPaymentId),
        });

        const response = await this.fetchPaymobMutation(
          `${this.baseUrl}/api/acceptance/void_refund/void`,
          this.withCallerSignal(
            {
              method: "POST",
              headers: mutation.headers,
              body: JSON.stringify(mutation.body),
            },
            p,
          ),
          "Void",
        );

        const data = await this.parseJson<PaymobVoidResponse>(response, {
          mutationOperation: "Void",
        });

        if (!response.ok) {
          this.throwPaymobApiError(
            response,
            data,
            data.message ?? "Failed to void Paymob transaction",
            "Void",
            { unknownOnServerError: true },
          );
        }

        // PAYMOB-1: HTTP 200 means the mutation may already be applied. Coerce
        // string booleans; missing/invalid success is indeterminate (fence).
        const success = this.requireMutationBoolean(
          data.success,
          "Paymob Void API response is missing success",
          data,
          "Void",
        );
        // NEW-PAYMOB-VOID-P: honor pending like capture/refund — not cancelled.
        const pending = this.parseBoolean(data.pending) === true;
        const status: PaymentStatus = pending
          ? "pending"
          : success
            ? "cancelled"
            : "failed";
        const outcome: PaymentOperationOutcome = pending
          ? "requires_action"
          : success
            ? "succeeded"
            : "declined";

        // PAYMOB-3: keep parent payment/txn id as gatewayId (same as capture).
        // Child void response id is not a stable parent handle for later ops.
        return applyOutcomeToGatewayResult(
          {
            gatewayId: p.gatewayPaymentId,
            status,
            rawResponse: data,
            providerNativeStatus: pending ? "pending" : success ? "voided" : "failed",
            gateway: "paymob",
          },
          outcome,
          outcome === "declined"
            ? {
                decline: {
                  code: "VOID_DECLINED",
                  message: "Paymob void was declined",
                },
              }
            : undefined,
        );
      });
    }, VoidParamsSchema);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Refund
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Refund a Paymob payment
   * @see https://developers.paymob.com/paymob-docs/payments-and-features/managing-payments/6953c994885397a8b1cdb3e3
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      return this.runIdempotentMutation("refundPayment", p.idempotencyKey, p, async () => {
        this.assertPaymobTransactionId(p.gatewayPaymentId, "refundPayment");
        this.assertPostPayCredentials();
        const resolvedAmount = await this.resolveActionAmountCents(
          p.gatewayPaymentId,
          p.amount,
          "refund",
          p.currency,
          extractAbortSignal(p),
        );

        const mutation = await this.buildPostPayMutation({
          transaction_id: Number(p.gatewayPaymentId),
          amount_cents: resolvedAmount.amountCents,
        });

        const response = await this.fetchPaymobMutation(
          `${this.baseUrl}/api/acceptance/void_refund/refund`,
          this.withCallerSignal(
            {
              method: "POST",
              headers: mutation.headers,
              body: JSON.stringify(mutation.body),
            },
            p,
          ),
          "Refund",
        );

        const data = await this.parseJson<PaymobRefundResponse>(response, {
          mutationOperation: "Refund",
        });

        if (!response.ok) {
          this.throwPaymobApiError(
            response,
            data,
            data.message ?? "Failed to refund Paymob payment",
            "Refund",
            { unknownOnServerError: true },
          );
        }

        // PAYMOB-1: HTTP 200 means the mutation may already be applied. Coerce
        // string booleans; missing/invalid success is indeterminate (fence).
        const success = this.requireMutationBoolean(
          data.success,
          "Paymob Refund API response is missing success",
          data,
          "Refund",
        );
        const currency = this.resolveCurrency(data.currency ?? resolvedAmount.currency);
        // PAYMOB-4: coerce string money fields from mutation bodies.
        const providerRefundedAmountCents = this.parseNumber(data.refunded_amount_cents);
        // Missing body total: inquiry prior + this request (PAYMOB-3).
        const estimatedRefundedAmountCents =
          (resolvedAmount.refundedAmountCents ?? 0) + resolvedAmount.amountCents;
        // NEW-PAYMOB-REFUND-0: success + missing/<=0 refunded_amount_cents must
        // not be completed + totalRefunded:0. Only complete when the body
        // reports >0 or inquiry + this request proves a positive cumulative.
        const provenRefundedAmountCents =
          providerRefundedAmountCents !== undefined && providerRefundedAmountCents > 0
            ? providerRefundedAmountCents
            : providerRefundedAmountCents === undefined && estimatedRefundedAmountCents > 0
              ? estimatedRefundedAmountCents
              : undefined;
        const status =
          this.parseBoolean(data.pending) === true
            ? "pending"
            : !success
              ? "failed"
              : provenRefundedAmountCents !== undefined
                ? "completed"
                : "pending";
        const outcome: RefundOperationOutcome =
          status === "completed"
            ? "succeeded"
            : status === "failed"
              ? "failed"
              : "pending";

        // PAYMOB-4: never alias the parent payment/txn id as gatewayRefundId.
        // Prefer the refund transaction id from the response body.
        // PAYMOB-1: missing id after HTTP 200 is indeterminate — do not clear fence.
        if (data.id === undefined || data.id === null) {
          throw new PaymobIndeterminateResponseError(
            "Refund",
            "Paymob Refund API response is missing refund transaction id",
            { response: data },
          );
        }

        // PAYMOB-1: never invent/ledger totalRefunded while status is pending.
        // Failed outcomes also omit — never invent a refund total on failure.
        const totalRefundedCents =
          status === "pending" || status === "failed"
            ? undefined
            : provenRefundedAmountCents;

        return applyOutcomeToGatewayRefundResult(
          {
            gatewayRefundId: String(data.id),
            status,
            ...(totalRefundedCents !== undefined
              ? {
                  totalRefunded: this.fromMinorUnits(
                    totalRefundedCents,
                    currency,
                  ),
                }
              : {}),
            rawResponse: data,
          },
          outcome,
        );
      });
    }, RefundParamsSchema);
  }

  /**
   * Map Paymob errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "paymob") {
      const raw = this.recordOrUndefined(error.rawError);
      const response = this.recordOrUndefined(raw?.response);
      const rawMessage =
        this.stringOrUndefined(raw?.message) ??
        this.stringOrUndefined(response?.message) ??
        this.stringOrUndefined(response?.detail) ??
        error.message;
      const message = rawMessage;
      const status = typeof raw?.status === "number" ? raw.status : undefined;

      if (message.toLowerCase().includes('declined')) {
        return new CardDeclinedError(message, error.rawError);
      }
      if (message.toLowerCase().includes("insufficient funds")) {
        return new InsufficientFundsError(message, error.rawError);
      }
      if (
        status === 401 ||
        message.toLowerCase().includes('authentication') ||
        message.toLowerCase().includes('auth token') ||
        message.toLowerCase().includes('incorrect credentials') ||
        message.toLowerCase().includes('unauthorized')
      ) {
        return new AuthenticationError(message, error.rawError);
      }
      if (status === 404) {
        return new ResourceNotFoundError(message, error.rawError);
      }
      if (status === 429) {
        return new RateLimitError("paymob", extractRetryAfterSeconds(error));
      }
    }
    return super.mapError(error);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Paymob webhook using HMAC
   * @see https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac
   */
  verifyWebhook(payload: unknown, signature?: string): boolean {
    const redirectPayload = this.asRedirectWebhookPayload(payload);
    const structuredPayload = payload as PaymobWebhookPayload | PaymobCardTokenWebhookPayload;

    if (!this.paymobConfig.hmacSecret) {
      if (this.paymobConfig.allowUnverifiedWebhooks) {
        if (!this.allowsLocalUnverifiedWebhooks()) {
          this.logger.warn("[Paymob] Refusing unverified webhooks outside explicit local/test environments");
          return false;
        }
        this.logger.warn("[Paymob] Webhook verification explicitly disabled");
        return this.isTransactionWebhook(payload) ||
          this.isCardTokenWebhook(payload) ||
          Boolean(redirectPayload);
      }
      this.logger.warn("[Paymob] No HMAC secret configured");
      return false;
    }

    if (!structuredPayload?.obj && !redirectPayload) {
      return false;
    }

    // Get signature from payload or parameter
    const hmac = signature ?? structuredPayload.hmac ?? redirectPayload?.hmac;
    if (typeof hmac !== "string" || !hmac) {
      this.logger.warn("[Paymob] No HMAC signature provided");
      return false;
    }

    const dataString = this.isCardTokenWebhook(structuredPayload)
      ? this.buildCardTokenHmacString(structuredPayload.obj)
      : redirectPayload
        ? this.buildRedirectHmacString(redirectPayload)
        : this.buildHmacString((structuredPayload as PaymobWebhookPayload).obj);

    // Calculate expected HMAC (pure portable HMAC-SHA512 — no node:crypto)
    const calculatedHmac = hmacSha512Hex(
      this.paymobConfig.hmacSecret,
      dataString,
    );

    return this.safeCompareHex(hmac, calculatedHmac);
  }

  /**
   * Build the data string for HMAC calculation per Paymob docs.
   * Uses HMAC_FIELDS order with correct field names (is_refunded, is_voided).
   * @see https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac
   */
  private buildHmacString(obj: Record<string, unknown>): string {
    return HMAC_FIELDS.map((field) =>
      this.readHmacField(obj as unknown as Record<string, unknown>, field)
    ).join("");
  }

  /**
   * Build the HMAC string for Paymob saved-card token callbacks.
   * Token callbacks do not include transaction fields like amount_cents/order.id.
   */
  private buildCardTokenHmacString(obj: PaymobCardTokenWebhookPayload["obj"]): string {
    return CARD_TOKEN_HMAC_FIELDS.map((field) => String(obj[field] ?? "")).join("");
  }

  private buildRedirectHmacString(payload: PaymobRedirectWebhookPayload): string {
    return HMAC_FIELDS.map((field) => this.readHmacField(payload, field)).join("");
  }

  /**
   * Parse Paymob webhook payload into normalized WebhookEvent.
   *
   * Dual-writes Phase 7 PaymentEvent using transaction flags + status
   * (`TRANSACTION` success → payment.succeeded, partial capture →
   * payment.processing, `TRANSACTION_RESPONSE` success → payment.processing,
   * TOKEN → setup_completed, void/refund flags, …).
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    if (this.isCardTokenWebhook(payload)) {
      return this.parseCardTokenWebhookEvent(payload);
    }

    const redirectPayload = this.asRedirectWebhookPayload(payload);
    if (redirectPayload) {
      return this.parseRedirectWebhookEvent(redirectPayload, payload);
    }

    const normalized = this.normalizeTransactionWebhook(payload);
    if (!normalized) {
      throw new InvalidWebhookError("Invalid Paymob transaction webhook payload");
    }
    const raw = payload as PaymobWebhookPayload;
    const obj = normalized.obj;
    // HMAC does not cover is_captured / captured_amount / refunded_amount_cents.
    // is_refund / is_void are HMAC aliases only when current-state is absent.
    // When is_refunded / is_voided is present (true or false), the action alias
    // is unsigned and is dropped (I1-PAYMOB-UNSIGNED-ACTION).
    const statusSource = this.sanitizeWebhookTransactionForStatus(obj);

    const status = this.mapTransactionStatus(statusSource);
    const amount = this.resolveWebhookEventAmount(
      status,
      obj.amount_cents,
      obj.currency,
      statusSource.refunded_amount_cents,
    );

    // PAYMOB-1: HMAC does not cover merchant_order_id / payment_key_claims.extra /
    // creation_extras.paymentId. Never copy those into event.paymentId after
    // verify — a valid signed body can be rewritten to a victim order id.
    // Correlate via signed gatewayPaymentId (obj.id) and signed order.id.
    //
    // PAYMOB-2: child refund/capture transactions emit a distinct obj.id. Keep
    // gatewayPaymentId as the emitting transaction id (true refund/capture resource).
    // Do **not** dual-write order.id onto gatewayObjectId — Phase-7 maps that field
    // to relatedIds.refundId / captureId. Parent order correlation is applied to
    // references.parentId (+ relatedIds.orderId) only after attachPaymentEvent.
    const txnId = String(obj.id);
    const signedOrderId = this.readSignedPaymobOrderId(normalized.rawObj);
    const legacy: WebhookEvent = {
      id: this.paymobWebhookEventId(txnId, "TRANSACTION"),
      type: normalized.type,
      gateway: "paymob",
      paymentId: undefined,
      gatewayPaymentId: txnId,
      status,
      ...(amount !== undefined ? { amount } : {}),
      // Normalize to uppercase ISO 4217 for cross-gateway consistency.
      currency: obj.currency.toUpperCase(),
      timestamp: this.parseTimestamp(obj.created_at),
      rawPayload: raw,
    };

    const dualWritten = attachPaymentEvent(legacy, {
      computePayloadHash: true,
      mapContext: this.paymobMapContextFromTransaction(statusSource),
    });
    return this.withPaymobSignedOrderParent(dualWritten, signedOrderId);
  }

  /**
   * HMAC-covered order.id (and aliases used by redirect callbacks).
   * Never reads merchant_order_id / extras (unsigned).
   */
  private readSignedPaymobOrderId(
    rawObj: Record<string, unknown>,
  ): string | undefined {
    const order = this.recordOrUndefined(rawObj.order);
    const value =
      rawObj["order.id"] ?? order?.id ?? rawObj.order_id ?? rawObj.order;
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === "object") {
      return undefined;
    }
    const s = String(value).trim();
    return s.length > 0 ? s : undefined;
  }

  private parseCardTokenWebhookEvent(payload: PaymobCardTokenWebhookPayload): WebhookEvent {
    // PAYMOB-2: bind gatewayPaymentId from HMAC-covered fields only.
    // CARD_TOKEN_HMAC_FIELDS covers order_id + id — not next_payment_intention.
    // Prefer signed order_id; fall back to token record id (also signed).
    const signedOrderId =
      payload.obj.order_id !== undefined &&
      payload.obj.order_id !== null &&
      String(payload.obj.order_id).trim().length > 0
        ? String(payload.obj.order_id).trim()
        : undefined;
    const gatewayPaymentId = signedOrderId ?? String(payload.obj.id);
    const legacy: WebhookEvent = {
      id: String(payload.obj.id),
      type: payload.type,
      gateway: "paymob",
      paymentId: undefined,
      gatewayPaymentId,
      gatewayObjectId: String(payload.obj.id),
      gatewayToken: payload.obj.token,
      status: "setup_completed",
      timestamp: this.parseTimestamp(payload.obj.created_at),
      rawPayload: payload,
    };
    return attachPaymentEvent(legacy, { computePayloadHash: true });
  }

  private parseRedirectWebhookEvent(
    payload: PaymobRedirectWebhookPayload,
    rawPayload: unknown,
  ): WebhookEvent {
    const amountCents = this.parseNumber(payload.amount_cents);
    if (amountCents === undefined) {
      throw new InvalidWebhookError("Invalid Paymob redirection callback amount_cents");
    }
    // Redirect HMAC covers the same signed flag set as processed callbacks.
    // Do not copy unsigned is_captured / captured_amount / refunded_amount_cents
    // (PAYMOB-5 fail-closed) — use inquiry for partial capture/refund money truth.
    const statusData: PaymobTransactionResponse = { amount_cents: amountCents };
    this.assignOptionalBoolean(statusData, "success", payload.success);
    this.assignOptionalBoolean(statusData, "pending", payload.pending);
    this.assignOptionalBoolean(statusData, "is_void", payload.is_void);
    this.assignOptionalBoolean(statusData, "is_voided", payload.is_voided);
    this.assignOptionalBoolean(statusData, "is_refund", payload.is_refund);
    this.assignOptionalBoolean(statusData, "is_refunded", payload.is_refunded);
    this.assignOptionalBoolean(statusData, "is_auth", payload.is_auth);
    this.assignOptionalBoolean(statusData, "is_capture", payload.is_capture);
    this.assignOptionalBoolean(statusData, "has_parent_transaction", payload.has_parent_transaction);
    this.assignOptionalBoolean(statusData, "error_occured", payload.error_occured);
    const statusSource = this.sanitizeWebhookTransactionForStatus(statusData);
    const mappedStatus = this.mapTransactionStatus(statusSource);
    const amount = this.resolveWebhookEventAmount(
      mappedStatus,
      amountCents,
      payload.currency,
      statusSource.refunded_amount_cents,
    );
    // S19-PAYMOB-REDIR-STATUS / S20-PAYMOB-REDIR-TERM: browser-replayable GET
    // must not publish terminal envelope statuses (paid / authorized / cancelled /
    // failed / refund_*). Dual-write follows envelope `processing` so restock /
    // fail / fulfill handlers cannot act from redirect alone.
    const status = this.redirectEnvelopeStatus(mappedStatus);

    // PAYMOB-3: redirect `type` is not HMAC-bound. Always force TRANSACTION_RESPONSE
    // so dual-write demotes settlement arms to payment.processing — never fulfill
    // on redirect-only events. Trusting payload.type would let type=TRANSACTION
    // skip demotion and look fulfillment-ready.
    // PAYMOB-1: merchant_order_id is not HMAC-bound — omit paymentId on redirect too.
    // WEBHOOKS-1: redirect and processed TRANSACTION share Paymob's txn id.
    // Qualify redirect event.id so inbox keys cannot ACK-suppress later paid.
    const txnId = String(payload.id);
    const legacy: WebhookEvent = {
      id: this.paymobWebhookEventId(txnId, "TRANSACTION_RESPONSE"),
      type: "TRANSACTION_RESPONSE",
      gateway: "paymob",
      paymentId: undefined,
      gatewayPaymentId: txnId,
      status,
      ...(amount !== undefined ? { amount } : {}),
      // Normalize to uppercase ISO 4217 for cross-gateway consistency.
      currency: payload.currency.toUpperCase(),
      timestamp: this.parseTimestamp(payload.created_at),
      rawPayload,
    };

    return attachPaymentEvent(legacy, {
      computePayloadHash: true,
      mapContext: this.paymobMapContextFromTransaction(statusSource),
    });
  }

  /**
   * Strip webhook fields that are **not** covered by Paymob HMAC_FIELDS before
   * status mapping. Documented HMAC keys include is_auth, is_capture, is_refunded,
   * is_voided, success, pending, amount_cents — not is_captured, captured_amount,
   * refunded_amount_cents, is_refund, or is_void.
   *
   * is_refund / is_void are HMAC-covered as aliases when is_refunded /
   * is_voided are absent (`readHmacField`). If the signed current-state flag
   * is present (true **or** false), drop the action alias — HMAC bound
   * `is_refunded` / `is_voided`, not `is_refund` / `is_void`. Child refunds
   * and voids on this path require signed `has_parent_transaction` plus a
   * **signed** flag (current-state or HMAC-aliased action), never a forged
   * alias next to `is_refunded: false` / `is_voided: false`.
   *
   * refunded_amount_cents is never HMAC-covered — always strip it on the webhook
   * path. Signed `is_refunded` / HMAC-aliased `is_refund` without a trusted
   * refunded total map to incomplete `refund_completed`; partial vs full
   * completeness requires transaction inquiry (PAYMOB-2). Signed `is_capture`
   * without `captured_amount` maps to `processing`, not `paid` (PAYMOB-1).
   *
   * @see https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac
   */
  private sanitizeWebhookTransactionForStatus(
    data: PaymobTransactionResponse,
  ): PaymobTransactionResponse {
    const out: PaymobTransactionResponse = { ...data };

    // Never covered by Paymob transaction HMAC — do not drive paid/partial/refund totals.
    delete out.is_captured;
    delete out.captured_amount;
    delete out.refunded_amount_cents;

    // HMAC binds is_refunded ?? is_refund. If the current-state field is
    // present (including false), the action alias is unsigned.
    if (out.is_refunded !== undefined) {
      delete out.is_refund;
    }
    if (out.is_voided !== undefined) {
      delete out.is_void;
    }

    return out;
  }

  /**
   * Money on WebhookEvent for dual-write / refund / incomplete-capture snapshots.
   * Charge statuses use signed amount_cents. Refund domain statuses must not
   * publish order total as the refund amount (PAYMOB-3) — only a positive
   * trusted refunded total (API path; webhooks strip unsigned cents) qualifies.
   * Incomplete refunds omit amount so consumers inquire rather than book order total.
   *
   * PAYMOB-1: incomplete capture (`processing` from success+is_capture without a
   * trusted `captured_amount`) must not publish full order `amount_cents` either —
   * symmetric with incomplete refunds. Callers inquire for cumulative captured.
   */
  private resolveWebhookEventAmount(
    status: PaymentStatus,
    amountCents: number,
    currency: string,
    refundedAmountCents?: number,
  ): number | undefined {
    const isRefundDomain =
      status === "refunded" ||
      status === "partially_refunded" ||
      status === "refund_completed" ||
      status === "refund_pending" ||
      status === "refund_failed";

    if (isRefundDomain) {
      if (refundedAmountCents !== undefined && refundedAmountCents > 0) {
        return this.fromMinorUnits(refundedAmountCents, currency);
      }
      return undefined;
    }

    // Incomplete capture money snapshot — do not book full order amount_cents.
    if (status === "processing") {
      return undefined;
    }

    return this.fromMinorUnits(amountCents, currency);
  }

  /**
   * Bind HMAC-covered `order.id` onto Phase-7 `parentId` / `relatedIds.orderId` only.
   *
   * PAYMOB-2: never put order.id on `gatewayObjectId` (Phase-7 promotes that field
   * to `refundId` / `captureId`). True refund/capture resource id is the emitting
   * transaction (`gatewayPaymentId` / `obj.id`).
   */
  private withPaymobSignedOrderParent(
    event: WebhookEvent,
    signedOrderId: string | undefined,
  ): WebhookEvent {
    if (
      signedOrderId === undefined ||
      signedOrderId === event.gatewayPaymentId ||
      event.event === undefined
    ) {
      return event;
    }

    const txnId = event.gatewayPaymentId;
    const patchRefs = (refs: ProviderReferences): ProviderReferences => {
      const relatedIds: NonNullable<ProviderReferences["relatedIds"]> = {
        ...(refs.relatedIds ?? {}),
        orderId: signedOrderId,
      };
      // Never leave order.id labeled as the refund/capture resource.
      if (relatedIds.refundId === signedOrderId) {
        relatedIds.refundId = txnId;
      }
      if (relatedIds.captureId === signedOrderId) {
        relatedIds.captureId = txnId;
      }
      if (relatedIds.objectId === signedOrderId) {
        delete relatedIds.objectId;
      }
      return {
        ...refs,
        parentId: signedOrderId,
        relatedIds,
      };
    };

    const pe = event.event;
    let next: PaymentEvent = pe;

    switch (pe.type) {
      case "payment.created":
      case "payment.processing":
      case "payment.authorized":
      case "payment.succeeded":
      case "payment.failed":
      case "payment.cancelled":
        next = {
          ...pe,
          payment: {
            ...pe.payment,
            references: patchRefs(pe.payment.references),
          },
        };
        break;
      case "capture.completed":
        next = {
          ...pe,
          capture: {
            ...pe.capture,
            references: (() => {
              const refs = patchRefs(pe.capture.references);
              const relatedIds = {
                ...(refs.relatedIds ?? {}),
                captureId: refs.relatedIds?.captureId ?? txnId,
              };
              return { ...refs, relatedIds };
            })(),
          },
          ...(pe.payment !== undefined
            ? {
                payment: {
                  ...pe.payment,
                  references: patchRefs(pe.payment.references),
                },
              }
            : {}),
        };
        break;
      case "refund.pending":
      case "refund.completed":
      case "refund.failed":
        next = {
          ...pe,
          refund: {
            ...pe.refund,
            references: (() => {
              const refs = patchRefs(pe.refund.references);
              const relatedIds = {
                ...(refs.relatedIds ?? {}),
                refundId: refs.relatedIds?.refundId ?? txnId,
              };
              return { ...refs, relatedIds };
            })(),
          },
        };
        break;
      case "provider.unmapped":
        if (pe.payment !== undefined) {
          next = {
            ...pe,
            payment: {
              ...pe.payment,
              references: patchRefs(pe.payment.references),
            },
          };
        }
        break;
      default:
        break;
    }

    return {
      ...event,
      event: next,
    };
  }

  /**
   * Build Paymob flag + amount context for stable event mapping.
   * Uses {@link parseBoolean} so redirect callbacks (string `"true"`/`"false"`)
   * contribute flags the same way as processed JSON booleans.
   *
   * Amounts are included so Phase 7 dual-write agrees with
   * {@link mapTransactionStatus} for amount-only refunds (`refunded_amount_cents`
   * without `is_refund` / `is_refunded`) and auth+capture (`captured_amount`
   * while `is_auth` remains true). Prefer normalized `WebhookEvent.status`
   * (merged by {@link attachPaymentEvent}); amounts are defense-in-depth.
   */
  private paymobMapContextFromTransaction(
    obj: Pick<
      PaymobTransactionResponse,
      | "success"
      | "pending"
      | "is_auth"
      | "is_capture"
      | "is_void"
      | "is_refund"
      | "is_voided"
      | "is_refunded"
      | "amount_cents"
      | "refunded_amount_cents"
      | "captured_amount"
    >,
  ): ProviderEventMapContext {
    const flags: NonNullable<ProviderEventMapContext["flags"]> = {};
    const success = this.parseBoolean(obj.success);
    const pending = this.parseBoolean(obj.pending);
    const isAuth = this.parseBoolean(obj.is_auth);
    const isCapture = this.parseBoolean(obj.is_capture);
    const isVoid = this.parseBoolean(obj.is_void);
    const isRefund = this.parseBoolean(obj.is_refund);
    const isVoided = this.parseBoolean(obj.is_voided);
    const isRefunded = this.parseBoolean(obj.is_refunded);

    if (success !== undefined) flags.success = success;
    if (pending !== undefined) flags.pending = pending;
    if (isAuth !== undefined) flags.isAuth = isAuth;
    if (isCapture !== undefined) flags.isCapture = isCapture;
    if (isVoid !== undefined) flags.isVoid = isVoid;
    if (isRefund !== undefined) flags.isRefund = isRefund;
    if (isVoided !== undefined) flags.isVoided = isVoided;
    if (isRefunded !== undefined) flags.isRefunded = isRefunded;

    const amounts: NonNullable<ProviderEventMapContext["amounts"]> = {};
    if (typeof obj.amount_cents === "number") {
      amounts.amountCents = obj.amount_cents;
    }
    if (typeof obj.refunded_amount_cents === "number") {
      amounts.refundedAmountCents = obj.refunded_amount_cents;
    }
    if (typeof obj.captured_amount === "number") {
      amounts.capturedAmountCents = obj.captured_amount;
    }

    const ctx: ProviderEventMapContext = { flags };
    if (
      amounts.amountCents !== undefined ||
      amounts.refundedAmountCents !== undefined ||
      amounts.capturedAmountCents !== undefined
    ) {
      ctx.amounts = amounts;
    }
    return ctx;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Retrieve transaction details from Paymob
   * @see https://developers.paymob.com/paymob-docs/developers/retrieve-a-transaction-inquiry-with-order-id-copy-1/retreive-transaction-with-transaction-id
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("getPayment", params, async (p) => {
      const { gatewayPaymentId } = p;
      this.assertPaymobTransactionId(gatewayPaymentId, "getPayment");
      this.assertPostPayCredentials();
      // Resolve auth once outside the retry loop so preflight auth failures
      // (especially legacy /api/auth/tokens) are not auto-retried.
      const headers = await this.getInquiryAuthHeaders();

      // GET inquiry is safe to retry on transient failures.
      return withRetry(async () => {
        const response = await this.fetchPaymob(
          `${this.baseUrl}/api/acceptance/transactions/${gatewayPaymentId}`,
          this.withCallerSignal(
            {
              method: "GET",
              headers,
            },
            p,
          ),
          "Transaction Inquiry",
        );

        const data = await this.parseJson<PaymobTransactionResponse | {
          obj?: Record<string, unknown>;
          message?: string;
        }>(response);

        if (!response.ok) {
          throw this.createPaymobApiError(
            data.message ?? "Failed to retrieve Paymob transaction",
            response,
            data,
          );
        }

        const transaction = this.normalizeApiTransactionResponse(data, "transaction inquiry");
        const moneyCurrency = this.resolveMoneyCurrency(transaction, "transaction inquiry");
        const status = this.mapTransactionStatus(transaction);
        // Identified inquiry (id + money) with omitted `success` is incomplete
        // (`processing` / requires_action), not declined (S20-PAYMOB-SUCCESS-OMIT).
        // Explicit `success: false` still maps failed. Empty / invalid JSON is
        // GatewayApiError (S19-PAYMOB-JSON). Mutations use requireMutationBoolean.
        const successFlag =
          typeof transaction.success === "boolean" ? transaction.success : false;
        const outcome = this.mapPaymobOutcome(status, successFlag, {
          pending: this.parseBoolean(transaction.pending) === true,
        });

        // PAYMOB-3: always dual-write currency with major-unit money fields so
        // Phase-6 snapshots / inventory do not drop naked majors.
        const hasMoney =
          transaction.amount_cents !== undefined ||
          transaction.captured_amount !== undefined ||
          transaction.refunded_amount_cents !== undefined;

        return applyOutcomeToGatewayResult(
          {
            gatewayId: String(transaction.id ?? gatewayPaymentId),
            status,
            rawResponse: data,
            ...(hasMoney ? { currency: moneyCurrency.toUpperCase() } : {}),
            ...(transaction.amount_cents !== undefined
              ? {
                  amount: this.fromMinorUnits(
                    transaction.amount_cents,
                    moneyCurrency,
                  ),
                }
              : {}),
            ...(transaction.captured_amount !== undefined
              ? {
                  capturedAmount: this.fromMinorUnits(
                    transaction.captured_amount,
                    moneyCurrency,
                  ),
                }
              : {}),
            ...(transaction.refunded_amount_cents !== undefined
              ? {
                  refundedAmount: this.fromMinorUnits(
                    transaction.refunded_amount_cents,
                    moneyCurrency,
                  ),
                }
              : {}),
            gateway: "paymob",
          },
          outcome,
          outcome === "declined"
            ? {
                decline: {
                  code: "TRANSACTION_DECLINED",
                  message: "Paymob transaction was declined",
                },
              }
            : undefined,
        );
      }, { isRetryable: isPaymobRetryableError });
    }, GetPaymentParamsSchema);
  }

  async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
    const payment = await this.getPayment({ gatewayPaymentId: gatewayId });
    return payment.status;
  }

  private async resolveActionAmountCents(
    gatewayPaymentId: string,
    amount: AmountInput | undefined,
    operation: PaymobActionOperation,
    currency?: string,
    signal?: AbortSignal,
  ): Promise<PaymobResolvedActionAmount> {
    const transaction = await this.fetchTransaction(
      gatewayPaymentId,
      `${operation} amount`,
      signal,
    );

    if (amount !== undefined) {
      const transactionCurrency = this.requireString(
        transaction.currency,
        `Paymob ${operation} requires transaction currency to validate the requested amount`,
        transaction,
      );
      const resolvedCurrency = this.resolveCurrency(currency ?? transactionCurrency);
      const expectedCurrency = this.resolveCurrency(transactionCurrency);

      if (resolvedCurrency !== expectedCurrency) {
        throw new InvalidRequestError(
          `Paymob ${operation} currency ${resolvedCurrency} does not match transaction currency ${expectedCurrency}`,
          [{ path: ["currency"] }],
        );
      }

      const amountCents = this.toMinorUnits(amount, resolvedCurrency);
      const remainingCents = this.resolveRemainingActionAmountCents(
        transaction,
        operation,
      );

      if (amountCents > remainingCents) {
        const adjective = operation === "capture" ? "capturable" : "refundable";
        throw new InvalidRequestError(
          `Paymob ${operation} amount exceeds the remaining ${adjective} amount`,
          [{ path: ["amount"] }],
        );
      }

      return {
        amountCents,
        currency: resolvedCurrency,
        transactionAmountCents: this.requireNumber(
          transaction.amount_cents,
          `Paymob ${operation} requires amount_cents, but transaction inquiry response is missing amount_cents`,
          transaction,
        ),
        capturedAmountCents: transaction.captured_amount,
        refundedAmountCents: transaction.refunded_amount_cents,
      };
    }

    const transactionCurrency = this.requireString(
      transaction.currency,
      `Paymob ${operation} amount was resolved from transaction inquiry, but response is missing currency`,
      transaction,
    );
    return {
      amountCents: this.resolveRemainingActionAmountCents(transaction, operation),
      currency: this.resolveCurrency(transactionCurrency),
      transactionAmountCents: this.requireNumber(
        transaction.amount_cents,
        `Paymob ${operation} requires amount_cents, but transaction inquiry response is missing amount_cents`,
        transaction,
      ),
      capturedAmountCents: transaction.captured_amount,
      refundedAmountCents: transaction.refunded_amount_cents,
    };
  }

  private resolveRemainingActionAmountCents(
    transaction: PaymobTransactionResponse,
    operation: PaymobActionOperation,
  ): number {
    this.assertInquiryAllowsMoneyAction(transaction, operation);

    const amountCents = this.requireNumber(
      transaction.amount_cents,
      `Paymob ${operation} requires amount_cents, but transaction inquiry response is missing amount_cents`,
      transaction,
    );
    if (operation === "refund" && this.isUncapturedAuthorization(transaction)) {
      throw new InvalidRequestError(
        "Paymob refund requires a captured/paid transaction. Use voidPayment for uncaptured authorizations.",
        [{ path: ["gatewayPaymentId"] }],
      );
    }

    // PAYMOB-2: terminal current-state flags without a positive amount total
    // mean money may already be fully moved but the cumulative is untrusted.
    // Fail-closed: treat as no remaining (refuse over-capture / over-refund).
    if (operation === "capture") {
      const hasPositiveCaptured =
        transaction.captured_amount !== undefined && transaction.captured_amount > 0;
      if (transaction.is_captured === true && !hasPositiveCaptured) {
        throw new InvalidRequestError(
          "Paymob capture amount could not be resolved because no remaining amount is available",
          [{ path: ["amount"] }],
        );
      }
    } else {
      const hasPositiveRefunded =
        transaction.refunded_amount_cents !== undefined &&
        transaction.refunded_amount_cents > 0;
      if (transaction.is_refunded === true && !hasPositiveRefunded) {
        throw new InvalidRequestError(
          "Paymob refund amount could not be resolved because no remaining amount is available",
          [{ path: ["amount"] }],
        );
      }
      // is_captured without cumulative captured total: refund baseline unknown.
      const hasPositiveCaptured =
        transaction.captured_amount !== undefined && transaction.captured_amount > 0;
      if (transaction.is_captured === true && !hasPositiveCaptured) {
        throw new InvalidRequestError(
          "Paymob refund amount could not be resolved because no remaining amount is available",
          [{ path: ["amount"] }],
        );
      }
    }

    const totalAvailableCents = operation === "refund"
      ? transaction.captured_amount && transaction.captured_amount > 0
        ? transaction.captured_amount
        : amountCents
      : amountCents;
    const alreadyMovedCents = operation === "capture"
      ? transaction.captured_amount ?? 0
      : transaction.refunded_amount_cents ?? 0;
    const remainingCents = totalAvailableCents - alreadyMovedCents;

    if (remainingCents <= 0) {
      throw new InvalidRequestError(
        `Paymob ${operation} amount could not be resolved because no remaining amount is available`,
        [{ path: ["amount"] }],
      );
    }

    return remainingCents;
  }

  /**
   * S19-PAYMOB-REFUND-UNPAID: do not POST refund/capture against a pending or
   * failed sale. Remaining math would treat omitted captured_amount as the full
   * amount_cents and mutate an unpaid transaction.
   *
   * Capture of an authorization (`success` + `is_auth`, no capture yet) is
   * allowed. Refund of a paid sale (`success: true`) is allowed. Inquiry that
   * omits `success`/`pending` keeps prior remaining-math behavior.
   */
  private assertInquiryAllowsMoneyAction(
    transaction: PaymobTransactionResponse,
    operation: PaymobActionOperation,
  ): void {
    if (transaction.pending === true) {
      throw new InvalidRequestError(
        `Paymob ${operation} requires a captured/paid transaction, not a pending sale`,
        [{ path: ["gatewayPaymentId"] }],
      );
    }

    const hasPositiveCaptured =
      transaction.captured_amount !== undefined && transaction.captured_amount > 0;
    if (
      transaction.success === false &&
      !hasPositiveCaptured &&
      transaction.is_captured !== true
    ) {
      throw new InvalidRequestError(
        `Paymob ${operation} requires a captured/paid transaction, not a failed or declined sale`,
        [{ path: ["gatewayPaymentId"] }],
      );
    }
  }

  private isUncapturedAuthorization(transaction: PaymobTransactionResponse): boolean {
    return transaction.is_auth === true &&
      transaction.is_capture !== true &&
      transaction.is_captured !== true &&
      !(transaction.captured_amount !== undefined && transaction.captured_amount > 0);
  }

  private async fetchTransaction(
    gatewayPaymentId: string,
    operation: string,
    signal?: AbortSignal,
  ): Promise<PaymobTransactionResponse> {
    // Resolve auth once outside the retry loop so preflight auth failures
    // (especially legacy /api/auth/tokens) are not auto-retried and do not
    // poison post-pay idempotency keys.
    const headers = await this.getInquiryAuthHeaders();

    // GET inquiry is safe to retry on transient failures.
    return withRetry(async () => {
      const init: RequestInit = {
        method: "GET",
        headers,
      };
      if (signal) {
        init.signal = signal;
      }
      const response = await this.fetchPaymob(
        `${this.baseUrl}/api/acceptance/transactions/${gatewayPaymentId}`,
        init,
        `Transaction Inquiry for ${operation}`,
      );

      const data = await this.parseJson<PaymobTransactionResponse>(response);

      if (!response.ok) {
        throw this.createPaymobApiError(
          data.message ?? `Failed to retrieve Paymob transaction for ${operation}`,
          response,
          data,
        );
      }

      return this.normalizeApiTransactionResponse(data, operation);
    }, { isRetryable: isPaymobRetryableError });
  }

  /**
   * Build a GatewayApiError that carries the response status and any
   * Retry-After delay so the retry helper can honor it on 429s.
   */
  private createPaymobApiError(
    message: string,
    response: Response,
    data: unknown,
  ): GatewayApiError {
    const error = new GatewayApiError(message, "paymob", {
      status: response.status,
      response: data,
    });
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers);
    if (retryAfterSeconds !== undefined) {
      (error as GatewayApiError & { retryAfterSeconds?: number }).retryAfterSeconds =
        retryAfterSeconds;
    }
    return error;
  }

  /**
   * Map Paymob transaction response to unified PaymentStatus.
   * Order: pending → void → refund (flags or amounts) → capture amounts →
   * incomplete capture action → auth-only → paid / failed / omitted-success processing.
   * Capture amounts are evaluated before the is_auth early return so a partially captured
   * auth transaction maps to partially_captured, not authorized.
   *
   * **Fail-closed money completeness (PAYMOB-1 / PAYMOB-2):**
   * - Full `refunded` / `partially_refunded` require a positive trusted
   *   `refunded_amount_cents` (API/inquiry). Webhooks strip that field; signed
   *   `is_refund` / `is_refunded` alone → incomplete `refund_completed`.
   * - Full `paid` from a capture action or `is_captured` current-state requires
   *   positive `captured_amount`. `is_capture` / `is_captured` + success without
   *   that total → `processing` (inquire), never fail-open to `paid` + full
   *   `amount_cents` (partial capture risk). Aligns with {@link mapCaptureStatus}.
   * - Plain sale `success` (not capture/auth/`is_captured`) still maps `paid` —
   *   charge amount is HMAC-covered `amount_cents`.
   */
  private mapTransactionStatus(data: {
    success?: boolean;
    pending?: boolean;
    is_void?: boolean;
    is_refund?: boolean;
    is_voided?: boolean;
    is_refunded?: boolean;
    has_parent_transaction?: boolean;
    error_occured?: boolean;
    amount_cents?: number;
    refunded_amount_cents?: number;
    captured_amount?: number;
    is_auth?: boolean;
    is_capture?: boolean;
    is_captured?: boolean;
  }): PaymentStatus {
    if (data.pending) return "pending";
    // Webhook sanitize already dropped unsigned is_refund / is_void when
    // current-state is present (I1). Remaining action flags are HMAC aliases
    // or trusted inquiry/API fields. Child refunds/voids on the webhook path
    // therefore see signed has_parent_transaction plus a signed flag only.
    if (
      data.is_voided === true ||
      (data.success === true && data.is_void === true)
    ) {
      return "cancelled";
    }

    // Explicit refund flags, or refunded_amount_cents alone (API/inquiry path only —
    // webhooks always strip unsigned refunded_amount_cents / captured_amount).
    // When captured_amount > 0 (partial capture), completeness is vs captured total — not auth amount_cents.
    // Full refund of captured amount => refunded even if captured < amount_cents.
    if (
      data.is_refunded === true ||
      (data.success === true && data.is_refund === true) ||
      (data.refunded_amount_cents !== undefined && data.refunded_amount_cents > 0)
    ) {
      const refundedAmountCents = data.refunded_amount_cents;
      const hasPositiveRefundedAmount =
        refundedAmountCents !== undefined && refundedAmountCents > 0;
      const refundBaseline =
        data.captured_amount !== undefined && data.captured_amount > 0
          ? data.captured_amount
          : data.amount_cents;
      if (
        refundBaseline !== undefined &&
        hasPositiveRefundedAmount &&
        refundedAmountCents < refundBaseline
      ) {
        return "partially_refunded";
      }
      // Completeness requires a positive refunded total vs baseline (API/inquiry).
      // Signed is_refund action and is_refunded current-state are both incomplete
      // without that total — never fail-open as full `refunded` (PAYMOB-2).
      if (!hasPositiveRefundedAmount) {
        return "refund_completed";
      }
      return "refunded";
    }

    // PAYMOB-3: HMAC-covered error_occured. Signed error + success must not
    // look paid / payment.succeeded. Refund/void current-state already returned.
    if (data.error_occured === true) {
      return "failed";
    }

    // Capture amounts before auth-only: success + captured_amount > 0 is paid or partially_captured.
    // (Webhook path strips unsigned captured_amount / is_captured; API inquiry keeps them.)
    if (data.success && data.captured_amount !== undefined && data.captured_amount > 0) {
      if (
        data.amount_cents !== undefined &&
        data.captured_amount < data.amount_cents
      ) {
        return "partially_captured";
      }
      return "paid";
    }

    // PAYMOB-1: capture action (`is_capture`) or current-state (`is_captured`)
    // without a trusted positive cumulative total cannot distinguish partial vs
    // full capture. Fail-closed to processing (not paid + full amount_cents).
    // Aligns with mapCaptureStatus (positive cumulative required for paid).
    if (
      data.success === true &&
      (data.is_capture === true || data.is_captured === true)
    ) {
      return "processing";
    }

    // Auth-only: authorized when still uncaptured (no capture flags and no captured_amount).
    if (
      data.success &&
      data.is_auth &&
      !data.is_capture &&
      !data.is_captured &&
      !(data.captured_amount !== undefined && data.captured_amount > 0)
    ) {
      return "authorized";
    }

    if (data.success === true) return "paid";
    if (data.success === false) return "failed";
    // Identified snapshot without a boolean `success` is incomplete — not a decline.
    return "processing";
  }

  private mapCaptureStatus(
    data: PaymobCaptureResponse,
    success: boolean,
    resolved?: {
      transactionAmountCents: number;
      cumulativeCapturedAmountCents?: number | undefined;
    },
  ): PaymentStatus {
    if (!success) return "failed";

    // PAYMOB-1: never map capture success to paid / isPaidOutcome without a
    // positive captured total. Sparse bodies and captured_amount:0 fall through
    // mapTransactionStatus to paid when is_capture blocks the auth branch.
    const cumulative = resolved?.cumulativeCapturedAmountCents ?? data.captured_amount;
    if (cumulative === undefined || cumulative <= 0) {
      return "processing";
    }

    const statusData: Parameters<typeof this.mapTransactionStatus>[0] = {
      success: true,
      is_capture: true,
      captured_amount: cumulative,
    };
    if (resolved) {
      statusData.amount_cents = resolved.transactionAmountCents;
    } else if (data.amount_cents !== undefined) {
      statusData.amount_cents = data.amount_cents;
    }

    return this.mapTransactionStatus(statusData);
  }

  /**
   * Map Paymob transaction flags + status to Phase 6 outcome.
   * Intention/pending checkout → requires_action; success txn → succeeded;
   * declined → declined. Never invent paid on pending.
   *
   * **Fulfillment honesty:** `outcome === "succeeded"` is **not** paid alone.
   * Auth holds and refunds may dual-write `succeeded` (hold placed / money
   * returned) while {@link isPaidOutcome} stays false unless status is `paid`.
   * Partial captures dual-write `requires_action` (open money story). Prefer
   * `isPaidOutcome(result)` or `status === "paid"` — never fulfill on bare
   * `outcome === "succeeded"` / `success: true`.
   */
  private mapPaymobOutcome(
    status: PaymentStatus,
    success: boolean,
    options: { pending?: boolean } = {},
  ): PaymentOperationOutcome {
    if (options.pending === true) {
      return "requires_action";
    }
    if (status === "failed") {
      return "declined";
    }
    if (status === "pending" || status === "processing") {
      return "requires_action";
    }
    if (status === "cancelled") {
      // Void sets outcome explicitly; inquiry of a voided txn is not a charge success.
      return "failed";
    }
    // Partial capture is open money — not outcome-succeeded (type dual-write uses processing).
    if (status === "partially_captured") {
      return "requires_action";
    }
    // Incomplete refund money snapshot — inquire before treating as full reverse.
    if (status === "refund_completed") {
      return "requires_action";
    }
    // Refunds may still be operation-succeeded without success flag; never isPaidOutcome.
    if (status === "refunded" || status === "partially_refunded") {
      return "succeeded";
    }
    // Missing/false success: fail-closed for charge settlement (paid/auth).
    if (!success) {
      return "declined";
    }
    // paid | authorized | setup_completed | other success-flag paths
    return "succeeded";
  }

  private assertPaymobTransactionId(gatewayPaymentId: string, operation: string): void {
    if (/^\d+$/.test(gatewayPaymentId)) {
      return;
    }

    if (gatewayPaymentId.startsWith("pi_")) {
      throw new InvalidRequestError(
        `Paymob ${operation} requires the numeric transaction ID from a verified Paymob webhook (or the dashboard), not the intention ID returned by createPayment (e.g. "pi_..."). Store transaction id (obj.id) from the processed callback — do not pass the intention id from create.`,
        [{ path: ["gatewayPaymentId"] }],
      );
    }

    throw new InvalidRequestError(
      `Paymob ${operation} requires a numeric transaction ID from the verified Paymob webhook (obj.id) or dashboard. Do not pass an intention ID, ecommerce order ID, or createPayment gatewayId from iframe checkout.`,
      [{ path: ["gatewayPaymentId"] }],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Authentication
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Post-pay management APIs (capture, refund, void, inquiry) accept either:
   * - secretKey via `Authorization: Token …` (preferred; no body auth_token), or
   * - apiKey via legacy `/api/auth/tokens` + body `auth_token` / Bearer inquiry.
   */
  private assertPostPayCredentials(): void {
    if (this.paymobConfig.secretKey || this.paymobConfig.apiKey) {
      return;
    }

    throw new GatewayApiError(
      "Paymob requires secretKey or apiKey for capture, refund, void, and transaction inquiry",
      "paymob",
      { config: "missing_credentials" },
    );
  }

  /**
   * Build headers + body for capture / refund / void.
   * Prefer secretKey Token header without auth_token in the body.
   */
  private async buildPostPayMutation(
    body: Record<string, unknown>,
  ): Promise<{ headers: Record<string, string>; body: Record<string, unknown> }> {
    if (this.paymobConfig.secretKey) {
      return {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${this.paymobConfig.secretKey}`,
        },
        body,
      };
    }

    const token = await this.authenticateLegacy();
    return {
      headers: { "Content-Type": "application/json" },
      body: {
        auth_token: token,
        ...body,
      },
    };
  }

  /**
   * Auth headers for transaction inquiry GET.
   * Prefer secretKey Token; fall back to legacy Bearer from apiKey token exchange.
   */
  private async getInquiryAuthHeaders(): Promise<Record<string, string>> {
    if (this.paymobConfig.secretKey) {
      return {
        "Content-Type": "application/json",
        Authorization: `Token ${this.paymobConfig.secretKey}`,
      };
    }

    const token = await this.authenticateLegacy();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Authenticate with Paymob token API for legacy checkout and management APIs.
   * Uses an in-flight promise so concurrent callers share a single auth request
   * instead of stampeding the /api/auth/tokens endpoint.
   */
  private async authenticateLegacy(): Promise<string> {
    // Check if we have a valid cached token (cache TTL vs injectable clock).
    if (this.legacyAuthToken && this.clock.nowMs() < this.legacyAuthTokenExpiry) {
      return this.legacyAuthToken;
    }

    // Reuse an in-flight token fetch if one is already running.
    if (this.legacyAuthTokenPromise) {
      return this.legacyAuthTokenPromise;
    }

    this.legacyAuthTokenPromise = this.fetchLegacyAuthToken();
    try {
      return await this.legacyAuthTokenPromise;
    } finally {
      this.legacyAuthTokenPromise = null;
    }
  }

  private async fetchLegacyAuthToken(): Promise<string> {
    const apiKey = this.paymobConfig.apiKey;
    if (!apiKey) {
      throw new GatewayApiError(
        "Paymob apiKey is required for legacy authentication when secretKey is not configured",
        "paymob",
        { config: "missing_api_key" },
      );
    }

    // Auth is intentionally not auto-retried: a transient preflight auth
    // failure should surface so the caller can retry the whole operation
    // without poisoning an idempotency reservation for the mutation.
    const response = await this.fetchPaymob(
      `${this.baseUrl}/api/auth/tokens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      },
      "Auth",
    );

    const data = await this.parseJson<PaymobAuthResponse>(response);

    if (!response.ok) {
      throw this.createPaymobApiError(
        data.message ?? "Failed to authenticate with Paymob",
        response,
        data,
      );
    }

    const token = this.requireString(
      data.token,
      "Paymob Auth API response is missing token",
      data,
    );

    this.legacyAuthToken = token;
    this.legacyAuthTokenExpiry = this.resolveAuthTokenExpiry(token);

    return this.legacyAuthToken;
  }

  /**
   * Determine when to refresh the cached auth token. Prefer the actual expiry
   * encoded in the JWT (`exp`), refreshing 5 minutes early; fall back to 50
   * minutes when the expiry can't be read.
   */
  private resolveAuthTokenExpiry(token: string): number {
    const FALLBACK_MS = 50 * 60 * 1000;
    const fallback = this.clock.nowMs() + FALLBACK_MS;

    const expiryMs = this.decodeJwtExpiryMs(token);
    if (expiryMs === undefined) {
      return fallback;
    }

    const refreshSkewMs = 5 * 60 * 1000;
    const withSkew = expiryMs - refreshSkewMs;
    // JWT `exp` is wall-clock epoch seconds, not a cache TTL.
    return withSkew > Date.now() ? withSkew : fallback;
  }

  /**
   * Decode the `exp` claim (epoch seconds) from a JWT without verifying its
   * signature. Returns the expiry in milliseconds, or undefined if the token is
   * not a decodable JWT.
   */
  private decodeJwtExpiryMs(token: string): number | undefined {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return undefined;
    }

    try {
      const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(
        base64.length + ((4 - (base64.length % 4)) % 4),
        "=",
      );
      const json = atob(padded);
      const payload = JSON.parse(json) as { exp?: unknown };
      if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
        return payload.exp * 1000;
      }
    } catch {
      // Not a decodable JWT; fall back to the default expiry.
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private resolvePaymentMethods(params: PaymobCreatePaymentParams): PaymobPaymentMethod[] {
    if (params.paymobPaymentMethods?.length) {
      return params.paymobPaymentMethods.map((method) => this.normalizePaymentMethod(method));
    }

    // Per-request override always wins.
    if (params.paymobIntegrationId !== undefined && params.paymobIntegrationId !== null) {
      return [this.normalizePaymentMethod(params.paymobIntegrationId)];
    }

    if (params.capture === false) {
      // Auth/capture is integration-driven. Never fall back to sale integrationId —
      // a sale integration can settle immediately despite is_auth/payment_type AUTH.
      if (this.paymobConfig.authIntegrationId !== undefined && this.paymobConfig.authIntegrationId !== null) {
        return [this.normalizePaymentMethod(this.paymobConfig.authIntegrationId)];
      }

      throw new GatewayApiError(
        "Paymob capture:false requires paymobIntegrationId, paymobPaymentMethods, or paymob.authIntegrationId because Paymob auth/capture is integration-driven (sale integrationId is not used as a silent fallback)",
        "paymob",
        { config: "missing_auth_integration_id" },
      );
    }

    if (this.paymobConfig.integrationId === undefined || this.paymobConfig.integrationId === null) {
      throw new GatewayApiError(
        "Paymob Intention API requires integrationId, paymobIntegrationId, or paymobPaymentMethods",
        "paymob",
        { config: "missing_payment_methods" },
      );
    }

    return [this.normalizePaymentMethod(this.paymobConfig.integrationId)];
  }

  private resolveSpecialReference(params: PaymobCreatePaymentParams): string | undefined {
    return this.stringOrUndefined(params.metadata?.paymentId) ??
      this.stringOrUndefined(params.metadata?.orderId) ??
      params.orderId ??
      params.idempotencyKey;
  }

  private normalizePaymentMethod(method: PaymobPaymentMethod): PaymobPaymentMethod {
    if (typeof method === "number") {
      return method;
    }

    const trimmed = method.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }

    return trimmed;
  }

  private warnIfPerPaymentCallbacksMayBeIgnored(
    params: PaymobCreatePaymentParams,
    paymentMethods: PaymobPaymentMethod[],
  ): void {
    const hasPerPaymentCallback = Boolean(params.callbackUrl || params.returnUrl);
    if (!hasPerPaymentCallback || paymentMethods.length === 0) {
      return;
    }

    const aliases = paymentMethods.filter((method): method is string => typeof method === "string");
    if (aliases.length !== paymentMethods.length) {
      return;
    }

    const hasCardLikeAlias = aliases.some((alias) => {
      const normalized = alias.trim().toLowerCase();
      return normalized.includes("card") ||
        normalized.includes("migs") ||
        normalized.includes("omannet") ||
        normalized.includes("oman_net") ||
        normalized.includes("visa") ||
        normalized.includes("mastercard") ||
        normalized.includes("mada");
    });
    if (hasCardLikeAlias) {
      return;
    }

    this.logger.warn(
      "[Paymob] notification_url/redirection_url are documented for card integrations; configure dashboard callbacks for non-card payment methods.",
    );
  }

  private buildBillingData(
    params: PaymobCreatePaymentParams,
    options: { includeShippingMethod?: boolean } = {},
  ): PaymobBillingData {
    const source = params.paymobBillingData;
    const metadata = params.metadata ?? {};

    const email = source?.email ?? this.stringOrUndefined(metadata.email);
    const firstName = source?.firstName ?? this.stringOrUndefined(metadata.firstName);
    const lastName = source?.lastName ?? this.stringOrUndefined(metadata.lastName);
    const phone = source?.phone ?? this.stringOrUndefined(metadata.phone);
    const missing = [
      ["email", email],
      ["firstName", firstName],
      ["lastName", lastName],
      ["phone", phone],
    ].filter(([, value]) => !value).map(([field]) => field);

    if (missing.length > 0) {
      throw new InvalidRequestError(
        `Paymob billing data is missing required field(s): ${missing.join(", ")}`,
        missing.map((field) => ({ path: ["paymobBillingData", field] })),
      );
    }

    this.validateBillingDataField("email", email!, { email: true });
    this.validateBillingDataField("firstName", firstName!, { maxLength: 50 });
    this.validateBillingDataField("lastName", lastName!, { maxLength: 50 });
    this.validateBillingDataField("phone", phone!, { minLength: 5, maxLength: 32 });

    const billingData: PaymobBillingData = {
      email: email!,
      first_name: firstName!,
      last_name: lastName!,
      phone_number: phone!,
      country: source?.country ?? this.stringOrUndefined(metadata.country) ?? this.defaultCountry(),
      city: source?.city ?? this.stringOrUndefined(metadata.city) ?? "NA",
      street: source?.street ?? this.stringOrUndefined(metadata.street) ?? "NA",
      building: source?.building ?? this.stringOrUndefined(metadata.building) ?? "NA",
      apartment: source?.apartment ?? this.stringOrUndefined(metadata.apartment) ?? "NA",
      floor: source?.floor ?? this.stringOrUndefined(metadata.floor) ?? "NA",
      postal_code: source?.postalCode ?? this.stringOrUndefined(metadata.postalCode) ?? "NA",
      state: source?.state ?? this.stringOrUndefined(metadata.state) ?? "NA",
    };

    if (options.includeShippingMethod) {
      billingData.shipping_method = "NA";
    }

    return billingData;
  }

  private defaultCountry(): string {
    const region = this.paymobConfig.region ?? "ksa";
    const countryByRegion: Record<PaymobRegion, string> = {
      ksa: "SA",
      eg: "EG",
      pk: "PK",
      om: "OM",
      ae: "AE",
    };

    return countryByRegion[region];
  }

  private validateBillingDataField(
    field: string,
    value: string,
    options: { minLength?: number; maxLength?: number; email?: boolean },
  ): void {
    const errors: Array<{ path: string[]; message: string }> = [];

    if (options.minLength !== undefined && value.length < options.minLength) {
      errors.push({
        path: ["paymobBillingData", field],
        message: `Paymob billing ${field} must be at least ${options.minLength} characters`,
      });
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      errors.push({
        path: ["paymobBillingData", field],
        message: `Paymob billing ${field} must be ${options.maxLength} characters or fewer`,
      });
    }

    if (options.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push({
        path: ["paymobBillingData", field],
        message: "Paymob billing email must be a valid email address",
      });
    }

    if (errors.length > 0) {
      throw new InvalidRequestError(
        errors.map((error) => error.message).join("; "),
        errors,
      );
    }
  }

  private defaultCurrency(): string {
    const region = this.paymobConfig.region ?? "ksa";
    return PAYMOB_DEFAULT_CURRENCY_BY_REGION[region];
  }

  private resolveCurrency(currency: string | undefined): string {
    return currency?.toUpperCase() ?? this.defaultCurrency();
  }

  private toMinorUnits(amount: AmountInput, currency: string): number {
    const fractionDigits = this.currencyFractionDigits(currency);
    // Merchant overrides (e.g. OMR:2) passed as explicit exponent so provider
    // differences stay explicit — not ISO-collapsed.
    const parseOpts = {
      rounding: "reject" as const,
      exponent: fractionDigits,
      allowZero: false,
      allowNegative: false,
    };

    try {
      const normalized = normalizeAmountInput(amount, currency, parseOpts);
      const minor = sharedToMinorUnits(normalized, parseOpts);
      return minorAmountToNumber(minor);
    } catch (error) {
      if (!(error instanceof MoneyAmountError)) {
        throw error;
      }
      if (error.kind === "excess_precision") {
        throw new InvalidRequestError(
          `Paymob amount supports at most ${fractionDigits} decimal place(s) for ${currency}`,
          [{ path: ["amount"] }],
        );
      }
      if (error.kind === "negative") {
        throw new InvalidRequestError(
          `Paymob amount must not be negative for ${currency}`,
          [{ path: ["amount"] }],
        );
      }
      if (error.kind === "zero") {
        const minMajor =
          fractionDigits === 0 ? "1" : `0.${"0".repeat(fractionDigits - 1)}1`;
        throw new InvalidRequestError(
          `Paymob amount must be at least ${minMajor} ${currency}`,
          [{ path: ["amount"] }],
        );
      }
      if (error.kind === "unsafe_range") {
        throw new InvalidRequestError(
          `Paymob amount is outside the supported range for ${currency}`,
          [{ path: ["amount"] }],
        );
      }
      if (error.kind === "invalid_format") {
        throw new InvalidRequestError(
          `Paymob amount is invalid for ${currency}`,
          [{ path: ["amount"] }],
        );
      }
      throw error;
    }
  }

  private fromMinorUnits(amount: number, currency: string): number {
    const fractionDigits = this.currencyFractionDigits(currency);
    const money = sharedFromMinorUnits(amount, currency, {
      exponent: fractionDigits,
      allowZero: true,
      allowNegative: true,
    });
    return moneyToMajorNumber(money, {
      exponent: fractionDigits,
      allowZero: true,
      allowNegative: true,
    });
  }

  private resolveMoneyCurrency(
    data: {
      amount_cents?: number;
      captured_amount?: number;
      refunded_amount_cents?: number;
      currency?: string;
    },
    operation: string,
  ): string {
    const hasMoney =
      data.amount_cents !== undefined ||
      data.captured_amount !== undefined ||
      data.refunded_amount_cents !== undefined;

    if (!hasMoney) {
      return this.resolveCurrency(data.currency);
    }

    return this.resolveCurrency(this.requireString(
      data.currency,
      `Paymob ${operation} response includes money amounts but is missing currency`,
      data,
    ));
  }

  private currencyFractionDigits(currency: string): number {
    // Shared lookup: case-insensitive override keys, invalid explicit overrides
    // throw (never silently ignored). Provider map stays gateway-config-local.
    return getCurrencyExponent(
      currency,
      this.paymobConfig.currencyExponentOverrides,
    );
  }

  /**
   * Parse a Paymob JSON body. Must not swallow invalid JSON as `{}`
   * (S19-PAYMOB-JSON).
   *
   * GET / non-mutating empty or non-JSON → {@link GatewayApiError}.
   * Mutating HTTP 200 empty or non-JSON → {@link PaymobIndeterminateResponseError}
   * so requireMutation* fences stay unknown (never a retryable failed/declined).
   */
  private async parseJson<T>(
    response: Response,
    options?: { mutationOperation?: string },
  ): Promise<T> {
    const text = await response.text();
    const trimmed = text.trim();
    const failClosed = (detail: string, cause?: unknown): never => {
      const raw = {
        status: response.status,
        body: text.slice(0, 200),
        ...(cause !== undefined ? { cause } : {}),
      };
      if (options?.mutationOperation !== undefined && response.ok) {
        throw new PaymobIndeterminateResponseError(
          options.mutationOperation,
          detail,
          raw,
        );
      }
      if (
        options?.mutationOperation !== undefined &&
        isPaymobIndeterminateMutationHttpStatus(response.status)
      ) {
        throw new PaymobIndeterminateGatewayError(
          options.mutationOperation,
          response.status,
          raw,
        );
      }
      throw new GatewayApiError(detail, "paymob", raw);
    };

    if (!trimmed) {
      return failClosed("Paymob API returned an empty response");
    }

    try {
      return JSON.parse(trimmed) as T;
    } catch (error) {
      return failClosed("Paymob API returned an invalid JSON response", error);
    }
  }

  private throwPaymobApiError(
    response: Response,
    data: { message?: string; detail?: string } | unknown,
    message: string,
    operation: string,
    options: {
      unknownOnServerError?: boolean;
      unknownAfterObservedSideEffect?: boolean;
    } = {},
  ): never {
    // 5xx and 408 / 409 / 425 / 429 after a mutating POST are not definite
    // rejects — Paymob may have applied the money op (NEW-PAYMOB-2 / 4XX).
    // After an observed side effect (Orders 200 + id), any Payment Keys HTTP
    // error must stay indeterminate so executeIdempotent does not delete the
    // create fence and mint a second order.
    if (
      options.unknownAfterObservedSideEffect ||
      (options.unknownOnServerError &&
        isPaymobIndeterminateMutationHttpStatus(response.status))
    ) {
      throw new PaymobIndeterminateGatewayError(operation, response.status, data);
    }

    throw new GatewayApiError(
      message,
      "paymob",
      { status: response.status, response: data },
    );
  }

  private stringOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return undefined;

    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return undefined;
  }

  private parseNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || value.trim() === "") return undefined;

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private assignOptionalBoolean<K extends keyof PaymobTransactionResponse>(
    target: PaymobTransactionResponse,
    key: K,
    value: unknown,
  ): void {
    const parsed = this.parseBoolean(value);
    if (parsed !== undefined) {
      (target as Record<string, unknown>)[key] = parsed;
    }
  }

  private assignOptionalNumber<K extends keyof PaymobTransactionResponse>(
    target: PaymobTransactionResponse,
    key: K,
    value: unknown,
  ): void {
    const parsed = this.parseNumber(value);
    if (parsed !== undefined) {
      (target as Record<string, unknown>)[key] = parsed;
    }
  }

  private assignOptionalString(
    target: PaymobTransactionResponse & { created_at?: string },
    key: "created_at" | "message",
    value: unknown,
  ): void {
    const parsed = this.stringOrUndefined(value);
    if (parsed !== undefined) {
      (target as Record<string, unknown>)[key] = parsed;
    }
  }

  private parseTimestamp(value: string | undefined): Date {
    if (!value) {
      throw new InvalidWebhookError("Paymob webhook is missing created_at timestamp");
    }

    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      throw new InvalidWebhookError("Paymob webhook has an invalid created_at timestamp");
    }

    return timestamp;
  }

  private allowsLocalUnverifiedWebhooks(): boolean {
    const env = globalThis.process?.env;
    const environmentName =
      env?.NODE_ENV ??
      env?.APP_ENV ??
      env?.VERCEL_ENV ??
      env?.ENVIRONMENT;

    if (typeof environmentName !== "string") {
      return false;
    }

    return ["development", "dev", "test", "local"].includes(
      environmentName.trim().toLowerCase(),
    );
  }

  private async fetchPaymob(
    url: string,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    const timeoutMs = this.paymobConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { signal: timeoutSignal, clear } = createTimeoutSignal(timeoutMs);
    const callerSignal = init.signal ?? undefined;
    const signal = combineAbortSignals(callerSignal, timeoutSignal);

    try {
      const response = await this.fetch(url, {
        ...init,
        ...(signal !== undefined ? { signal } : {}),
      });
      // Keep timeout attached until the body is fully consumed (P610-ABT-4).
      const bodyText = await this.readResponseText(response, signal);
      return new Response(bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      throw mapHttpAbortError(error, {
        callerSignal,
        timeoutSignal,
        timeoutMessage: `Paymob ${operation} API timed out after ${timeoutMs}ms`,
        networkMessage: `Failed to connect to Paymob ${operation} API`,
        callerAbortMessage: `Paymob ${operation} API request aborted by caller signal`,
      });
    } finally {
      clear();
    }
  }

  /**
   * Read the response body while the request timeout/caller signal is still live.
   * Clearing the timeout after headers arrive would let a stalled body hang
   * past `timeoutMs`.
   */
  private async readResponseText(
    response: Response,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    if (signal?.aborted) {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }

    const textPromise = response.text();
    if (!signal) {
      return textPromise;
    }

    let removeAbortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    });

    try {
      return await Promise.race([textPromise, abortPromise]);
    } finally {
      removeAbortListener?.();
      void textPromise.catch(() => undefined);
    }
  }

  private async fetchPaymobMutation(
    url: string,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    try {
      return await this.fetchPaymob(url, init, operation);
    } catch (error) {
      // PAYMOB-FENCE-2: once the mutating POST is on the wire (including
      // body-read), timeout, drop, and caller abort are all indeterminate.
      // PaymentAbortedError must not reach executeIdempotent as a retryable
      // failure that deletes the fence.
      if (error instanceof NetworkError || error instanceof PaymentAbortedError) {
        throw new PaymobIndeterminateNetworkError(error);
      }

      throw error;
    }
  }

  /** Attach optional caller AbortSignal onto a RequestInit (exactOptionalPropertyTypes-safe). */
  private withCallerSignal(
    init: RequestInit,
    params: unknown,
  ): RequestInit {
    const signal = extractAbortSignal(params);
    if (!signal) {
      return init;
    }
    return { ...init, signal };
  }

  /**
   * Guard capture/refund/void with store + atomic reserve() + key.
   * Paymob has no native mutation idempotency — unguarded POSTs are a
   * double-refund class. Create/get/webhook stay on {@link executeIdempotent}
   * (create may run unkeyed).
   */
  private async runIdempotentMutation<R>(
    operation: "capturePayment" | "refundPayment" | "voidPayment",
    idempotencyKey: string | undefined,
    params: unknown,
    executor: () => Promise<R>,
  ): Promise<R> {
    const store = this.paymobConfig.idempotencyStore;
    if (!store) {
      throw new InvalidRequestError(
        `Paymob ${operation} requires paymob.idempotencyStore and idempotencyKey. ` +
          "Capture, refund, and void have no native Paymob idempotency; unguarded " +
          "retries or multi-worker races can double-apply the mutation. Configure " +
          "idempotencyStore (with atomic reserve()) and pass idempotencyKey.",
        [{ path: ["idempotencyKey"] }],
      );
    }
    if (!idempotencyKey) {
      throw new InvalidRequestError(
        `Paymob ${operation} requires idempotencyKey when idempotencyStore is configured. ` +
          "Pass a stable idempotencyKey so caller retries are deduped.",
        [{ path: ["idempotencyKey"] }],
      );
    }
    if (!store.reserve) {
      throw new InvalidRequestError(
        `Paymob ${operation} requires idempotencyStore.reserve() for atomic ` +
          "reservation (e.g. Redis SET NX or SQL unique constraint). Non-atomic " +
          "get-then-set stores can double-apply refund/capture/void under concurrency.",
        [{ path: ["idempotencyStore"] }],
      );
    }

    return this.executeIdempotent(operation, idempotencyKey, params, executor);
  }

  private async executeIdempotent<R>(
    operation: string,
    idempotencyKey: string | undefined,
    params: unknown,
    executor: () => Promise<R>,
  ): Promise<R> {
    if (!idempotencyKey) {
      return executor();
    }

    const cacheKey = `${operation}:${idempotencyKey}`;
    const fingerprint = this.fingerprintParams(params);
    const existing = this.idempotencyCache.get(cacheKey) as PaymobIdempotencyCacheEntry<R> | undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new InvalidRequestError(
          `Paymob ${operation} idempotencyKey was reused with different parameters`,
          [{ path: ["idempotencyKey"] }],
        );
      }
      if (existing.status === "unknown") {
        throw this.idempotencyOutcomeUnknownError(operation);
      }
      if (existing.promise) {
        return existing.promise;
      }
    }

    const nowMs = this.clock.nowMs();
    const inProgressRecord = {
      fingerprint,
      status: "in_progress" as const,
      createdAt: nowMs,
      expiresAt: nowMs + IDEMPOTENCY_CACHE_TTL_MS,
    };

    // PAYMOB-3 / NEW-PAYMOB-TTL: never FIFO-evict in-flight, unknown, or
    // completed mutation fences (Paymob has no native idempotency). If the map
    // is full, refuse the new key fail-closed rather than re-enter an old key.
    if (!this.idempotencyCache.has(cacheKey)) {
      this.ensureIdempotencyCacheCapacity(operation);
    }

    let reservedStoredRecord = false;
    let keepLocalUnknownRecord = false;
    const cacheEntry: PaymobIdempotencyCacheEntry<R> = {
      fingerprint,
      createdAt: nowMs,
      status: "in_progress",
    };
    const promise = (async () => {
      const storedRecord = await this.reserveStoredIdempotencyRecord(
        cacheKey,
        inProgressRecord,
        operation,
      );
      if (storedRecord) {
        if (storedRecord.fingerprint !== fingerprint) {
          throw new InvalidRequestError(
            `Paymob ${operation} idempotencyKey was reused with different parameters`,
            [{ path: ["idempotencyKey"] }],
          );
        }

        if (storedRecord.status === "completed" && "result" in storedRecord) {
          return storedRecord.result as R;
        }

        if (storedRecord.status === "unknown") {
          keepLocalUnknownRecord = true;
          this.idempotencyCache.set(cacheKey, {
            fingerprint,
            status: "unknown",
            createdAt: storedRecord.createdAt,
          });
          throw this.idempotencyOutcomeUnknownError(operation);
        }

        throw new InvalidRequestError(
          `Paymob ${operation} idempotencyKey is already in progress`,
          [{ path: ["idempotencyKey"] }],
        );
      }

      reservedStoredRecord = true;
      return executor();
    })().then(async (result) => {
      cacheEntry.status = "completed";
      const completedAt = this.clock.nowMs();
      await this.trySetStoredIdempotencyRecord(cacheKey, {
        fingerprint,
        status: "completed",
        createdAt: completedAt,
        expiresAt: completedAt + IDEMPOTENCY_CACHE_TTL_MS,
        result,
      }, operation);
      return result;
    }).catch(async (error) => {
      // Network/5xx/408/409/425/429/caller-abort after POST and HTTP-200 body
      // validation failures all fence: Paymob may have applied the money op
      // (PAYMOB-1, NEW-PAYMOB-2, NEW-PAYMOB-4XX). RateLimitError after mapError
      // must not clear the key.
      if (shouldRetainPaymobMutationFence(error)) {
        const unknownAt = this.clock.nowMs();
        this.idempotencyCache.set(cacheKey, {
          fingerprint,
          status: "unknown",
          createdAt: unknownAt,
        });
        await this.trySetStoredIdempotencyRecord(cacheKey, {
          fingerprint,
          status: "unknown",
          createdAt: unknownAt,
          expiresAt: unknownAt + IDEMPOTENCY_CACHE_TTL_MS,
        }, operation);
        throw error;
      }

      if (keepLocalUnknownRecord) {
        throw error;
      }

      this.idempotencyCache.delete(cacheKey);
      if (reservedStoredRecord) {
        await this.tryDeleteStoredIdempotencyRecord(cacheKey, operation);
      }
      throw error;
    });
    cacheEntry.promise = promise;
    this.idempotencyCache.set(cacheKey, cacheEntry);
    return promise;
  }

  /**
   * Free one slot when the in-memory map is at capacity.
   * In-progress, unknown, and completed mutation fences are all retained —
   * evicting a completed refund/capture/void key would allow same-key re-apply
   * (Paymob has no native idempotency). Refuse new keys when full.
   */
  private ensureIdempotencyCacheCapacity(operation: string): void {
    if (this.idempotencyCache.size < IDEMPOTENCY_CACHE_LIMIT) {
      return;
    }

    throw new InvalidRequestError(
      `Paymob ${operation} idempotency cache is full of in-flight, unknown, or completed mutation fences; configure a durable idempotencyStore or retry after existing mutations settle`,
      [{ path: ["idempotencyKey"] }],
    );
  }

  private async reserveStoredIdempotencyRecord(
    key: string,
    record: {
      fingerprint: string;
      status: "in_progress";
      createdAt: number;
      expiresAt: number;
    },
    operation: string,
  ) {
    const store = this.paymobConfig.idempotencyStore;
    if (!store) {
      return undefined;
    }

    // PAYMOB-TOCTOU: never fall through to get-then-set. Concurrent workers
    // can both observe a free key and double-apply (Moyasar parity).
    if (!store.reserve) {
      throw new InvalidRequestError(
        `Paymob ${operation} requires idempotencyStore.reserve() for atomic ` +
          "reservation (e.g. Redis SET NX or SQL unique constraint). Non-atomic " +
          "get-then-set stores can double-apply refund/capture/void under concurrency.",
        [{ path: ["idempotencyStore"] }],
      );
    }

    const existing = await store.reserve(key, record);
    if (!existing) {
      return undefined;
    }

    // NEW-PAYMOB-TTL: completed / unknown / in_progress are never a free key.
    // Do not delete+re-reserve — Paymob has no native idempotency.
    return this.retainStoredIdempotencyFence(existing);
  }

  /**
   * Expired in_progress is an unknown mutation outcome (worker may have died
   * after POST). Refuse retry; do not treat the key as free.
   */
  private retainStoredIdempotencyFence<
    T extends {
      status?: "in_progress" | "completed" | "unknown";
      expiresAt?: number;
    },
  >(record: T): T {
    if (
      record.status === "in_progress" &&
      typeof record.expiresAt === "number" &&
      record.expiresAt <= this.clock.nowMs()
    ) {
      return { ...record, status: "unknown" };
    }
    return record;
  }

  private async setStoredIdempotencyRecord(
    key: string,
    record: {
      fingerprint: string;
      status: "in_progress" | "completed" | "unknown";
      createdAt: number;
      expiresAt: number;
      result?: unknown;
    },
  ): Promise<void> {
    await this.paymobConfig.idempotencyStore?.set(key, record);
  }

  private async deleteStoredIdempotencyRecord(key: string): Promise<void> {
    await this.paymobConfig.idempotencyStore?.delete(key);
  }

  private async trySetStoredIdempotencyRecord(
    key: string,
    record: {
      fingerprint: string;
      status: "in_progress" | "completed" | "unknown";
      createdAt: number;
      expiresAt: number;
      result?: unknown;
    },
    operation: string,
  ): Promise<void> {
    try {
      await this.setStoredIdempotencyRecord(key, record);
    } catch (error) {
      this.logger.warn(
        `[Paymob] Failed to persist ${operation} idempotency record; keeping in-memory protection only.`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async tryDeleteStoredIdempotencyRecord(
    key: string,
    operation: string,
  ): Promise<void> {
    try {
      await this.deleteStoredIdempotencyRecord(key);
    } catch (error) {
      this.logger.warn(
        `[Paymob] Failed to delete ${operation} idempotency record after a preflight failure.`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private fingerprintParams(value: unknown): string {
    return sharedFingerprintParams(this.omitAbortSignalsForFingerprint(value));
  }

  private idempotencyOutcomeUnknownError(operation: string): InvalidRequestError {
    return new InvalidRequestError(
      `Paymob ${operation} idempotencyKey has an unknown gateway outcome after a network failure. Reconcile the Paymob transaction or callback before retrying this mutation.`,
      [{ path: ["idempotencyKey"] }],
    );
  }

  /**
   * Drop AbortSignal values before the shared Date-aware fingerprint so caller
   * signals are not part of the business-params identity (NEW-PAYMOB-FP).
   */
  private omitAbortSignalsForFingerprint(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.omitAbortSignalsForFingerprint(item));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      const nested = record[key];
      if (typeof AbortSignal !== "undefined" && nested instanceof AbortSignal) {
        continue;
      }
      cleaned[key] = this.omitAbortSignalsForFingerprint(nested);
    }
    return cleaned;
  }

  private requireString(value: unknown, message: string, raw: unknown): string {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }

    throw new GatewayApiError(message, "paymob", raw);
  }

  private requireNumber(value: unknown, message: string, raw: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    throw new GatewayApiError(message, "paymob", raw);
  }

  private requireBoolean(value: unknown, message: string, raw: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    throw new GatewayApiError(message, "paymob", raw);
  }

  /**
   * Require a boolean from a money-mutation response after HTTP 200.
   * Coerces string `"true"`/`"false"` (common on some Paymob edges).
   * Missing/invalid values are **indeterminate** — the mutation may already
   * have applied; callers must retain the idempotency fence (PAYMOB-1).
   */
  private requireMutationBoolean(
    value: unknown,
    message: string,
    raw: unknown,
    operation: string,
  ): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    const coerced = this.parseBoolean(value);
    if (coerced !== undefined) {
      return coerced;
    }
    throw new PaymobIndeterminateResponseError(operation, message, raw);
  }

  /**
   * Require a non-empty string from a mutating HTTP 200 body (Intention id /
   * checkout URL / legacy payment token). Missing values are indeterminate —
   * Paymob may have created a payable session; callers must retain the
   * idempotency fence (PAYMOB-2 / PAYMOB-FENCE-3).
   */
  private requireMutationString(
    value: unknown,
    message: string,
    raw: unknown,
    operation: string,
  ): string {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    throw new PaymobIndeterminateResponseError(operation, message, raw);
  }

  /**
   * Require a finite number from a mutating HTTP 200 body (legacy order id).
   * Missing/invalid values are indeterminate — the order POST may already
   * have applied; callers must retain the idempotency fence (PAYMOB-FENCE-3).
   */
  private requireMutationNumber(
    value: unknown,
    message: string,
    raw: unknown,
    operation: string,
  ): number {
    const parsed = this.parseNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
    throw new PaymobIndeterminateResponseError(operation, message, raw);
  }

  /**
   * Inbox / dedupe identity for Paymob notifications.
   * Redirect `TRANSACTION_RESPONSE` and processed `TRANSACTION` share Paymob's
   * txn id. Qualify redirect `event.id` so the documented inbox key cannot
   * ACK-suppress the later paid processed callback (WEBHOOKS-1).
   * `gatewayPaymentId` stays the raw signed txn id.
   */
  private paymobWebhookEventId(
    providerTxnId: string,
    notification: "TRANSACTION" | "TRANSACTION_RESPONSE",
  ): string {
    return notification === "TRANSACTION_RESPONSE"
      ? `${providerTxnId}:redirect`
      : providerTxnId;
  }

  /**
   * Redirect callbacks are browser-replayable GETs. Terminal charge / refund
   * domain statuses must not appear on the envelope (S19-PAYMOB-REDIR-STATUS,
   * S20-PAYMOB-REDIR-TERM). In-flight `pending` / `processing` stay as mapped.
   */
  private redirectEnvelopeStatus(mapped: PaymentStatus): PaymentStatus {
    if (mapped === "pending" || mapped === "processing") {
      return mapped;
    }
    return "processing";
  }

  private recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private asRedirectWebhookPayload(value: unknown): PaymobRedirectWebhookPayload | undefined {
    const record = this.recordFromUnknown(value);
    if (!record || record.obj) return undefined;

    const id = record.id;
    const amountCents = record.amount_cents;
    const currency = record.currency;
    const pending = record.pending;
    const success = record.success;

    if (
      (typeof id !== "string" && typeof id !== "number") ||
      (typeof amountCents !== "string" && typeof amountCents !== "number") ||
      typeof currency !== "string" ||
      (typeof pending !== "string" && typeof pending !== "boolean") ||
      (typeof success !== "string" && typeof success !== "boolean")
    ) {
      return undefined;
    }

    return record as PaymobRedirectWebhookPayload;
  }

  private recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
    if (value instanceof URLSearchParams) {
      return Object.fromEntries(value.entries());
    }

    return this.recordOrUndefined(value);
  }

  private readHmacField(obj: Record<string, unknown>, field: typeof HMAC_FIELDS[number]): string {
    if (field === "is_refunded") {
      return this.hmacValue(obj.is_refunded ?? obj.is_refund);
    }
    if (field === "is_voided") {
      return this.hmacValue(obj.is_voided ?? obj.is_void);
    }
    if (field === "order.id") {
      const order = this.recordOrUndefined(obj.order);
      // Redirect callbacks may send order.id, nested order.id, flat order, or order_id.
      return this.hmacValue(
        obj["order.id"] ?? order?.id ?? obj.order_id ?? obj.order,
      );
    }
    if (field === "source_data.pan") {
      const sourceData = this.recordOrUndefined(obj.source_data);
      return this.hmacValue(obj["source_data.pan"] ?? obj.source_data_pan ?? sourceData?.pan);
    }
    if (field === "source_data.sub_type") {
      const sourceData = this.recordOrUndefined(obj.source_data);
      return this.hmacValue(
        obj["source_data.sub_type"] ?? obj.source_data_sub_type ?? sourceData?.sub_type,
      );
    }
    if (field === "source_data.type") {
      const sourceData = this.recordOrUndefined(obj.source_data);
      return this.hmacValue(obj["source_data.type"] ?? obj.source_data_type ?? sourceData?.type);
    }

    return this.hmacValue(obj[field]);
  }

  private hmacValue(value: unknown): string {
    return value === undefined || value === null ? "" : String(value);
  }

  private normalizeApiTransactionResponse(
    data: unknown,
    operation: string,
  ): PaymobTransactionResponse {
    const response = this.recordOrUndefined(data);
    const source = this.recordOrUndefined(response?.obj) ?? response;
    if (!source) {
      throw new GatewayApiError(
        `Paymob ${operation} response is missing transaction data`,
        "paymob",
        data,
      );
    }

    const transaction: PaymobTransactionResponse = {};
    this.assignOptionalNumber(transaction, "id", source.id);
    this.assignOptionalBoolean(transaction, "success", source.success);
    this.assignOptionalBoolean(transaction, "pending", source.pending);
    this.assignOptionalNumber(transaction, "amount_cents", source.amount_cents);
    this.assignOptionalNumber(transaction, "refunded_amount_cents", source.refunded_amount_cents);
    this.assignOptionalNumber(transaction, "captured_amount", source.captured_amount);
    this.assignOptionalBoolean(transaction, "is_void", source.is_void);
    this.assignOptionalBoolean(transaction, "is_refund", source.is_refund);
    this.assignOptionalBoolean(transaction, "is_voided", source.is_voided);
    this.assignOptionalBoolean(transaction, "is_refunded", source.is_refunded);
    this.assignOptionalBoolean(transaction, "is_auth", source.is_auth);
    this.assignOptionalBoolean(transaction, "is_capture", source.is_capture);
    this.assignOptionalBoolean(transaction, "is_captured", source.is_captured);
    this.assignOptionalBoolean(transaction, "has_parent_transaction", source.has_parent_transaction);
    this.assignOptionalBoolean(transaction, "error_occured", source.error_occured);

    const currency = this.stringOrUndefined(source.currency);
    if (currency) {
      transaction.currency = currency;
    }
    const message = this.stringOrUndefined(source.message) ??
      this.stringOrUndefined(source.data_message);
    if (message) {
      transaction.message = message;
    }

    // S19-PAYMOB-JSON: `{}` / HTML-parsed-as-empty must not fall through
    // mapTransactionStatus → failed → declined. Require a transaction signal.
    const hasTransactionSignal =
      transaction.id !== undefined ||
      transaction.success !== undefined ||
      transaction.pending !== undefined ||
      transaction.amount_cents !== undefined ||
      transaction.captured_amount !== undefined ||
      transaction.refunded_amount_cents !== undefined ||
      transaction.is_void !== undefined ||
      transaction.is_refund !== undefined ||
      transaction.is_voided !== undefined ||
      transaction.is_refunded !== undefined ||
      transaction.is_auth !== undefined ||
      transaction.is_capture !== undefined ||
      transaction.is_captured !== undefined;

    if (!hasTransactionSignal) {
      throw new GatewayApiError(
        `Paymob ${operation} response is missing transaction data`,
        "paymob",
        data,
      );
    }

    return transaction;
  }

  private normalizeTransactionWebhook(payload: unknown): PaymobNormalizedTransactionWebhook | undefined {
    const raw = this.recordOrUndefined(payload);
    const rawObj = this.recordOrUndefined(raw?.obj);
    if (!rawObj) {
      return undefined;
    }

    const id = this.parseNumber(rawObj.id);
    const amountCents = this.parseNumber(rawObj.amount_cents);
    const pending = this.parseBoolean(rawObj.pending);
    const success = this.parseBoolean(rawObj.success);
    const currency = this.stringOrUndefined(rawObj.currency);

    if (
      id === undefined ||
      amountCents === undefined ||
      pending === undefined ||
      success === undefined ||
      !currency
    ) {
      return undefined;
    }

    const obj: PaymobNormalizedTransactionWebhook["obj"] = {
      id,
      amount_cents: amountCents,
      currency,
      pending,
      success,
    };
    this.assignOptionalString(obj, "created_at", rawObj.created_at);
    this.assignOptionalString(obj, "message", rawObj.message);
    this.assignOptionalBoolean(obj, "is_void", rawObj.is_void);
    this.assignOptionalBoolean(obj, "is_refund", rawObj.is_refund);
    this.assignOptionalBoolean(obj, "is_voided", rawObj.is_voided);
    this.assignOptionalBoolean(obj, "is_refunded", rawObj.is_refunded);
    this.assignOptionalNumber(obj, "refunded_amount_cents", rawObj.refunded_amount_cents);
    this.assignOptionalNumber(obj, "captured_amount", rawObj.captured_amount);
    this.assignOptionalBoolean(obj, "is_auth", rawObj.is_auth);
    this.assignOptionalBoolean(obj, "is_capture", rawObj.is_capture);
    this.assignOptionalBoolean(obj, "is_captured", rawObj.is_captured);
    this.assignOptionalBoolean(obj, "has_parent_transaction", rawObj.has_parent_transaction);
    this.assignOptionalBoolean(obj, "error_occured", rawObj.error_occured);

    return {
      // Missing type must not default to TRANSACTION — that invents fulfillment
      // (payment.succeeded) via flag/status mapping. Empty type maps unmapped.
      type: this.stringOrUndefined(raw?.type) ?? "",
      rawObj,
      obj,
    };
  }

  private isTransactionWebhook(payload: unknown): payload is PaymobWebhookPayload {
    return Boolean(this.normalizeTransactionWebhook(payload));
  }

  private isCardTokenWebhook(payload: unknown): payload is PaymobCardTokenWebhookPayload {
    const raw = this.recordOrUndefined(payload);
    const obj = this.recordOrUndefined(raw?.obj);
    if (!obj) {
      return false;
    }

    // Coerce string digits for id/merchant_id like the transaction webhook path (parseNumber).
    const id = this.parseNumber(obj.id);
    const merchantId = this.parseNumber(obj.merchant_id);

    return (
      id !== undefined &&
      merchantId !== undefined &&
      typeof obj.token === "string" &&
      typeof obj.masked_pan === "string" &&
      typeof obj.card_subtype === "string"
    );
  }

  private safeCompareHex(actual: unknown, expected: string): boolean {
    if (typeof actual !== "string") {
      return false;
    }

    const actualHex = actual.trim().toLowerCase();
    const expectedHex = expected.trim().toLowerCase();

    if (!/^[a-f0-9]+$/.test(actualHex) || actualHex.length !== expectedHex.length) {
      return false;
    }

    return timingSafeEqualHex(actualHex, expectedHex);
  }

  private buildUnifiedCheckoutUrl(clientSecret: string): string {
    const checkoutUrl = new URL(`${this.baseUrl}/unifiedcheckout/`);
    checkoutUrl.searchParams.set("publicKey", this.paymobConfig.publicKey ?? "");
    checkoutUrl.searchParams.set("clientSecret", clientSecret);
    return checkoutUrl.toString();
  }

  /**
   * Resolve base URL from config
   */
  private resolveBaseUrl(config: PaymobConfig): string {
    // Explicit override takes precedence
    if (config.baseUrl) {
      return config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    }

    // Use region (default to KSA base URL)
    const region = config.region ?? "ksa";
    return PAYMOB_BASE_URLS[region];
  }

  /**
   * Normalize URL to ensure it has a path component.
   * Paymob adds a trailing slash before query params if no path exists,
   * which can cause 404s on some frontends.
   *
   * @example
   * - `https://domain.com?no=123` → `https://domain.com/?no=123`
   * - `https://domain.com/page?no=123` → unchanged
   */
  private normalizeRedirectUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;

    try {
      const parsed = new URL(url);
      // If pathname is empty or just "/", and there are query params,
      // ensure we have an explicit "/" to prevent Paymob normalization issues
      if (parsed.pathname === "" || parsed.pathname === "/") {
        parsed.pathname = "/";
      }
      return parsed.toString();
    } catch {
      // If URL parsing fails, return as-is
      return url;
    }
  }
}
