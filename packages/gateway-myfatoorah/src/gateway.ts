import {
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  BaseGateway,
  buildProviderReferences,
  combineAbortSignals,
  createTimeoutSignal,
  InvalidRequestError,
  mapHttpAbortError,
  NetworkError,
  OperationNotSupportedError,
  toMinorUnits,
  withRetry,
  type CaptureParams,
  type GatewayPaymentResult,
  type GatewayRefundResult,
  type GatewayRuntimeDeps,
  type HooksManager,
  type Logger,
  type WebhookEvent,
} from "@paykernel/core";
import { MYFATOORAH_CAPABILITIES } from "./capabilities";
import {
  MYFATOORAH_COUNTRY_CURRENCY,
  MYFATOORAH_DEFAULT_TIMEOUT_MS,
  assertMyFatoorahHttpsUrl,
  copyMyFatoorahConfig,
  resolveMyFatoorahBaseUrl,
  type MyFatoorahConfig,
} from "./config";
import {
  assertMyFatoorahSuccessEnvelope,
  isMyFatoorahRetryableBeforeSubmit,
  isMyFatoorahRetryableError,
  mapMyFatoorahHttpFailure,
  readMyFatoorahData,
} from "./http";
import { myFatoorahMajorNumber, parseMyFatoorahAmount, stringifyMyFatoorahJsonBody } from "./money";
import {
  myFatoorahRefundBaseCurrency,
  myFatoorahRefundId,
  myFatoorahRefundItems,
  myFatoorahRefundStatus,
  myFatoorahRemainingRefundMajor,
  nestedRefundFromInvoice,
} from "./refund-support";
import {
  assertMyFatoorahDisplayPaymentMethods,
  assertMyFatoorahPaymentMethod,
  assertNoPciCardSource,
  resolveMyFatoorahCustomerReference,
} from "./sources";
import {
  mapMyFatoorahInvoiceOutcome,
  mapMyFatoorahInvoiceStatus,
  mapMyFatoorahRefundEntityStatus,
  mapMyFatoorahTransactionEvidence,
} from "./status";
import type {
  MyFatoorahCreatePaymentParams,
  MyFatoorahGetPaymentParams,
  MyFatoorahRefundParams,
} from "./types";
import {
  parseMyFatoorahPaymentWebhookEvent,
  parseMyFatoorahRefundWebhookEvent,
} from "./webhook-map";
import {
  extractMyFatoorahSignatureHeader,
  myFatoorahWebhookKind,
  verifyMyFatoorahSignature,
} from "./webhooks";
import { normalizeMyFatoorahCurrency } from "./currency";
const MYFATOORAH_REFUND_COMMENT_MAX = 500;
const CURRENCY_CODE = /^[A-Za-z]{3}$/;

function isMyFatoorahRetryableNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError && error.message.includes("aborted by caller")) {
    return false;
  }
  return isMyFatoorahRetryableError(error);
}
function validationErrorArrayMentionsIdempotency(arr: unknown): boolean {
  if (!Array.isArray(arr)) return false;
  for (const ve of arr) {
    const rec = asRecord(ve);
    const name = typeof rec.Name === "string" ? rec.Name : "";
    const err = typeof rec.Error === "string" ? rec.Error : "";
    if (name.toLowerCase().includes("idempotency") || err.toLowerCase().includes("idempotency")) {
      return true;
    }
  }
  return false;
}

function validationBodyMentionsIdempotency(body: unknown): boolean {
  const rec = asRecord(body);
  // Official field is ValidationErrors; legacy alias FieldsErrors
  const ve = rec.ValidationErrors ?? rec.FieldsErrors;
  return validationErrorArrayMentionsIdempotency(ve);
}

function hasMyFatoorahIdempotencyValidationError(error: unknown): boolean {
  if (
    !(error instanceof InvalidRequestError) ||
    error.validationErrors === undefined ||
    error.validationErrors.length === 0
  ) {
    return false;
  }
  for (const entry of error.validationErrors) {
    // Entries are the http layer's `{ status, body }` raw snapshots.
    const body = asRecord(entry).body;
    if (typeof body === "string" && body.trim().length > 0) {
      // 2xx IsSuccess:false arrives with the raw response text as body.
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined && validationBodyMentionsIdempotency(parsed)) return true;
      // Unparseable string body: only retry when it mentions the Idempotency-Key header.
      if (body.toLowerCase().includes("idempotency-key")) return true;
    } else if (validationBodyMentionsIdempotency(body)) {
      return true;
    }
  }
  return false;
}

