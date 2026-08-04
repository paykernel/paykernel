// file: packages/payments/src/gateways/moyasar.gateway.ts

import { BaseGateway } from "../base.gateway";
import type { GatewayRuntimeDeps } from "../../runtime/payment-runtime";
import {
  combineAbortSignals,
  createTimeoutSignal,
  extractAbortSignal,
  mapHttpAbortError,
} from "../../runtime/abort";
import {
  timingSafeEqualBytes,
  utf8Encode,
  utf8ToBase64,
} from "../../runtime/crypto-portable";
import type {
  AmountInput,
  CaptureParams,
  CreatePaymentParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  MoyasarConfirmStcPayOtpParams,
  MoyasarCreatePaymentParams,
  PaymentNextAction,
  PaymentStatus,
  RefundParams,
  VoidParams,
} from "../../types/payment.types";
import {
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  type PaymentOperationOutcome,
  type RefundOperationOutcome,
} from "../../types/operation-result";
import type {
  MoyasarWebhookPayload,
  WebhookEvent,
} from "../../types/webhook.types";
import { attachPaymentEvent } from "../../types/payment-event";
import type { MoyasarConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import type { MoyasarPaymentSource } from "../../types/moyasar-source.types";
import {
  MoyasarCreatePaymentParamsSchema,
  MoyasarCaptureParamsSchema,
  MoyasarRefundParamsSchema,
  MoyasarVoidParamsSchema,
  MoyasarGetPaymentParamsSchema,
} from "../../types/validation";
import {
  GatewayApiError,
  AuthenticationError,
  CardDeclinedError,
  RateLimitError,
  InvalidRequestError,
  NetworkError,
  InvalidWebhookError,
  ResourceNotFoundError,
} from "../../errors";
import {
  withRetry,
  parseRetryAfterSeconds,
  extractRetryAfterSeconds,
} from "../../utils/retry";
import { MOYASAR_CAPABILITIES } from "../builtin-capabilities";
import {
  type IdempotencyStore,
  fingerprintParams,
} from "../../utils/idempotency";
import type { Logger } from "../../utils/logger";
import {
  fromMinorUnits as sharedFromMinorUnits,
  MoneyAmountError,
  minorAmountToNumber,
  moneyToMajorNumber,
  normalizeAmountInput,
  toMinorUnits as sharedToMinorUnits,
} from "../../utils/money";

/**
 * Classify transient Moyasar transport/API failures (network, 5xx, 429).
 *
 * Used for:
 * - `createPayment` / `getPayment` `withRetry` predicates (safe GET always;
 *   create only when `given_id`/idempotencyKey is present).
 * - `runIdempotentMutation`: after capture/refund/void fails, decide whether to
 *   mark the store key `unknown` (indeterminate) vs clear it (definite 4xx).
 *
 * Capture/refund/void themselves are **not** auto-retried by `withRetry`.
 * Moyasar has no native mutation idempotency; a lost response after a successful
 * void/refund could double-apply if the SDK retried. Configure
 * `idempotencyStore` + pass `idempotencyKey` so **callers** can safely retry
 * after definite failures (or resolve `unknown` via `getPayment` first).
 */
function isMoyasarRetryableError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof GatewayApiError) {
    const status = (error.rawError as { status?: number } | undefined)?.status;
    return typeof status === "number" && (status >= 500 || status === 429);
  }
  return false;
}

const NEVER_RETRY = () => false;

// ═══════════════════════════════════════════════════════════════════════════════
// Moyasar API Types (matching official OpenAPI spec)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Moyasar payment status values from official API
 * @see https://docs.moyasar.com/api/payments/08-payment-status-reference
 */
type MoyasarPaymentStatus =
  | "initiated"
  | "paid"
  | "authorized"
  | "failed"
  | "abandoned"
  | "refunded"
  | "captured"
  | "voided"
  | "verified";

/**
 * Moyasar card company/scheme
 */
type MoyasarCardCompany = "mada" | "visa" | "master" | "amex";

/**
 * Moyasar payment source type
 */
type MoyasarSourceType =
  | "creditcard"
  | "applepay"
  | "samsungpay"
  | "stcpay"
  | "token";

const DEFAULT_TIMEOUT_MS = 30_000;
const MOYASAR_MAX_METADATA_VALUE_LENGTH = 500;

/**
 * Full Moyasar payment response matching official OpenAPI spec
 */
interface MoyasarPaymentResponse {
  /** Payment ID (UUID) */
  id: string;
  /** Payment status */
  status: MoyasarPaymentStatus;
  /** Amount in smallest currency unit (halalas/fils) */
  amount: number;
  /** Fee charged by Moyasar (in smallest unit, includes VAT) */
  fee: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Amount refunded so far (in smallest unit) */
  refunded: number;
  /** Amount captured so far (in smallest unit) */
  captured: number;
  /** Formatted amount with currency (e.g., "100 SAR") */
  amount_format: string;
  /** Formatted fee */
  fee_format: string;
  /** Formatted refunded amount */
  refunded_format: string;
  /** Formatted captured amount */
  captured_format: string;
  /** Customer IP address */
  ip: string | null;
  /** Payment creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Refund timestamp (null if not refunded) */
  refunded_at: string | null;
  /** Capture timestamp (null if not captured) */
  captured_at: string | null;
  /** Void timestamp (null if not voided) */
  voided_at: string | null;
  /** Payment description */
  description: string | null;
  /** Associated invoice ID */
  invoice_id: string | null;
  /** Callback URL for redirects */
  callback_url: string | null;
  /** User-provided metadata */
  metadata: Record<string, unknown>;
  /** Payment source details */
  source: {
    /** Source type */
    type: MoyasarSourceType;
    /** Card scheme (for card payments) */
    company?: MoyasarCardCompany;
    /** Cardholder name */
    name?: string | null;
    /** Masked card number */
    number?: string;
    /** Gateway reference ID */
    gateway_id?: string;
    /** Token for future payments */
    token?: string | null;
    /** Response message from processor */
    message?: string | null;
    /** 3DS challenge URL (for initiated payments) */
    transaction_url?: string | null;
    /** Retrieval Reference Number (RRN) */
    reference_number?: string | null;
    /** Authorization response code */
    response_code?: string | null;
    /** Authorization code from issuer */
    authorization_code?: string | null;
  };
}