function currenciesMismatch(requested: unknown, retrieved: unknown): boolean {
  if (typeof requested !== "string" || requested.trim().length === 0) {
    return false;
  }
  if (typeof retrieved !== "string" || retrieved.trim().length === 0) {
    return false;
  }
  const req = normalizeMyFatoorahCurrency(requested) ?? requested.trim().toUpperCase();
  const ret = normalizeMyFatoorahCurrency(retrieved) ?? retrieved.trim().toUpperCase();
  return req !== ret;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringOrNumberId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export interface MyFatoorahGateway {
  createPayment(params: MyFatoorahCreatePaymentParams): Promise<GatewayPaymentResult>;
  capturePayment(params: CaptureParams): Promise<GatewayPaymentResult>;
  refundPayment(params: MyFatoorahRefundParams): Promise<GatewayRefundResult>;
  getPayment(params: MyFatoorahGetPaymentParams): Promise<GatewayPaymentResult>;
}

export class MyFatoorahGateway extends BaseGateway {
  readonly name = "myfatoorah" as const;
  private readonly myfatoorahConfig: MyFatoorahConfig;

  constructor(
    config: MyFatoorahConfig,
    hooks: HooksManager,
    logger?: Logger,
    runtime?: GatewayRuntimeDeps,
  ) {
    const closed = copyMyFatoorahConfig(config);
    super(closed, hooks, logger, MYFATOORAH_CAPABILITIES, runtime);
    this.myfatoorahConfig = closed;
  }

  async createPayment(params: MyFatoorahCreatePaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      const idempotencyKey = this.assertMutationKey(p.idempotencyKey, "createPayment");
      if ((p as unknown as Record<string, unknown>).offSession === true) {
        throw new OperationNotSupportedError(this.name, "createPayment", {
          capability: "paymentMethods",
          claimedSupport: false,
        });
      }
      assertNoPciCardSource(p as unknown as Record<string, unknown>);
      // `authorization` is unclaimed; the base-class post-hook gate rejects
      // `capture: false` first. Explicit fail-closed guard for direct callers.
      if (p.capture === false) {
        throw new OperationNotSupportedError(this.name, "createPayment", {
          capability: "authorization",
          claimedSupport: false,
        });
      }
      assertMyFatoorahHttpsUrl(p.callbackUrl, "callbackUrl");
      // MF-CREATE-REPLAY: before POST /v3/payments, if Customer.Reference will be set,
      // attempt GetPaymentStatus with KeyType CustomerReference to reuse an existing
      // Paid invoice and avoid double-charge outside KWT/SAU where Idempotency-Key
      // is not sent. Pending would lose PaymentURL via GetPaymentStatus, so only
      // Paid is reused — pending falls through to create.
      const replayReference = this.customerReferenceForReplay(p);
      if (replayReference !== undefined) {
        try {
          const { data, raw } = await this.myfatoorahRequest(
            "POST",
            "/v2/GetPaymentStatus",
            { Key: replayReference, KeyType: "CustomerReference" },
            { signal: p.signal, retry: true, postSubmit: false, allowMissingData: true },
          );
          const existingInvoiceId = stringOrNumberId(data.InvoiceId);
          if (existingInvoiceId !== undefined) {
            const invoiceStatusRaw =
              typeof data.InvoiceStatus === "string" ? data.InvoiceStatus : "";
            const invoiceStatus = mapMyFatoorahInvoiceStatus(invoiceStatusRaw);
            if (invoiceStatus === "paid") {
              return this.mapGetPaymentResult(data, raw);
            }
          }
        } catch (error) {
          // Preflight is best-effort: 404 / IsSuccess:false / network / malformed
          // all fall through to the real create below. Only caller aborts propagate.
          if (p.signal?.aborted) throw error;
          const isAbort =
            error instanceof NetworkError && error.message.includes("aborted by caller");
          if (isAbort) throw error;
        }
      }
      const body = this.buildCreateBody(p);
      // Idempotency-Key is only honored in KWT/SAU — outside those countries,
      // after-submit retries risk double-charge, so only retry before submit.
      const idempotencySupported =
        this.myfatoorahConfig.country === "KWT" || this.myfatoorahConfig.country === "SAU";
      const isRetryable = idempotencySupported
        ? isMyFatoorahRetryableNetworkError
        : isMyFatoorahRetryableBeforeSubmit;
      const requestOptions = {
        signal: p.signal,
        retry: true as const,
        idempotencyKey,
        postSubmit: true as const,
        isRetryable,
      };
      try {
        const { data, raw } = await this.myfatoorahRequest(
          "POST",
          "/v3/payments",
          body,
          requestOptions,
        );
        return this.mapCreateResult(data, raw, p.currency.trim().toUpperCase());
      } catch (error) {
        if (hasMyFatoorahIdempotencyValidationError(error)) {
          // Header not supported (or other idempotency validation) — retry once without header,
          // without post-submit retry to avoid double-charge if the headerless POST is accepted.
          const retryWithoutHeader = {
            signal: requestOptions.signal,
            retry: false as const,
            postSubmit: requestOptions.postSubmit,
          };
          const { data, raw } = await this.myfatoorahRequest(
            "POST",
            "/v3/payments",
            body,
            retryWithoutHeader,
          );
          return this.mapCreateResult(data, raw, p.currency.trim().toUpperCase());
        }
        throw error;
      }
    });
  }

  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async () => {
      this.assertCapability("authorization", "capturePayment");
      // Unreachable — assertCapability always throws for this adapter.
      throw new OperationNotSupportedError(this.name, "capturePayment", {
        capability: "authorization",
        claimedSupport: false,
      });
    });
  }

  async refundPayment(params: MyFatoorahRefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      const idempotencyKey = this.assertMutationKey(p.idempotencyKey, "refundPayment");
      const invoiceId = this.assertInvoiceId(p.gatewayPaymentId, "refundPayment");

      // Fetch GetRefundStatus first — if an existing refund with this idempotencyKey is found,
      // return immediately without awaiting GetPaymentStatus (cheap path).
      const refundStatus = await this.myfatoorahRequest(
        "POST",
        "/v2/GetRefundStatus",
        { KeyType: "InvoiceId", Key: invoiceId },
        // Data is nullable per OpenAPI — no refunds yet is a valid empty history.
        { signal: p.signal, retry: true, postSubmit: false, allowMissingData: true },
      );
      const refundsRaw: unknown = refundStatus.data;
      // MF-CRIT-1: ExternalIdentifier is not provider-deduped. Check for an existing
      // refund with the same idempotencyKey before any MakeRefund, even when
      // remaining > 0, to avoid double-refunding on partial-replay / crash-retry.
      const existingRefund = nestedRefundFromInvoice(refundsRaw, idempotencyKey);
      if (existingRefund !== undefined) {
        return this.mapNestedRefundObject(existingRefund);
      }

      const paymentStatus = await this.myfatoorahRequest(
        "POST",
        "/v2/GetPaymentStatus",
        { KeyType: "InvoiceId", Key: invoiceId },
        { signal: p.signal, retry: true, postSubmit: false },
      );

      const currency = this.refundCurrency(p, refundStatus.data);
      this.assertCurrencyMatch(p.currency, currency, "refund");

      const invoiceAmount = this.invoiceValue(paymentStatus.data);
      // Official GetRefundStatus uses RefundStatusResult; fallback to legacy Refunds.
      // Pass the whole Data object so myFatoorahRefundItems can handle both shapes.
      let remaining: number | undefined;
      if (invoiceAmount !== undefined) {
        remaining = myFatoorahRemainingRefundMajor(invoiceAmount, refundsRaw, currency);
      } else if (p.amount === undefined) {
        throw new InvalidRequestError(
          "MyFatoorah refund requires amount (invoice does not expose remaining)",
        );
      }

      if (remaining === 0) {
        // No matching ExternalIdentifier and nothing remaining -> already fully refunded.
        throw new InvalidRequestError(
          "MyFatoorah invoice is already fully refunded (nothing remaining)",
        );
      }

      let outboundMajor: number;
      if (p.amount !== undefined) {
        const requested = this.myfatoorahOutboundMajor(p.amount, currency);
        if (remaining !== undefined) {
          // Compare via minor units to avoid IEEE float errors.
          try {
            const reqMinor = toMinorUnits(parseMyFatoorahAmount(requested, currency));
            const remMinor = toMinorUnits(parseMyFatoorahAmount(remaining, currency));
            if (reqMinor > remMinor) {
              throw new InvalidRequestError(
                "MyFatoorah refund amount exceeds the remaining refundable amount",
              );
            }
          } catch (e) {
            if (e instanceof InvalidRequestError) throw e;
            // Fallback to numeric compare if Money parsing fails
            if (requested > remaining) {
              throw new InvalidRequestError(
                "MyFatoorah refund amount exceeds the remaining refundable amount",
              );
            }
          }
        }
        outboundMajor = requested;
      } else if (remaining !== undefined) {
        outboundMajor = remaining;
      } else {
        throw new InvalidRequestError(
          "MyFatoorah refund requires amount (invoice does not expose remaining)",
        );
      }

      return this.postMyFatoorahRefund({
        invoiceId,
        amount: outboundMajor,
        currency,
        params: p,
        idempotencyKey,
      });
    });
  }

  async getPayment(params: MyFatoorahGetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("getPayment", params, async (p) => {
      const id = this.assertInvoiceId(p.gatewayPaymentId, "getPayment");
      const keyType = p.myfatoorahKeyType ?? "InvoiceId";
      if (keyType !== "InvoiceId" && keyType !== "PaymentId") {
        throw new InvalidRequestError(
          'MyFatoorah myfatoorahKeyType must be "InvoiceId" or "PaymentId"',
        );
      }
      if (keyType === "InvoiceId" && id.length >= 14) {
        throw new InvalidRequestError(
          `MyFatoorah getPayment gatewayPaymentId "${id}" looks like a PaymentId (use myfatoorahKeyType: "PaymentId" for the callback paymentId)`,
        );
      }
      const { data, raw } = await this.myfatoorahRequest(
        "POST",
        "/v2/GetPaymentStatus",
        { Key: id, KeyType: keyType },
        { signal: p.signal, retry: true, postSubmit: false },
      );
      return this.mapGetPaymentResult(data, raw);
    });
  }

  verifyWebhook(
    payload: unknown,
    signature?: string,
    headers?: Record<string, string | string[]>,
  ): boolean {
    const provided = extractMyFatoorahSignatureHeader(signature, headers);
    return verifyMyFatoorahSignature(payload, this.myfatoorahConfig.webhookSecret, provided);
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    const kind = myFatoorahWebhookKind(payload);
    return kind === "payment"
      ? parseMyFatoorahPaymentWebhookEvent(payload)
      : parseMyFatoorahRefundWebhookEvent(payload);
  }

  // ─── HTTP transport ─────────────────────────────────────────────────────

  private async myfatoorahRequest(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    options: {
      signal?: AbortSignal | undefined;
      retry: boolean;
      idempotencyKey?: string;
      /** True for money-mutating calls (create / MakeRefund). */
      postSubmit?: boolean;
      /** Currency for top-level `Amount` ISO padding (MakeRefund). */
      currency?: string;
      isRetryable?: (error: unknown) => boolean;
      /** Return empty data instead of throwing on a 2xx body without Data (inquiries only). */
      allowMissingData?: boolean;
    },
  ): Promise<{ data: Record<string, unknown>; raw: unknown }> {
    if (body !== undefined) assertNoPciCardSource(body);
    const run = () =>
      this.myfatoorahRequestOnce(
        method,
        path,
        body,
        options.signal,
        options.idempotencyKey,
        options.postSubmit === true,
        options.currency,
        options.allowMissingData === true,
      );
    if (options.retry) {
      return withRetry(run, {
        isRetryable: options.isRetryable ?? isMyFatoorahRetryableNetworkError,
      });
    }
    return run();
  }

  private async myfatoorahRequestOnce(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    callerSignal: AbortSignal | undefined,
    idempotencyKey: string | undefined,
    postSubmit: boolean,
    currency: string | undefined,
    allowMissingData: boolean,
  ): Promise<{ data: Record<string, unknown>; raw: unknown }> {
    const timeoutMs = this.myfatoorahConfig.timeoutMs ?? MYFATOORAH_DEFAULT_TIMEOUT_MS;
    const { signal: timeoutSignal, clear } = createTimeoutSignal(timeoutMs);
    const signal = combineAbortSignals(callerSignal, timeoutSignal);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.myfatoorahConfig.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    // Idempotency-Key is only honored in KWT/SAU per https://docs.myfatoorah.com/docs/idempotency.
    // Outside those countries we omit the header entirely to avoid a validation rejection.
    const idempotencySupported =
      this.myfatoorahConfig.country === "KWT" || this.myfatoorahConfig.country === "SAU";
    if (idempotencyKey !== undefined && postSubmit && idempotencySupported) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = stringifyMyFatoorahJsonBody(body, currency);
    }
    if (signal !== undefined) init.signal = signal;

    let response: Response;
    let responseText = "";
    try {
      response = await this.fetch(
        `${resolveMyFatoorahBaseUrl(this.myfatoorahConfig)}${path}`,
        init,
      );
      responseText = await response.text();
    } catch (error) {
      throw mapHttpAbortError(error, {
        callerSignal,
        timeoutSignal,
        timeoutMessage: `MyFatoorah API request timed out after ${timeoutMs}ms`,
        networkMessage: "Failed to reach MyFatoorah API",
        callerAbortMessage: "MyFatoorah API request aborted by caller signal",
        afterProviderSubmit: postSubmit,
      });
    } finally {
      clear();
    }

    let data: unknown = {};
    let jsonParseFailed = false;
    if (responseText.length > 0) {
      try {
        data = JSON.parse(responseText) as unknown;
      } catch {
        jsonParseFailed = true;
      }
    }

    if (!response.ok) {
      throw mapMyFatoorahHttpFailure({
        status: response.status,
        body: jsonParseFailed ? { body: responseText } : data,
        method,
        headers: response.headers,
        postSubmit,
      });
    }

    assertMyFatoorahSuccessEnvelope({
      method,
      status: response.status,
      responseText,
      jsonParseFailed,
      data,
      postSubmit,
    });

    const raw = data;
    const unwrapped = readMyFatoorahData(raw);
    if (unwrapped === undefined) {
      if (allowMissingData && !postSubmit) {
        return { data: {}, raw };
      }
      if (postSubmit) {
        throw new NetworkError(
          "MyFatoorah API returned a 2xx body missing Data",
          { status: response.status, body: raw },
          { afterProviderSubmit: true },
        );
      }
      throw new InvalidRequestError("MyFatoorah API returned a 2xx body missing Data");
    }
    return { data: unwrapped, raw };
  }

  // ─── Create helpers ─────────────────────────────────────────────────────

  private buildCreateBody(params: MyFatoorahCreatePaymentParams): Record<string, unknown> {
    const currency = params.currency.trim().toUpperCase();
    if (currency.length !== 3 || !CURRENCY_CODE.test(currency)) {
      throw new InvalidRequestError(
        `MyFatoorah createPayment currency "${currency}" is not a 3-letter code`,
      );
    }
    const webhookUrl = this.resolveWebhookUrl(params);
    const body: Record<string, unknown> = {
      Order: {
        Amount: this.myfatoorahOutboundMajor(params.amount, currency),
        Currency: currency,
        // Order.ExternalIdentifier is returned as Invoice.ExternalIdentifier in PAYMENT_STATUS_CHANGED webhooks
        // for merchant paymentId correlation (Critical 12) — use orderId here.
        ...(params.orderId !== undefined && params.orderId.trim().length > 0
          ? { ExternalIdentifier: params.orderId.trim() }
          : {}),
      },
      IntegrationUrls: {
        Redirection: params.callbackUrl.trim(),
        ...(webhookUrl !== undefined ? { Webhook: webhookUrl } : {}),
      },
    };
    const method = params.myfatoorahPaymentMethod ?? this.myfatoorahConfig.defaultPaymentMethod;
    if (method !== undefined) {
      assertMyFatoorahPaymentMethod(method);
      body.PaymentMethod = method;
    }
    const customer = this.serializeCustomer(params);
    // Official payment webhook Invoice.ExternalIdentifier is populated from Customer.Reference
    // (CustomerIdentifier). To make `orderId` reliably appear as webhook `paymentId`,
    // we send it as Customer.Reference when no explicit customer reference exists.
    // Keep Order.ExternalIdentifier for back-compat.
    let customerForBody = customer;
    const orderRef = params.orderId !== undefined ? params.orderId.trim() : "";
    if (orderRef.length > 0) {
      if (customerForBody === undefined) {
        customerForBody = { Reference: orderRef };
      } else if (
        typeof customerForBody.Reference !== "string" ||
        (customerForBody.Reference as string).trim().length === 0
      ) {
        customerForBody = { ...customerForBody, Reference: orderRef };
      }
    }
    if (customerForBody !== undefined) body.Customer = customerForBody;
    if (params.myfatoorahLanguage !== undefined) {
      if (params.myfatoorahLanguage !== "EN" && params.myfatoorahLanguage !== "AR") {
        throw new InvalidRequestError('MyFatoorah myfatoorahLanguage must be "EN" or "AR"');
      }
      body.Language = params.myfatoorahLanguage;
    }
    if (
      params.myfatoorahDisplayPaymentMethods !== undefined &&
      params.myfatoorahDisplayPaymentMethods.length > 0
    ) {
      assertMyFatoorahDisplayPaymentMethods(params.myfatoorahDisplayPaymentMethods);
      body.DisplayPaymentMethods = params.myfatoorahDisplayPaymentMethods;
    }
    const sourceOfFund = this.buildSourceOfFund(params);
    if (sourceOfFund !== undefined) body.SourceOfFund = sourceOfFund;
    const metaData = this.toMyFatoorahMetaData(params.metadata);
    if (metaData !== undefined) body.MetaData = metaData;
    return body;
  }

  private resolveWebhookUrl(params: MyFatoorahCreatePaymentParams): string | undefined {
    const override = params.myfatoorahWebhookUrl;
    if (override !== undefined) {
      assertMyFatoorahHttpsUrl(override, "myfatoorahWebhookUrl");
      return override.trim();
    }
    return this.myfatoorahConfig.webhookUrl;
  }

  private serializeCustomer(
    params: MyFatoorahCreatePaymentParams,
  ): Record<string, unknown> | undefined {
    const customer = params.myfatoorahCustomer;
    if (customer !== undefined) {
      const out: Record<string, unknown> = {};
      if (customer.name !== undefined && customer.name.trim().length > 0) {
        out.Name = customer.name.trim();
      }
      if (customer.email !== undefined && customer.email.trim().length > 0) {
        out.Email = customer.email.trim();
      }
      if (customer.mobile !== undefined) {
        out.Mobile = {
          CountryCode: customer.mobile.countryCode,
          Number: customer.mobile.number,
        };
      }
      if (customer.reference !== undefined && customer.reference.trim().length > 0) {
        out.Reference = customer.reference.trim();
      }
      if (customer.civilId !== undefined && customer.civilId.trim().length > 0) {
        out.CivilId = customer.civilId.trim();
      }
      // Avoid emitting empty Customer:{} which provider may reject.
      if (Object.keys(out).length === 0) return undefined;
      return out;
    }
    // Customer.Reference is the webhook paymentId (Invoice.ExternalIdentifier).
    // Per official V3 it must be orderId or explicit myfatoorahCustomer.reference — never customerId.
    // buildCreateBody already injects orderId as Customer.Reference when needed; serializeCustomer
    // therefore must NOT map customerId → Reference. Use sources.ts/resolveMyFatoorahCustomerReference
    // for the canonical priority logic.
    return undefined;
  }

  private customerReferenceForReplay(params: MyFatoorahCreatePaymentParams): string | undefined {
    return resolveMyFatoorahCustomerReference({
      orderId: params.orderId,
      myfatoorahCustomerReference: params.myfatoorahCustomer?.reference,
    });
  }

  private buildSourceOfFund(
    params: MyFatoorahCreatePaymentParams,
  ): Record<string, unknown> | undefined {
    const sessionId = params.myfatoorahSessionId;
    const token = params.myfatoorahToken;
    const hasSession = typeof sessionId === "string" && sessionId.trim().length > 0;
    const hasToken = typeof token === "string" && token.trim().length > 0;
    if (hasSession && hasToken) {
      throw new InvalidRequestError(
        "MyFatoorah createPayment accepts only one of myfatoorahSessionId or myfatoorahToken",
      );
    }
    if (hasSession) return { SessionId: sessionId!.trim() };
    if (hasToken) return { Token: token!.trim() };
    return undefined;
  }

  private toMyFatoorahMetaData(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, string> | undefined {
    if (metadata === undefined) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (!/^UDF[1-5]$/.test(key)) {
        throw new InvalidRequestError(`MyFatoorah metadata keys must be UDF1..UDF5 (got "${key}")`);
      }
      if (typeof value !== "string") {
        throw new InvalidRequestError(`MyFatoorah metadata ${key} must be a string`);
      }
      if (value.length > 0) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private mapCreateResult(
    data: Record<string, unknown>,
    raw: unknown,
    requestCurrency: string,
  ): GatewayPaymentResult {
    const invoiceId = this.requireInvoiceId(data);
    const paymentCompleted = data.PaymentCompleted === true;
    const paymentUrl = typeof data.PaymentURL === "string" ? data.PaymentURL.trim() : "";

    // Official V3 paid body nests Invoice status under TransactionDetails.Invoice.Status
    // (legacy: top-level InvoiceStatus). PaymentCompleted is authoritative per V3 for
    // non-3DS paid completions; nested statuses are only for providerNativeStatus.
    const transactionDetails = asRecord(data.TransactionDetails);
    const legacyInvoiceStatusRaw =
      typeof data.InvoiceStatus === "string" ? data.InvoiceStatus.trim() : "";
    const nestedInvoice = asRecord(transactionDetails.Invoice);
    const invoiceStatusRaw =
      (typeof nestedInvoice.Status === "string" ? nestedInvoice.Status.trim() : "") ||
      legacyInvoiceStatusRaw;

    // MF-PAYMENTCOMPLETED-REDIRECT: PaymentCompleted true is definitive paid evidence
    // even when nested statuses are missing; PaymentURL then is Result URL, not checkout.
    const paidEvidence = paymentCompleted;
    const paymentId = this.paymentIdFromData(data);
    const references = buildProviderReferences({
      gateway: "myfatoorah",
      gatewayId: invoiceId,
      status: paidEvidence ? "paid" : "pending",
      providerNativeStatus: invoiceStatusRaw,
      ...(paymentId !== undefined ? { relatedIds: { paymentId } } : {}),
    });

    const amount = paidEvidence
      ? this.createResultAmount(transactionDetails, requestCurrency)
      : undefined;

    if (paidEvidence) {
      return applyOutcomeToGatewayResult(
        {
          gateway: "myfatoorah",
          gatewayId: invoiceId,
          status: "paid",
          redirectUrl: undefined,
          rawResponse: raw,
          references,
          providerNativeStatus: invoiceStatusRaw,
          ...(amount !== undefined ? { amount } : {}),
          ...(amount !== undefined ? { currency: requestCurrency } : {}),
        },
        "succeeded",
      );
    }

    if (paymentUrl.length > 0) {
      return applyOutcomeToGatewayResult(
        {
          gateway: "myfatoorah",
          gatewayId: invoiceId,
          status: "pending",
          redirectUrl: paymentUrl,
          rawResponse: raw,
          references,
          providerNativeStatus: invoiceStatusRaw,
        },
        "requires_action",
        { action: { type: "redirect" as const, url: paymentUrl } },
      );
    }

    throw new NetworkError(
      "MyFatoorah create response missing PaymentURL and paid evidence",
      { body: raw },
      { afterProviderSubmit: true },
    );
  }

  /** Amount in request currency; picks the matching ValueIn* field by currency. */
  private createResultAmount(
    transactionDetails: Record<string, unknown>,
    currency: string,
  ): number | undefined {
    const amount = asRecord(transactionDetails.Amount);
    const requested = normalizeMyFatoorahCurrency(currency) ?? currency.trim().toUpperCase();
    const payCurrency =
      normalizeMyFatoorahCurrency(amount.PayCurrency) ??
      (typeof amount.PayCurrency === "string"
        ? amount.PayCurrency.trim().toUpperCase()
        : undefined);
    const displayCurrency =
      normalizeMyFatoorahCurrency(amount.DisplayCurrency) ??
      (typeof amount.DisplayCurrency === "string"
        ? amount.DisplayCurrency.trim().toUpperCase()
        : undefined);
    const baseCurrency =
      normalizeMyFatoorahCurrency(amount.BaseCurrency) ??
      (typeof amount.BaseCurrency === "string"
        ? amount.BaseCurrency.trim().toUpperCase()
        : undefined);
    let value: unknown;
    if (
      payCurrency !== undefined &&
      payCurrency === requested &&
      amount.ValueInPayCurrency !== undefined
    ) {
      value = amount.ValueInPayCurrency;
    } else if (
      displayCurrency !== undefined &&
      displayCurrency === requested &&
      amount.ValueInDisplayCurrency !== undefined
    ) {
      value = amount.ValueInDisplayCurrency;
    } else if (
      baseCurrency !== undefined &&
      baseCurrency === requested &&
      amount.ValueInBaseCurrency !== undefined
    ) {
      value = amount.ValueInBaseCurrency;
    } else {
      // MF-CREATE-AMOUNT-FALLBACK: if no ValueIn* currency matched request, omit amount.
      // Do not use bare Value/Amount as request currency — avoids publishing KWD base as SAR, etc.
      return undefined;
    }
    return this.parseMajor(value, currency);
  }

  private paymentIdFromData(data: Record<string, unknown>): string | undefined {
    const td = asRecord(data.TransactionDetails);
    return (
      stringOrNumberId(data.PaymentId) ??
      stringOrNumberId(td.PaymentId) ??
      stringOrNumberId(asRecord(td.Transaction).PaymentId) ??
      stringOrNumberId(asRecord(td.Invoice).PaymentId)
    );
  }

  private requireInvoiceId(data: Record<string, unknown>): string {
    const id = data.InvoiceId;
    if (typeof id === "string" && id.trim().length > 0) return id.trim();
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
    throw new NetworkError(
      "MyFatoorah create response missing InvoiceId",
      { body: data },
      { afterProviderSubmit: true },
    );
  }

  // ─── GetPayment helpers ─────────────────────────────────────────────────

  private mapGetPaymentResult(data: Record<string, unknown>, raw: unknown): GatewayPaymentResult {
    const invoiceId = stringOrNumberId(data.InvoiceId);
    if (invoiceId === undefined) {
      throw new InvalidRequestError("MyFatoorah GetPaymentStatus response missing InvoiceId");
    }
    const invoiceStatusRaw = typeof data.InvoiceStatus === "string" ? data.InvoiceStatus : "";
    const invoiceStatus = mapMyFatoorahInvoiceStatus(invoiceStatusRaw);
    const successTransaction = this.successTransaction(data);

    // A pending invoice stays pending even when the latest transaction
    // failed — the customer can retry the same invoice.
    const status =
      invoiceStatus === "pending"
        ? "pending"
        : invoiceStatus === "paid" && successTransaction !== undefined
          ? "paid"
          : invoiceStatus;

    // Amount: MF-GETPAYMENT-BASE-MIX — never pair InvoiceValue (base) with transaction pay Currency.
    // Prefer PaidCurrency/PaidCurrencyValue, else TransationValue/Currency (transaction Currency), else InvoiceValue with base Currency field.
    let currency: string | undefined;
    let amount: number | undefined;
    if (successTransaction !== undefined) {
      const paidCurrency = normalizeMyFatoorahCurrency(successTransaction.PaidCurrency);
      const paidValue = successTransaction.PaidCurrencyValue;
      if (paidCurrency !== undefined && paidValue !== undefined) {
        const parsedPaid = this.parseMajor(paidValue, paidCurrency);
        if (parsedPaid !== undefined) {
          currency = paidCurrency;
          amount = parsedPaid;
        }
      }
      if (currency === undefined) {
        const txCurrency = normalizeMyFatoorahCurrency(successTransaction.Currency);
        const txValue = successTransaction.TransationValue;
        if (txCurrency !== undefined && txValue !== undefined) {
          const parsedTx = this.parseMajor(txValue, txCurrency);
          if (parsedTx !== undefined) {
            currency = txCurrency;
            amount = parsedTx;
          }
        }
      }
      if (currency === undefined) {
        const invoiceAmount = this.invoiceValue(data);
        if (invoiceAmount !== undefined) {
          const baseCurrency =
            normalizeMyFatoorahCurrency((data as Record<string, unknown>).Currency) ??
            normalizeMyFatoorahCurrency((data as Record<string, unknown>).BaseCurrency) ??
            normalizeMyFatoorahCurrency((data as Record<string, unknown>).InvoiceCurrency) ??
            (this.myfatoorahConfig.live === true
              ? MYFATOORAH_COUNTRY_CURRENCY[this.myfatoorahConfig.country]
              : "KWD");
          // Guard: if PaidCurrency was missing, we must not have already used InvoiceValue+SAR via tier2.
          // Tier2 already handled pay currency via TransationValue, so tier3 uses base only.
          if (baseCurrency !== undefined) {
            const parsedBase = this.parseMajor(invoiceAmount, baseCurrency);
            if (parsedBase !== undefined) {
              currency = baseCurrency;
              amount = parsedBase;
            }
          }
        }
      }
    }
    const transactionPaymentId = this.successTransactionPaymentId(successTransaction);
    const references = buildProviderReferences({
      gateway: "myfatoorah",
      gatewayId: invoiceId,
      status,
      providerNativeStatus: invoiceStatusRaw,
      ...(transactionPaymentId !== undefined
        ? { relatedIds: { paymentId: transactionPaymentId } }
        : {}),
    });

    return applyOutcomeToGatewayResult(
      {
        gateway: "myfatoorah",
        gatewayId: invoiceId,
        status,
        redirectUrl: undefined,
        rawResponse: raw,
        references,
        providerNativeStatus: invoiceStatusRaw,
        ...(amount !== undefined ? { amount } : {}),
        ...(currency !== undefined ? { currency } : {}),
      },
      mapMyFatoorahInvoiceOutcome(status),
    );
  }

  private successTransaction(data: Record<string, unknown>): Record<string, unknown> | undefined {
    const candidates: unknown[] | undefined =
      (Array.isArray(data.InvoiceTransactions) ? data.InvoiceTransactions : undefined) ??
      (Array.isArray(data.Transactions) ? data.Transactions : undefined);
    if (candidates === undefined) return undefined;
    let lastMatch: Record<string, unknown> | undefined;
    for (const transaction of candidates) {
      const rec = asRecord(transaction);
      if (mapMyFatoorahTransactionEvidence(rec.TransactionStatus) === "success") {
        lastMatch = rec;
      }
    }
    return lastMatch;
  }
  private successTransactionPaymentId(
    transaction: Record<string, unknown> | undefined,
  ): string | undefined {
    if (transaction === undefined) return undefined;
    return stringOrNumberId(transaction.PaymentId);
  }

  private invoiceValue(data: Record<string, unknown>): unknown {
    return data.InvoiceValue;
  }

  private parseMajor(value: unknown, currency: string): number | undefined {
    try {
      if (
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.trim().length > 0)
      ) {
        return myFatoorahMajorNumber(parseMyFatoorahAmount(value, currency), currency);
      }
    } catch {
      // Unparseable invoice value: omit amount rather than guess.
    }
    return undefined;
  }

  private refundCurrency(
    params: MyFatoorahRefundParams,
    refundStatus?: Record<string, unknown>,
  ): string {
    // MakeRefund Amount is account base currency (e.g. KWD), not display/pay currency (e.g. SAR).
    // Prefer BaseCurrency from GetRefundStatus RefundStatusResult when available.
    if (refundStatus !== undefined) {
      const baseFromRefund = myFatoorahRefundBaseCurrency(refundStatus);
      const normalizedBase =
        baseFromRefund !== undefined ? normalizeMyFatoorahCurrency(baseFromRefund) : undefined;
      if (normalizedBase !== undefined) {
        const requested = typeof params.currency === "string" ? params.currency.trim() : "";
        if (requested.length > 0) {
          const normReq = normalizeMyFatoorahCurrency(requested) ?? requested.trim().toUpperCase();
          if (normReq !== normalizedBase) {
            throw new InvalidRequestError(
              `MyFatoorah refund currency "${requested}" does not match account base currency "${normalizedBase}" (MakeRefund is base-only; see docs/refunds.md)`,
            );
          }
        }
        return normalizedBase;
      }
    }
    // No BaseCurrency yet (first refund, empty history): the portal country fixes the base currency.
    // Sandbox always KWD (country host is ignored there).
    const inferredBase =
      this.myfatoorahConfig.live === true
        ? MYFATOORAH_COUNTRY_CURRENCY[this.myfatoorahConfig.country]
        : "KWD";
    const requested = typeof params.currency === "string" ? params.currency.trim() : "";
    if (requested.length > 0) {
      const normReq = normalizeMyFatoorahCurrency(requested);
      if (normReq === undefined) {
        throw new InvalidRequestError(
          `MyFatoorah refund currency "${requested}" is not a 3-letter code`,
        );
      }
      if (normReq !== inferredBase) {
        throw new InvalidRequestError(
          `MyFatoorah refund currency "${requested}" does not match account base currency "${inferredBase}" (MakeRefund is base-only; see docs/refunds.md)`,
        );
      }
      return normReq;
    }
    return inferredBase;
  }

  private assertCurrencyMatch(
    requested: string | undefined,
    retrieved: string,
    operation: "refund",
  ): void {
    if (!currenciesMismatch(requested, retrieved)) return;
    throw new InvalidRequestError(
      `MyFatoorah ${operation} currency "${String(requested)}" does not match retrieved currency "${String(retrieved)}"`,
    );
  }
  private async postMyFatoorahRefund(input: {
    invoiceId: string;
    amount: number;
    currency: string;
    params: MyFatoorahRefundParams;
    idempotencyKey: string;
  }): Promise<GatewayRefundResult> {
    const comment = this.refundComment(input.params);
    const body: Record<string, unknown> = {
      KeyType: "InvoiceId",
      Key: input.invoiceId,
      ServiceChargeOnCustomer: false,
      Amount: input.amount,
      ExternalIdentifier: input.idempotencyKey,
      ...(comment !== undefined ? { Comment: comment } : {}),
    };
    const requestOptions = {
      signal: input.params.signal,
      retry: true,
      idempotencyKey: input.idempotencyKey,
      postSubmit: true,
      currency: input.currency,
      isRetryable: isMyFatoorahRetryableBeforeSubmit,
    };
    try {
      const { data, raw } = await this.myfatoorahRequest(
        "POST",
        "/v2/MakeRefund",
        body,
        requestOptions,
      );
      return this.mapMakeRefundResult(data, raw);
    } catch (error) {
      // Contingency: the Idempotency-Key header is only honored in KWT/SAU.
      // On a provider validation rejection elsewhere, retry once without the
      // header; `ExternalIdentifier` still carries the caller key for replay.
      if (!hasMyFatoorahIdempotencyValidationError(error)) throw error;
      const retryWithoutHeader = {
        signal: requestOptions.signal,
        retry: false as const,
        postSubmit: requestOptions.postSubmit,
        currency: requestOptions.currency,
        isRetryable: requestOptions.isRetryable,
      };
      const { data, raw } = await this.myfatoorahRequest(
        "POST",
        "/v2/MakeRefund",
        body,
        retryWithoutHeader,
      );
      return this.mapMakeRefundResult(data, raw);
    }
  }

  private refundComment(params: MyFatoorahRefundParams): string | undefined {
    const raw = params.myfatoorahComment ?? params.reason;
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.length > MYFATOORAH_REFUND_COMMENT_MAX) {
      throw new InvalidRequestError(
        `MyFatoorah refund comment must be ${MYFATOORAH_REFUND_COMMENT_MAX} characters or fewer`,
      );
    }
    return trimmed;
  }

  private mapMakeRefundResult(data: Record<string, unknown>, raw: unknown): GatewayRefundResult {
    const refundId = myFatoorahRefundId(data);
    if (refundId === undefined) {
      throw new NetworkError(
        "MyFatoorah refund response missing RefundId",
        { body: raw },
        { afterProviderSubmit: true },
      );
    }
    // MakeRefund acceptance is never settlement. Completed status arrives via
    // REFUND_STATUS_CHANGED or GetRefundStatus `Refunded`.
    return applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: refundId,
        status: "pending",
        rawResponse: raw,
      },
      "pending",
    );
  }

  private mapNestedRefundObject(raw: unknown): GatewayRefundResult {
    const refundId = myFatoorahRefundId(raw);
    if (refundId === undefined) {
      throw new InvalidRequestError("MyFatoorah refund object missing RefundId");
    }
    const entityStatus = mapMyFatoorahRefundEntityStatus(myFatoorahRefundStatus(raw));
    const outcome =
      entityStatus === "completed"
        ? "succeeded"
        : entityStatus === "pending"
          ? "pending"
          : "failed";
    return applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: refundId,
        status: entityStatus,
        rawResponse: raw,
      },
      outcome,
    );
  }

  // ─── Shared validation helpers ──────────────────────────────────────────

  private myfatoorahOutboundMajor(
    amount: Parameters<typeof myFatoorahMajorNumber>[0],
    currency: string,
  ): number {
    const major = myFatoorahMajorNumber(amount, currency);
    if (major === 0) {
      throw new InvalidRequestError("MyFatoorah amount must be greater than 0");
    }
    return major;
  }

  private assertMutationKey(key: string | undefined, operation: string): string {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new InvalidRequestError(`MyFatoorah ${operation} requires idempotencyKey`);
    }
    return key.trim();
  }

  private assertInvoiceId(id: string, operation: string): string {
    const trimmed = id.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new InvalidRequestError(
        `MyFatoorah ${operation} expects an InvoiceId (digits) as gatewayPaymentId (got "${id}")`,
      );
    }
    return trimmed;
  }
}