/**
 * Moyasar API error response
 */
interface MoyasarErrorResponse {
  /** Error type category */
  type:
  | "invalid_request"
  | "invalid_request_error"
  | "authentication_error"
  | "authorization_error"
  | "rate_limit_error"
  | "api_connection_error"
  | "account_inactive_error"
  | "api_error"
  | "record_not_found"
  | "3ds_auth_error";
  /** Error message */
  message: string;
  /** Detailed validation errors (field -> messages) */
  errors?: Record<string, string[]>;
}

/**
 * Moyasar payment gateway implementation
 * @see https://docs.moyasar.com/api/api-introduction
 */
export class MoyasarGateway extends BaseGateway {
  readonly name = "moyasar" as const;

  private readonly baseUrl = "https://api.moyasar.com/v1";
  private readonly moyasarConfig: MoyasarConfig;

  constructor(
    config: MoyasarConfig,
    hooks: HooksManager,
    logger?: Logger,
    runtime?: GatewayRuntimeDeps,
  ) {
    super(config, hooks, logger, MOYASAR_CAPABILITIES, runtime);
    this.moyasarConfig = config;
    this.warnIfIdempotencyStoreUnsafe();
  }

  /**
   * Moyasar's refund/capture/void endpoints have no native idempotency, so the
   * SDK guards them with the injectable store. That guard is only race-safe with
   * an atomic `reserve()` (Redis `SET NX`, a SQL unique constraint, etc.).
   * A store without `reserve()` falls back to a non-atomic get-then-set, which
   * two concurrent retries of the same mutation can both pass — risking a double
   * refund. Warn loudly so this isn't relied on for cross-worker safety.
   *
   * With no store at all, capture/refund/void are completely unguarded — a
   * multi-worker production deployment will double-apply on retry.
   */
  private warnIfIdempotencyStoreUnsafe(): void {
    const store = this.moyasarConfig.idempotencyStore;
    if (!store) {
      this.logger.warn(
        "[Moyasar] No idempotencyStore configured. Capture, refund, and void " +
          "have no native Moyasar idempotency; network retries or multi-worker " +
          "races can apply the same mutation twice (e.g. double refund). " +
          "Configure moyasar.idempotencyStore (preferably with atomic reserve()) " +
          "for production multi-worker safety.",
      );
      return;
    }
    if (!store.reserve) {
      this.logger.warn(
        "[Moyasar] idempotencyStore does not implement atomic reserve(). " +
          "Concurrent retries of the same refund/capture/void can race and apply " +
          "the mutation twice. Provide a store with an atomic reserve() " +
          "(e.g. Redis SET NX or a SQL unique constraint) for cross-worker safety.",
      );
    }
  }

  /**
   * Guard a non-idempotent mutation (refund/capture/void) with an injectable
   * dedupe store, keyed by idempotencyKey + operation + paymentId. Moyasar has
   * no native idempotency for these endpoints, so this prevents a **caller**
   * retry from applying the mutation twice (e.g. a double refund).
   *
   * This does **not** wrap the HTTP call in `withRetry`. Auto-retry after a
   * network blip is unsafe: the first request may already have succeeded on
   * Moyasar. The store only enables safe **caller** retries (and caches
   * completed results).
   *
   * Behavior:
   * - No idempotencyKey or no store configured: runs once, unguarded.
   * - Already completed for this key: returns the cached result (no API call).
   * - In progress / outcome unknown for this key: refuses, instead of risking
   *   a duplicate mutation.
   * - Definite failure (4xx, validation): clears the reservation so the caller
   *   can safely retry. Transient/indeterminate failures (network, 5xx) keep an
   *   "unknown" marker so the operation is never silently re-applied — resolve
   *   via `getPayment` before retrying with the same key.
   */
  private async runIdempotentMutation<R>(
    operation: "capturePayment" | "refundPayment" | "voidPayment",
    paymentId: string,
    idempotencyKey: string | undefined,
    fingerprintInput: unknown,
    executor: () => Promise<R>,
  ): Promise<R> {
    const store: IdempotencyStore | undefined = this.moyasarConfig.idempotencyStore;
    if (!store) {
      if (idempotencyKey) {
        this.logger.warn(
          `[Moyasar] ${operation} was called with idempotencyKey but no ` +
            "idempotencyStore is configured; the key is ignored and the mutation " +
            "runs unguarded. Configure moyasar.idempotencyStore to protect " +
            "capture/refund/void across retries and workers.",
        );
      }
      return executor();
    }
    if (!idempotencyKey) {
      return executor();
    }

    const key = `moyasar:${operation}:${paymentId}:${idempotencyKey}`;
    const fingerprint = fingerprintParams(fingerprintInput);
    const createdAt = Date.now();

    const existing = store.reserve
      ? await store.reserve(key, { status: "in_progress", fingerprint, createdAt })
      : await this.reserveWithoutAtomicSupport(store, key, fingerprint, createdAt);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new InvalidRequestError(
          `Moyasar ${operation} idempotencyKey was reused with different parameters`,
          [{ path: ["idempotencyKey"] }],
        );
      }
      if (existing.status === "completed") {
        return existing.result as R;
      }
      throw new InvalidRequestError(
        `Moyasar ${operation} with this idempotencyKey is already in progress or its outcome is unknown; resolve it before retrying`,
        [{ path: ["idempotencyKey"] }],
      );
    }

    try {
      const result = await executor();
      // The mutation already succeeded; a failure to persist the record must
      // not turn a successful refund into an error (which could trigger a
      // double-refund on retry). Best-effort persist, then return.
      await this.safeStoreWrite(operation, () =>
        store.set(key, {
          status: "completed",
          fingerprint,
          createdAt: Date.now(),
          result,
        }),
      );
      return result;
    } catch (error) {
      if (isMoyasarRetryableError(error)) {
        // Outcome is indeterminate: the request may have mutated server-side.
        // Keep a marker so a later retry refuses rather than double-applying.
        await this.safeStoreWrite(operation, () =>
          store.set(key, { status: "unknown", fingerprint, createdAt: Date.now() }),
        );
      } else {
        // Definite failure: clear the reservation so a retry is allowed.
        await this.safeStoreWrite(operation, () => store.delete(key));
      }
      throw error;
    }
  }

  /** Run a best-effort idempotency-store write, never throwing on failure. */
  private async safeStoreWrite(
    operation: string,
    write: () => Promise<void> | void,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.logger.warn(
        `[Moyasar] Failed to persist ${operation} idempotency record; protection for this key may be reduced.`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async reserveWithoutAtomicSupport(
    store: IdempotencyStore,
    key: string,
    fingerprint: string,
    createdAt: number,
  ) {
    const existing = await store.get(key);
    if (existing) {
      return existing;
    }
    await store.set(key, { status: "in_progress", fingerprint, createdAt });
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payment Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a payment using Moyasar's Payment API.
   * Supports: creditcard, token, applepay, samsungpay, stcpay.
   * @see https://docs.moyasar.com/api/payments/01-create-payment
   * @note `success: true` only means the payment is not mapped to `failed`
   *   (provider `failed`/`abandoned`, or an unmapped status). An `initiated`
   *   payment maps to `success: true` with `status: 'pending'`. Always check
   *   `status` (and complete 3DS/OTP) before fulfillment — fulfill only on
   *   `paid` (or `authorized` for auth-only holds).
   */
  async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult>;
  async createPayment(params: MoyasarCreatePaymentParams): Promise<GatewayPaymentResult>;
  async createPayment(
    params: CreatePaymentParams | MoyasarCreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      // Build source payload from moyasarSource or legacy tokenId
      const sourcePayload = this.buildSourcePayload(p);
      const requiresCallback =
        sourcePayload.type === "creditcard" || sourcePayload.type === "token";

      if (requiresCallback && !p.callbackUrl) {
        throw new InvalidRequestError(
          "callbackUrl is required for Moyasar creditcard and token payments",
        );
      }

      const metadata = this.buildPaymentMetadata(p);
      const currency = p.currency.toUpperCase();
      const requestBody: Record<string, unknown> = {
        amount: this.toMinorUnits(p.amount, currency),
        currency,
        description: p.description ?? "Payment",
        source: sourcePayload,
      };

      if (metadata !== undefined) {
        requestBody.metadata = metadata;
      }

      if (p.callbackUrl) {
        requestBody.callback_url = p.callbackUrl;
      }

      // Add idempotency key (becomes the payment ID)
      if (p.idempotencyKey) {
        requestBody.given_id = p.idempotencyKey;
      }

      // Add coupon flag if specified
      if (p.applyCoupon !== undefined) {
        requestBody.apply_coupon = p.applyCoupon;
      }

      // Split amounts are major units in the public API; Moyasar expects minor ints.
      if ("splits" in p && p.splits !== undefined) {
        requestBody.splits = p.splits.map((split) => ({
          ...split,
          amount: this.toMinorUnits(split.amount, currency, {
            allowNonPositive: true,
          }),
        }));
      }

      if ("recipient" in p && p.recipient !== undefined) {
        requestBody.recipient = p.recipient;
      }

      if ("sender" in p && p.sender !== undefined) {
        requestBody.sender = p.sender;
      }

      // Only retry create on transient errors when given_id (idempotencyKey)
      // is present, so Moyasar deduplicates a re-sent request.
      const createInit: RequestInit = {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      };
      const createSignal = extractAbortSignal(p);
      if (createSignal) {
        createInit.signal = createSignal;
      }

      const data = (await withRetry(
        () =>
          this.requestJson(
            "/payments",
            createInit,
            "Failed to create payment",
          ),
        { isRetryable: p.idempotencyKey ? isMoyasarRetryableError : NEVER_RETRY },
      )) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      const payment = data as MoyasarPaymentResponse;
      return this.mapPaymentResponse(payment);
    }, MoyasarCreatePaymentParamsSchema);
  }

  /**
   * Build the source payload for Moyasar API from our typed source or legacy tokenId
   */
  private buildSourcePayload(
    params: MoyasarCreatePaymentParams | CreatePaymentParams,
  ): Record<string, unknown> {
    // Prefer new moyasarSource if provided
    if (params.moyasarSource) {
      return this.mapMoyasarSource(params.moyasarSource, params.capture);
    }

    // Fallback to legacy tokenId
    if (params.tokenId) {
      if (!params.tokenId.startsWith("token_")) {
        throw new InvalidRequestError(
          "Moyasar tokenId must start with token_",
        );
      }

      const sourcePayload: Record<string, unknown> = {
        type: "token",
        token: params.tokenId,
      };

      if (params.capture === false) {
        sourcePayload.manual = true;
      }

      return sourcePayload;
    }

    throw new InvalidRequestError(
      "Either moyasarSource or tokenId must be provided for Moyasar payments",
    );
  }

  private buildPaymentMetadata(
    params: MoyasarCreatePaymentParams | CreatePaymentParams,
  ): Record<string, string> | undefined {
    const metadata = {
      ...(params.metadata as Record<string, string> | undefined),
    };

    if (params.orderId) {
      if (params.orderId.length > MOYASAR_MAX_METADATA_VALUE_LENGTH) {
        throw new InvalidRequestError(
          `Moyasar orderId must be ${MOYASAR_MAX_METADATA_VALUE_LENGTH} characters or fewer because it is stored in metadata`,
        );
      }
      metadata.orderId ??= params.orderId;
      metadata.paymentId ??= params.orderId;
    }

    return this.validatePaymentMetadata(metadata);
  }

  private validatePaymentMetadata(
    metadata: Record<string, string>,
  ): Record<string, string> | undefined {
    const entries = Object.entries(metadata);

    if (entries.length === 0) {
      return undefined;
    }

    if (entries.length > 30) {
      throw new InvalidRequestError(
        "Moyasar metadata can include at most 30 keys",
      );
    }

    for (const [key, value] of entries) {
      if (key.length > 40) {
        throw new InvalidRequestError(
          `Moyasar metadata key "${key}" must be 40 characters or fewer`,
        );
      }

      if (typeof value !== "string") {
        throw new InvalidRequestError(
          `Moyasar metadata value for "${key}" must be a string`,
        );
      }

      if (value.length > MOYASAR_MAX_METADATA_VALUE_LENGTH) {
        throw new InvalidRequestError(
          `Moyasar metadata value for "${key}" must be ${MOYASAR_MAX_METADATA_VALUE_LENGTH} characters or fewer`,
        );
      }
    }

    return metadata;
  }

  /**
   * Map our typed MoyasarPaymentSource to Moyasar API payload
   */
  private mapMoyasarSource(
    source: MoyasarPaymentSource,
    capture?: boolean,
  ): Record<string, unknown> {
    const manual =
      "manualCapture" in source && source.manualCapture !== undefined
        ? source.manualCapture
        : capture === false
          ? true
          : undefined;

    switch (source.type) {
      case "creditcard":
        throw new InvalidRequestError(
          "Moyasar raw creditcard source is not supported by this backend SDK. Use Moyasar.js tokenization, Apple Pay, Samsung Pay, or STC Pay so cardholder data is sent directly to Moyasar.",
        );

      case "token":
        return {
          type: "token",
          token: source.token,
          ...(source.cvc && { cvc: source.cvc }),
          ...(source.statementDescriptor && {
            statement_descriptor: source.statementDescriptor,
          }),
          ...(source._3ds !== undefined && { "3ds": source._3ds }),
          ...(manual !== undefined && { manual }),
        };

      case "applepay":
        // Check if this is an encrypted token or decrypted DPAN
        if ("token" in source && source.token) {
          return {
            type: "applepay",
            token: source.token,
            ...(manual !== undefined && { manual }),
            ...(source.saveCard !== undefined && {
              save_card: source.saveCard,
            }),
            ...(source.statementDescriptor && {
              statement_descriptor: source.statementDescriptor,
            }),
          };
        }
        // Decrypted Apple Pay token (DPAN). Moyasar's ApplePayDecryptTokenRequest
        // has no `manual` field — fail closed rather than silently auto-capturing
        // when the caller asked for authorize-only.
        if ("dpan" in source) {
          if (manual === true) {
            throw new InvalidRequestError(
              "Moyasar decrypted Apple Pay (DPAN) does not support manual capture (capture: false). Use an encrypted Apple Pay token source for authorize-only payments, or omit capture: false for auto-capture.",
            );
          }
          return {
            type: "applepay",
            number: source.dpan,
            month: source.month,
            year: source.year,
            cryptogram: source.cryptogram,
            device_id: source.deviceId,
            ...(source.lastFour && { last_four: source.lastFour }),
            ...(source.eci && { eci: source.eci }),
          };
        }
        throw new InvalidRequestError(
          "Invalid Apple Pay source: must have either token or dpan",
        );

      case "samsungpay":
        return {
          type: "samsungpay",
          token: source.token,
          ...(manual !== undefined && { manual }),
          ...(source.saveCard !== undefined && { save_card: source.saveCard }),
          ...(source.statementDescriptor && {
            statement_descriptor: source.statementDescriptor,
          }),
        };

      case "stcpay":
        // STC Pay has no `manual` capture field — fail closed rather than
        // silently auto-capturing when the caller asked for authorize-only.
        if (manual === true) {
          throw new InvalidRequestError(
            "Moyasar STC Pay does not support manual capture (capture: false). Omit capture: false; STC Pay captures after successful OTP confirmation.",
          );
        }
        return {
          type: "stcpay",
          mobile: source.mobile,
          ...(source.cashier && { cashier: source.cashier }),
          ...(source.branch && { branch: source.branch }),
        };

      default:
        // Exhaustive check - TypeScript will error if we miss a case
        const _exhaustiveCheck: never = source;
        throw new GatewayApiError(
          `Unknown payment source type: ${(source as Record<string, unknown>).type}`,
          "moyasar",
          { code: "UNKNOWN_SOURCE_TYPE" },
        );
    }
  }

  /**
   * Capture an authorized payment.
   * @see https://docs.moyasar.com/api/payments/06-capture-payment
   * @note Moyasar auto-captures by default; use this only for manual-capture flows.
   * @note Not auto-retried by `withRetry`. Pass `idempotencyKey` with
   *   `moyasar.idempotencyStore` so **caller** retries are deduped (Moyasar has
   *   no native capture idempotency).
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async (p) => {
      const requestBody: Record<string, unknown> = {};

      // Only include amount for partial captures
      if (p.amount !== undefined) {
        if (!p.currency) {
          throw new InvalidRequestError(
            "currency is required for Moyasar partial captures so the amount can be converted to minor units correctly",
          );
        }
        requestBody.amount = this.toMinorUnits(p.amount, p.currency);
      }

      const hasBody = Object.keys(requestBody).length > 0;
      const init: RequestInit = {
        method: "POST",
        headers: this.getHeaders({ contentType: hasBody }),
      };
      if (hasBody) {
        init.body = JSON.stringify(requestBody);
      }
      const captureSignal = extractAbortSignal(p);
      if (captureSignal) {
        init.signal = captureSignal;
      }

      return this.runIdempotentMutation(
        "capturePayment",
        p.gatewayPaymentId,
        p.idempotencyKey,
        { amount: p.amount, currency: p.currency },
        async () => {
          const data = (await this.requestJson(
            this.paymentPath(p.gatewayPaymentId, "capture"),
            init,
            "Failed to capture payment",
          )) as MoyasarPaymentResponse | MoyasarErrorResponse;

          return this.mapPaymentResponse(data as MoyasarPaymentResponse);
        },
      );
    }, MoyasarCaptureParamsSchema);
  }

  /**
   * Refund a payment (full or partial).
   * @see https://docs.moyasar.com/api/payments/05-refund-payment
   * @note Moyasar returns the updated payment object, not a separate refund entity.
   * @note Not auto-retried by `withRetry`. Pass `idempotencyKey` with
   *   `moyasar.idempotencyStore` so **caller** retries are deduped (Moyasar has
   *   no native refund idempotency).
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      const requestBody: Record<string, unknown> = {};

      // Only include amount for partial refunds
      if (p.amount !== undefined) {
        if (!p.currency) {
          throw new InvalidRequestError(
            "currency is required for Moyasar partial refunds so the amount can be converted to minor units correctly",
          );
        }
        requestBody.amount = this.toMinorUnits(p.amount, p.currency);
      }

      const hasBody = Object.keys(requestBody).length > 0;
      const init: RequestInit = {
        method: "POST",
        headers: this.getHeaders({ contentType: hasBody }),
      };
      if (hasBody) {
        init.body = JSON.stringify(requestBody);
      }
      const refundSignal = extractAbortSignal(p);
      if (refundSignal) {
        init.signal = refundSignal;
      }

      return this.runIdempotentMutation(
        "refundPayment",
        p.gatewayPaymentId,
        p.idempotencyKey,
        { amount: p.amount, currency: p.currency },
        async () => {
          const data = (await this.requestJson(
            this.paymentPath(p.gatewayPaymentId, "refund"),
            init,
            "Failed to refund payment",
          )) as MoyasarPaymentResponse | MoyasarErrorResponse;

          const payment = data as MoyasarPaymentResponse;
          const paymentStatus = this.resolvePaymentStatus(payment);

          // Moyasar returns the payment object with updated refund info.
          // There's no separate refund ID — refund is tracked on the payment.
          // Prefer "completed" on HTTP 2xx when the returned payment reflects a
          // refund (full/partial), not only when provider status === "refunded".
          const reflectsRefund =
            payment.refunded > 0 ||
            paymentStatus === "refunded" ||
            paymentStatus === "partially_refunded" ||
            payment.status === "refunded";

          const status = reflectsRefund ? "completed" : "pending";
          const outcome: RefundOperationOutcome = reflectsRefund
            ? "succeeded"
            : "pending";
          return applyOutcomeToGatewayRefundResult(
            {
              // Payment ID (Moyasar has no separate refund entity)
              gatewayRefundId: payment.id,
              status,
              totalRefunded: this.fromMinorUnits(
                payment.refunded,
                payment.currency,
              ),
              refundedAt: payment.refunded_at
                ? new Date(payment.refunded_at)
                : undefined,
              rawResponse: payment,
            },
            outcome,
          );
        },
      );
    }, MoyasarRefundParamsSchema);
  }

  /**
   * Void a payment while Moyasar still allows reversal.
   * @see https://docs.moyasar.com/api/payments/07-void-payment
   * @note Allowed for **authorized** (uncaptured) holds, and for **paid** /
   *   auto-captured payments only within Moyasar's short settlement window
   *   (commonly ~2 hours per Payment Operations). After that window, use
   *   {@link refundPayment} instead.
   * @note Not auto-retried by `withRetry`. Pass `idempotencyKey` with
   *   `moyasar.idempotencyStore` so **caller** retries are deduped (Moyasar has
   *   no native void idempotency).
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      return this.runIdempotentMutation(
        "voidPayment",
        p.gatewayPaymentId,
        p.idempotencyKey,
        {},
        async () => {
          const voidInit: RequestInit = {
            method: "POST",
            // Empty body — omit Content-Type so intermediaries don't expect JSON.
            headers: this.getHeaders({ contentType: false }),
          };
          const voidSignal = extractAbortSignal(p);
          if (voidSignal) {
            voidInit.signal = voidSignal;
          }
          const data = (await this.requestJson(
            this.paymentPath(p.gatewayPaymentId, "void"),
            voidInit,
            "Failed to void payment",
          )) as MoyasarPaymentResponse | MoyasarErrorResponse;

          // Void completion is operation-succeeded even when status is cancelled.
          return this.mapPaymentResponse(data as MoyasarPaymentResponse, {
            forceOutcome: "succeeded",
          });
        },
      );
    }, MoyasarVoidParamsSchema);
  }

  /**
   * Confirm an initiated STC Pay payment using the OTP sent to the customer.
   * @see https://docs.moyasar.com/guides/stc-pay/custom-ui/
   */
  async confirmStcPayOtp(
    params: MoyasarConfirmStcPayOtpParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("confirmStcPayOtp", params, async (p) => {
      return this.confirmStcPayOtpRequest(p);
    });
  }

  private async confirmStcPayOtpRequest(
    params: MoyasarConfirmStcPayOtpParams,
  ): Promise<GatewayPaymentResult> {
    if (!params.transactionUrl) {
      throw new InvalidRequestError(
        "transactionUrl is required for Moyasar STC Pay OTP confirmation",
      );
    }
    if (
      params.otpValue === "" ||
      params.otpValue === undefined ||
      params.otpValue === null
    ) {
      throw new InvalidRequestError(
        "otpValue is required for Moyasar STC Pay OTP confirmation",
      );
    }

    const transactionUrl = this.assertMoyasarStcTransactionUrl(
      params.transactionUrl,
    );
    const otpInit: RequestInit = {
      method: "POST",
      headers: this.getHeaders({ auth: false }),
      body: JSON.stringify({ otp_value: params.otpValue }),
    };
    const otpSignal = extractAbortSignal(params);
    if (otpSignal) {
      otpInit.signal = otpSignal;
    }
    const data = (await this.requestJson(
      transactionUrl,
      otpInit,
      "Failed to confirm STC Pay OTP",
    )) as MoyasarPaymentResponse | MoyasarErrorResponse;

    const payment = data as MoyasarPaymentResponse;
    return this.mapPaymentResponse(payment);
  }

  /**
   * Map Moyasar errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "moyasar") {
      const raw = error.rawError as { type?: string; message?: string; status?: number };
      const type = raw?.type;
      const message = raw?.message ?? error.message;
      const status = raw?.status;

      switch (type) {
        case "invalid_request":
        case "invalid_request_error":
          return new InvalidRequestError(message);
        case "authentication_error":
        case "authorization_error":
          return new AuthenticationError(message);
        case "rate_limit_error":
          return new RateLimitError("moyasar", extractRetryAfterSeconds(error));
        case "api_connection_error":
          return new NetworkError(message);
        case "record_not_found":
          return new ResourceNotFoundError(message, raw);
        // 3DS challenge failure is a card/auth step failure at the issuer, not
        // an SDK/API credentials failure — do not map to AuthenticationError.
        case "3ds_auth_error":
          return new CardDeclinedError(message, raw);
      }

      if (status === 400) {
        return new InvalidRequestError(message);
      }
      if (status === 401 || status === 403) {
        return new AuthenticationError(message);
      }
      if (status === 429) {
        return new RateLimitError("moyasar", extractRetryAfterSeconds(error));
      }
      if (status === 404) {
        return new ResourceNotFoundError(message, raw);
      }
    }
    return super.mapError(error);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Moyasar webhook using secret_token in payload
   * @see https://docs.moyasar.com/guides/dashboard/webhooks
   */
  verifyWebhook(payload: unknown, _signature?: string): boolean {
    if (!this.moyasarConfig.webhookSecret) {
      this.logger.warn(
        "[Moyasar] No webhook secret configured, rejecting webhook",
      );
      return false;
    }

    if (!this.isRecord(payload) || typeof payload.secret_token !== "string") {
      return false;
    }

    return this.constantTimeEquals(
      payload.secret_token,
      this.moyasarConfig.webhookSecret,
    );
  }

  /**
   * Parse Moyasar webhook payload into normalized WebhookEvent.
   *
   * Dual-writes Phase 7 {@link import('../../types/payment-event').PaymentEvent}
   * on `event` / `stableType` / `provider` while keeping provider-native `type`
   * and redacted `rawPayload` (secret_token stripped).
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    const raw = this.assertMoyasarWebhookPayload(payload);

    // card_auth_* events carry a card authentication object, not a payment.
    // Refuse rather than mapping them as payment.pending.
    if (raw.type.startsWith("card_auth_")) {
      throw new InvalidWebhookError(
        `Moyasar card authentication webhooks (${raw.type}) are not supported; handle card_auth_* events separately from payment webhooks`,
      );
    }

    const paymentId = this.extractPaymentId(raw.data.metadata);
    const data = raw.data as MoyasarWebhookPayload["data"] & {
      refunded?: number;
      captured?: number;
    };

    // Never re-expose the webhook secret in rawPayload after verification.
    const { secret_token: _secretToken, ...rawWithoutSecret } = raw;

    const legacy: WebhookEvent = {
      id: raw.id,
      type: this.normalizeWebhookEventType(raw.type),
      gateway: "moyasar",
      paymentId,
      gatewayPaymentId: data.id,
      status: this.resolvePaymentStatus({
        status: data.status,
        amount: data.amount,
        refunded: data.refunded,
        captured: data.captured,
      }),
      amount: this.fromMinorUnits(data.amount, data.currency),
      // Normalize to uppercase ISO 4217 for cross-gateway consistency.
      currency: data.currency.toUpperCase(),
      timestamp: new Date(raw.created_at),
      // Moyasar exposes test/live on the envelope as `live`.
      ...(typeof raw.live === "boolean" ? { livemode: raw.live } : {}),
      rawPayload: rawWithoutSecret,
    };

    return attachPaymentEvent(legacy, { computePayloadHash: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get payment status from Moyasar
   * @see https://docs.moyasar.com/api/payments/02-fetch-payment
   */
  async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
    const result = await this.getPayment({ gatewayPaymentId: gatewayId });
    return result.status;
  }

  /**
   * Get full payment details from Moyasar
   * @see https://docs.moyasar.com/api/payments/02-fetch-payment
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("getPayment", params, async (p) => {
      const { gatewayPaymentId } = p;

      // GET is safe to retry unconditionally.
      const getInit: RequestInit = {
        method: "GET",
        headers: this.getHeaders(),
      };
      const getSignal = extractAbortSignal(p);
      if (getSignal) {
        getInit.signal = getSignal;
      }
      const data = (await withRetry(
        () =>
          this.requestJson(
            this.paymentPath(gatewayPaymentId),
            getInit,
            "Failed to get payment",
          ),
        { isRetryable: isMoyasarRetryableError },
      )) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      const payment = data as MoyasarPaymentResponse;
      return this.mapPaymentResponse(payment);
    }, MoyasarGetPaymentParamsSchema);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get authorization headers for Moyasar API
   * Moyasar uses HTTP Basic Auth with secret key as username
   * @param options.contentType - When false, omits Content-Type (for empty-body POSTs).
   */
  private getHeaders(
    options: { auth?: boolean; contentType?: boolean } = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (options.contentType !== false) {
      headers["Content-Type"] = "application/json";
    }

    if (options.auth !== false) {
      // Portable Base64 (no node:buffer / btoa-only path).
      const credentials = utf8ToBase64(`${this.moyasarConfig.secretKey}:`);
      headers.Authorization = `Basic ${credentials}`;
    }

    return headers;
  }

  /**
   * Map Moyasar payment response to unified GatewayPaymentResult.
   * Card and STC Pay challenge URLs are returned in transaction_url.
   *
   * Prefer `outcome` (Phase 6). `success` is dual-written for 0.x:
   * false when status maps to SDK `failed` (or outcome declined/failed);
   * true for paid/authorized/pending/requires_action paths. Callers must
   * check `outcome === 'succeeded'` + paid-like status before fulfilling.
   */
  private mapPaymentResponse(
    payment: MoyasarPaymentResponse,
    options: { forceOutcome?: PaymentOperationOutcome } = {},
  ): GatewayPaymentResult {
    const transactionUrl = payment.source?.transaction_url ?? undefined;
    const redirectUrl = payment.source?.type === "stcpay"
      ? undefined
      : transactionUrl;
    const nextAction = this.mapNextAction(payment);
    // Single mapStatus call: failed/abandoned/unmapped → "failed" (warn once)
    const baseStatus = this.mapStatus(payment.status);
    const status = this.resolvePaymentStatus(payment, baseStatus);
    const outcome =
      options.forceOutcome ??
      this.mapMoyasarOutcome(status, nextAction, redirectUrl);

    return applyOutcomeToGatewayResult(
      {
        gatewayId: payment.id,
        status,
        rawResponse: payment,
        ...(redirectUrl !== undefined ? { redirectUrl } : {}),
        ...(nextAction !== undefined ? { nextAction } : {}),
        amount: this.fromMinorUnits(payment.amount, payment.currency),
        fee: this.fromMinorUnits(payment.fee, payment.currency),
        capturedAmount: this.fromMinorUnits(payment.captured, payment.currency),
        refundedAmount: this.fromMinorUnits(payment.refunded, payment.currency),
        providerNativeStatus: payment.status,
        gateway: "moyasar",
      },
      outcome,
      outcome === "declined"
        ? {
            decline: {
              code:
                typeof payment.source?.message === "string" &&
                payment.source.message.length > 0
                  ? payment.source.message
                  : payment.status || "DECLINED",
              message:
                typeof payment.source?.message === "string" &&
                payment.source.message.length > 0
                  ? payment.source.message
                  : `Moyasar payment ${payment.status}`,
              providerCode: payment.status,
            },
          }
        : undefined,
    );
  }

  /**
   * Derive Phase 6 outcome from mapped Moyasar status + challenge signals.
   * 3DS / STC OTP / initiated never map to `succeeded`.
   * Cancelled/voided maps to `failed` unless void forces succeeded.
   */
  private mapMoyasarOutcome(
    status: PaymentStatus,
    nextAction: PaymentNextAction | undefined,
    redirectUrl: string | undefined,
  ): PaymentOperationOutcome {
    if (status === "failed") {
      return "declined";
    }
    if (status === "cancelled") {
      return "failed";
    }
    if (
      nextAction !== undefined ||
      (status === "pending" &&
        typeof redirectUrl === "string" &&
        redirectUrl.length > 0)
    ) {
      return "requires_action";
    }
    if (status === "pending" || status === "processing") {
      // Initiated without challenge URL still must not be treated as paid.
      return "requires_action";
    }
    // paid | authorized | partially_* | refunded | setup_completed
    return "succeeded";
  }

  /**
   * Convert major currency units to Moyasar minor units via shared bigint helpers.
   * @param options.allowNonPositive - For splits, Moyasar allows any non-zero
   *   integer (including negatives). Top-level payment amounts still require >= 1.
   */
  private toMinorUnits(
    amount: AmountInput,
    currency: string,
    options: { allowNonPositive?: boolean } = {},
  ): number {
    const allowNonPositive = options.allowNonPositive === true;
    const currencyCode = currency.toUpperCase();
    // ISO exponents via getCurrencyExponent (shared default). Strict reject
    // on excess precision; never float-multiply.
    const parseOpts = {
      rounding: "reject" as const,
      allowNegative: allowNonPositive,
      allowZero: false,
    };

    const normalized = normalizeAmountInput(amount, currency, parseOpts);
    const minor = sharedToMinorUnits(normalized, parseOpts);

    try {
      return minorAmountToNumber(minor);
    } catch (error) {
      if (error instanceof MoneyAmountError && error.kind === "unsafe_range") {
        throw new InvalidRequestError(
          `Moyasar amount for ${currencyCode} is too large to represent safely in minor units`,
        );
      }
      throw error;
    }
  }

  private fromMinorUnits(amount: number, currency: string): number {
    // Provider responses use integer minor units; zero fees/refunds are common.
    const money = sharedFromMinorUnits(amount, currency, {
      allowZero: true,
      allowNegative: true,
    });
    return moneyToMajorNumber(money, { allowZero: true, allowNegative: true });
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const leftBytes = utf8Encode(left);
    const rightBytes = utf8Encode(right);

    if (leftBytes.length !== rightBytes.length) {
      // Length is not secret; still touch both buffers then reject.
      const length = Math.max(leftBytes.length, rightBytes.length);
      const paddedLeft = new Uint8Array(length);
      const paddedRight = new Uint8Array(length);
      paddedLeft.set(leftBytes);
      paddedRight.set(rightBytes);
      timingSafeEqualBytes(paddedLeft, paddedRight);
      return false;
    }

    return timingSafeEqualBytes(leftBytes, rightBytes);
  }

  private assertMoyasarWebhookPayload(payload: unknown): MoyasarWebhookPayload {
    if (!this.isRecord(payload)) {
      throw new InvalidWebhookError("Invalid Moyasar webhook payload");
    }

    const data = payload.data;
    if (!this.isRecord(data)) {
      throw new InvalidWebhookError("Invalid Moyasar webhook payload: missing data");
    }

    if (
      typeof payload.id !== "string" ||
      typeof payload.type !== "string" ||
      typeof payload.created_at !== "string" ||
      typeof data.id !== "string" ||
      typeof data.status !== "string" ||
      typeof data.amount !== "number" ||
      typeof data.currency !== "string"
    ) {
      throw new InvalidWebhookError("Invalid Moyasar webhook payload fields");
    }

    return payload as unknown as MoyasarWebhookPayload;
  }

  private extractPaymentId(metadata: unknown): string | undefined {
    if (!this.isRecord(metadata)) {
      return undefined;
    }

    if (typeof metadata.paymentId === "string") {
      return metadata.paymentId;
    }

    return typeof metadata.orderId === "string"
      ? metadata.orderId
      : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private paymentPath(
    paymentId: string,
    operation?: "capture" | "refund" | "void",
  ): string {
    const encodedPaymentId = encodeURIComponent(paymentId);
    return operation
      ? `/payments/${encodedPaymentId}/${operation}`
      : `/payments/${encodedPaymentId}`;
  }

  private normalizeWebhookEventType(type: string): string {
    return type === "payment_faild" ? "payment_failed" : type;
  }

  private async requestJson(
    urlOrPath: string,
    init: RequestInit,
    fallbackMessage: string,
  ): Promise<unknown> {
    const response = await this.request(urlOrPath, init);
    const data = (await this.parseJsonResponse(response)) as
      | MoyasarPaymentResponse
      | MoyasarErrorResponse;

    if (!response.ok) {
      throw this.createApiError(
        data as MoyasarErrorResponse,
        fallbackMessage,
        response.status,
        response.headers,
      );
    }

    return data;
  }

  private async request(urlOrPath: string, init: RequestInit): Promise<Response> {
    const timeoutMs = this.moyasarConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { signal: timeoutSignal, clear } = createTimeoutSignal(timeoutMs);
    const callerSignal = init.signal ?? undefined;
    const signal = combineAbortSignals(callerSignal, timeoutSignal);
    const url = urlOrPath.startsWith("http")
      ? urlOrPath
      : `${this.baseUrl}${urlOrPath}`;

    try {
      return await this.fetch(url, {
        ...init,
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (e) {
      throw mapHttpAbortError(e, {
        callerSignal,
        timeoutSignal,
        timeoutMessage: "Moyasar API request timed out",
        networkMessage: "Failed to connect to Moyasar API",
        callerAbortMessage: "Moyasar API request aborted by caller signal",
      });
    } finally {
      clear();
    }
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (e) {
      throw new GatewayApiError(
        "Moyasar API returned an invalid JSON response",
        "moyasar",
        { status: response.status, cause: e },
      );
    }
  }

  /**
   * Map Moyasar provider status string to unified PaymentStatus.
   * Unmapped values fail closed as `failed` (do not treat as pending fulfillment).
   */
  private mapStatus(moyasarStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      initiated: "pending",
      pending: "pending",
      authorized: "authorized",
      // Zero-amount card setup / verification — not an authorization hold.
      verified: "setup_completed",
      captured: "paid",
      paid: "paid",
      abandoned: "failed",
      failed: "failed",
      refunded: "refunded",
      voided: "cancelled",
    };

    const mapped = statusMap[moyasarStatus];
    if (mapped === undefined) {
      this.logger.warn(
        `[Moyasar] Unmapped payment status "${moyasarStatus}"; treating as failed (fail-closed for fulfillment)`,
      );
      return "failed";
    }
    return mapped;
  }

  /**
   * After mapping the provider status string, refine using amount fields so
   * partial refunds/captures surface as partially_refunded / partially_captured.
   * @param baseStatus - Optional precomputed `mapStatus` result (avoids double map/warn).
   */
  private resolvePaymentStatus(
    payment: {
      status: string;
      amount: number;
      refunded?: number;
      captured?: number;
    },
    baseStatus?: PaymentStatus,
  ): PaymentStatus {
    const status = baseStatus ?? this.mapStatus(payment.status);
    const amount = payment.amount;
    const refunded =
      typeof payment.refunded === "number" && Number.isFinite(payment.refunded)
        ? payment.refunded
        : 0;
    const captured =
      typeof payment.captured === "number" && Number.isFinite(payment.captured)
        ? payment.captured
        : 0;

    if (refunded > 0 && refunded < amount) {
      return "partially_refunded";
    }
    if (refunded >= amount && amount > 0) {
      return "refunded";
    }

    // Partial capture only when the base status is auth/paid (captured) family.
    if (
      captured > 0 &&
      captured < amount &&
      (status === "authorized" ||
        status === "paid" ||
        payment.status === "authorized" ||
        payment.status === "captured" ||
        payment.status === "paid")
    ) {
      return "partially_captured";
    }

    return status;
  }

  private mapNextAction(
    payment: MoyasarPaymentResponse,
  ): PaymentNextAction | undefined {
    const transactionUrl = payment.source?.transaction_url;
    if (!transactionUrl || payment.status !== "initiated") {
      return undefined;
    }

    if (payment.source.type === "stcpay") {
      return {
        type: "stcpay_otp",
        transactionUrl,
        method: "POST",
        parameter: "otp_value",
      };
    }

    return {
      type: "redirect",
      url: transactionUrl,
    };
  }

  private assertMoyasarStcTransactionUrl(transactionUrl: string): string {
    let url: URL;
    try {
      url = new URL(transactionUrl);
    } catch {
      throw new InvalidRequestError(
        "Moyasar STC Pay transactionUrl must be a valid URL",
      );
    }

    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.moyasar.com" ||
      !url.pathname.startsWith("/v1/stc_pays/") ||
      !url.pathname.endsWith("/proceed")
    ) {
      throw new InvalidRequestError(
        "Moyasar STC Pay transactionUrl must be the transaction_url returned by Moyasar",
      );
    }

    return url.toString();
  }

  /**
   * Create a structured API error from Moyasar error response
   */
  private createApiError(
    errorData: MoyasarErrorResponse,
    fallbackMessage: string,
    status?: number,
    headers?: Headers,
  ): GatewayApiError {
    let message = errorData.message ?? fallbackMessage;

    // Append validation errors if present
    if (errorData.errors) {
      const errorDetails = Object.entries(errorData.errors)
        .map(([field, messages]) => {
          const detail = Array.isArray(messages)
            ? messages.join(", ")
            : String(messages);
          return `${field}: ${detail}`;
        })
        .join("; ");
      message = `${message} - ${errorDetails}`;
    }

    const error = new GatewayApiError(message, "moyasar", {
      type: errorData.type,
      message,
      errors: errorData.errors,
      status,
    });

    // Expose Retry-After (seconds) so the retry helper can honor it on 429s.
    const retryAfterSeconds = parseRetryAfterSeconds(headers);
    if (retryAfterSeconds !== undefined) {
      (error as GatewayApiError & { retryAfterSeconds?: number }).retryAfterSeconds =
        retryAfterSeconds;
    }

    return error;
  }
}
