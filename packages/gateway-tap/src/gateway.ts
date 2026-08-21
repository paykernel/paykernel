import {
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  attachPaymentEvent,
  BaseGateway,
  buildProviderReferences,
  combineAbortSignals,
  createTimeoutSignal,
  hashWebhookPayload,
  InvalidRequestError,
  mapHttpAbortError,
  withRetry,
  type CaptureParams,
  type CreatePaymentParams,
  type GatewayPaymentResult,
  type GatewayRefundResult,
  type GatewayRuntimeDeps,
  type GetPaymentParams,
  type HooksManager,
  type Logger,
  type RefundParams,
  type VoidParams,
  type WebhookEvent,
} from "@paykernel/core";
import { TAP_CAPABILITIES } from "./capabilities";
import {
  TAP_API_BASE_URL,
  TAP_DEFAULT_TIMEOUT_MS,
  type TapConfig,
} from "./config";
import {
  assertTapSuccessBody,
  isMutatingMethod,
  isTapRetryableError,
  mapTapHttpFailure,
  tapResponseCode,
} from "./http";
import { parseTapAmount, tapMajorNumber } from "./money";
import { assertNoPciCardSource, resolveTapSourceId } from "./sources";
import {
  inferTapStableType,
  isTapDeclineStatus,
  mapTapChargeOutcome,
  mapTapChargeStatus,
  mapTapRefundEntityStatus,
  mapTapRefundPaymentStatus,
} from "./status";
import type {
  TapApiObject,
  TapCreatePaymentParams,
  TapCustomerInput,
  TapRefundReason,
} from "./types";
import {
  extractHashstringHeader,
  tapCreatedRaw,
  tapObjectKind,
  verifyTapHashstring,
} from "./webhooks";

const TAP_REFUND_REASONS = new Set<TapRefundReason>([
  "duplicate",
  "fraudulent",
  "requested_by_customer",
]);

export class TapGateway extends BaseGateway {
  readonly name = "tap" as const;
  private readonly tapConfig: TapConfig;

  constructor(
    config: TapConfig,
    hooks: HooksManager,
    logger?: Logger,
    runtime?: GatewayRuntimeDeps,
  ) {
    super(config, hooks, logger, TAP_CAPABILITIES, runtime);
    this.tapConfig = config;
  }

  async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      const capture = p.capture !== false;
      const tap = this.readTapCreate(p);
      const idempotencyKey = this.createIdempotencyKey(p.idempotencyKey);
      const body = this.buildCreateBody(p, tap, idempotencyKey);
      const path = capture ? "/charges" : "/authorize";
      const raw = await this.tapRequest("POST", path, body, {
        signal: p.signal,
        retry: true,
      });
      return this.mapPaymentObject(raw, capture ? "charge" : "authorize");
    });
  }

  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async (p) => {
      this.assertMutationKey(p.idempotencyKey, "capturePayment");
      const authorizeId = this.assertIdPrefix(p.gatewayPaymentId, "auth_");
      const existing = await this.tapRequest("GET", `/authorize/${authorizeId}`, undefined, {
        signal: p.signal,
        retry: true,
      });
      const currency =
        p.currency ??
        (typeof (existing as TapApiObject).currency === "string"
          ? ((existing as TapApiObject).currency as string)
          : undefined);
      if (currency === undefined || currency.length === 0) {
        throw new InvalidRequestError(
          "Tap capture requires currency (pass CaptureParams.currency or retrieve it from the authorize object)",
        );
      }
      const amount =
        p.amount !== undefined
          ? tapMajorNumber(p.amount, currency)
          : tapMajorNumber(
              parseTapAmount((existing as TapApiObject).amount, currency),
              currency,
            );
      const customer = this.customerFromObject(existing);
      const body: Record<string, unknown> = {
        amount,
        currency: currency.toUpperCase(),
        source: { id: authorizeId },
        reference: { idempotent: p.idempotencyKey },
      };
      if (customer !== undefined) body.customer = customer;
      const raw = await this.tapRequest("POST", "/charges", body, {
        signal: p.signal,
        retry: true,
      });
      return this.mapPaymentObject(raw, "charge");
    });
  }

  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      this.assertMutationKey(p.idempotencyKey, "voidPayment");
      const authorizeId = this.assertIdPrefix(p.gatewayPaymentId, "auth_");
      const raw = await this.tapRequest(
        "POST",
        `/authorize/${authorizeId}/void`,
        { reference: { idempotent: p.idempotencyKey } },
        { signal: p.signal, retry: true },
      );
      return this.mapPaymentObject(raw, "authorize");
    });
  }

  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      this.assertMutationKey(p.idempotencyKey, "refundPayment");
      const chargeId = this.assertIdPrefix(p.gatewayPaymentId, "chg_");
      const existing = await this.tapRequest("GET", `/charges/${chargeId}`, undefined, {
        signal: p.signal,
        retry: true,
      });
      const currency =
        p.currency ??
        (typeof (existing as TapApiObject).currency === "string"
          ? ((existing as TapApiObject).currency as string)
          : undefined);
      if (currency === undefined || currency.length === 0) {
        throw new InvalidRequestError(
          "Tap refund requires currency (pass RefundParams.currency or retrieve it from the charge)",
        );
      }
      const amount =
        p.amount !== undefined
          ? tapMajorNumber(p.amount, currency)
          : tapMajorNumber(
              parseTapAmount((existing as TapApiObject).amount, currency),
              currency,
            );
      const reason = this.refundReason(p);
      const body: Record<string, unknown> = {
        charge_id: chargeId,
        amount,
        currency: currency.toUpperCase(),
        reason,
        reference: { idempotent: p.idempotencyKey },
      };
      const metadata = this.toTapMetadata(p.metadata);
      if (metadata !== undefined) body.metadata = metadata;
      const raw = await this.tapRequest("POST", "/refunds", body, {
        signal: p.signal,
        retry: true,
      });
      return this.mapRefundObject(raw);
    });
  }

  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("getPayment", params, async (p) => {
      const id = p.gatewayPaymentId;
      const kind = this.kindFromId(id);
      const path = kind === "authorize" ? `/authorize/${id}` : `/charges/${id}`;
      const raw = await this.tapRequest("GET", path, undefined, {
        signal: p.signal,
        retry: true,
      });
      return this.mapPaymentObject(raw, kind);
    });
  }

  verifyWebhook(
    payload: unknown,
    signature?: string,
    headers?: Record<string, string>,
  ): boolean {
    const provided = extractHashstringHeader(signature, headers);
    return verifyTapHashstring(payload, this.tapConfig.secretKey, provided);
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    const kind = tapObjectKind(payload);
    const obj = payload as TapApiObject;
    const id = this.requireString(obj.id, "id");
    const currency =
      typeof obj.currency === "string" ? obj.currency.toUpperCase() : undefined;
    const tapStatus = typeof obj.status === "string" ? obj.status : "";
    const status =
      kind === "refund"
        ? mapTapRefundPaymentStatus(tapStatus)
        : mapTapChargeStatus(tapStatus);
    const chargeId =
      kind === "refund" && typeof obj.charge_id === "string"
        ? obj.charge_id
        : id;
    let amount: number | undefined;
    if (obj.amount !== undefined && currency !== undefined) {
      amount = tapMajorNumber(parseTapAmount(obj.amount, currency), currency);
    }
    const liveMode = typeof obj.live_mode === "boolean" ? obj.live_mode : undefined;
    const apiVersion =
      typeof obj.api_version === "string" ? obj.api_version : undefined;
    const paymentId = this.metadataPaymentId(obj);
    const nativeType = `${kind}.${tapStatus}`;
    const stable = inferTapStableType(kind, status);
    const createdRaw = tapCreatedRaw(obj);
    if (createdRaw === undefined) {
      throw new InvalidRequestError("Tap webhook missing created timestamp");
    }
    const created = this.webhookTimestamp(createdRaw);

    const legacy: WebhookEvent = {
      id,
      type: stable ?? nativeType,
      gateway: "tap",
      paymentId,
      gatewayPaymentId: chargeId,
      status,
      timestamp: created,
      rawPayload: payload,
    };
    if (kind === "refund") legacy.gatewayObjectId = id;
    if (amount !== undefined) legacy.amount = amount;
    if (currency !== undefined) legacy.currency = currency;
    if (liveMode !== undefined) legacy.livemode = liveMode;
    if (apiVersion !== undefined) legacy.apiVersion = apiVersion;

    const attached = attachPaymentEvent(legacy);
    const provider = attached.provider
      ? { ...attached.provider, eventType: nativeType }
      : attached.provider;
    const nested = attached.event
      ? {
          ...attached.event,
          provider: { ...attached.event.provider, eventType: nativeType },
        }
      : attached.event;
    return {
      ...attached,
      type: nativeType,
      ...(provider !== undefined ? { provider } : {}),
      ...(nested !== undefined ? { event: nested } : {}),
      payloadHash: hashWebhookPayload({
        id,
        object: kind,
        status: tapStatus,
        created: createdRaw,
      }),
    };
  }

  private async tapRequest(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    options: { signal?: AbortSignal | undefined; retry: boolean },
  ): Promise<unknown> {
    if (body !== undefined) assertNoPciCardSource(body);
    const run = () => this.tapRequestOnce(method, path, body, options.signal);
    if (options.retry) {
      return withRetry(run, { isRetryable: isTapRetryableError });
    }
    return run();
  }

  private async tapRequestOnce(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    callerSignal?: AbortSignal | undefined,
  ): Promise<unknown> {
    const timeoutMs = this.tapConfig.timeoutMs ?? TAP_DEFAULT_TIMEOUT_MS;
    const { signal: timeoutSignal, clear } = createTimeoutSignal(timeoutMs);
    const signal = combineAbortSignals(callerSignal, timeoutSignal);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tapConfig.secretKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined && isMutatingMethod(method)) {
      init.body = JSON.stringify(body);
    }
    if (signal !== undefined) init.signal = signal;

    let response: Response;
    let responseText = "";
    try {
      response = await this.fetch(`${TAP_API_BASE_URL}${path}`, init);
      responseText = await response.text();
    } catch (error) {
      throw mapHttpAbortError(error, {
        callerSignal,
        timeoutSignal,
        timeoutMessage: `Tap API request timed out after ${timeoutMs}ms`,
        networkMessage: "Failed to reach Tap API",
        callerAbortMessage: "Tap API request aborted by caller signal",
        afterProviderSubmit: isMutatingMethod(method),
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
      throw mapTapHttpFailure({
        status: response.status,
        body: jsonParseFailed ? { body: responseText } : data,
        method,
        headers: response.headers,
      });
    }

    assertTapSuccessBody({
      method,
      status: response.status,
      responseText,
      jsonParseFailed,
      data,
    });
    return data;
  }

  private mapPaymentObject(
    raw: unknown,
    kind: "charge" | "authorize",
  ): GatewayPaymentResult {
    if (raw === null || typeof raw !== "object") {
      throw new InvalidRequestError("Tap payment response must be an object");
    }
    const obj = raw as TapApiObject;
    const id = this.requireString(obj.id, "id");
    const tapStatus = typeof obj.status === "string" ? obj.status : "UNKNOWN";
    const status = mapTapChargeStatus(tapStatus);
    const currency =
      typeof obj.currency === "string" ? obj.currency.toUpperCase() : undefined;
    const redirectUrl = this.redirectUrl(obj);
    const outcome = mapTapChargeOutcome(tapStatus, status, redirectUrl);
    let amount: number | undefined;
    if (obj.amount !== undefined && currency !== undefined) {
      amount = tapMajorNumber(parseTapAmount(obj.amount, currency), currency);
    }
    const code = tapResponseCode(obj);
    const declineMessage =
      typeof (obj.response as { message?: unknown } | undefined)?.message ===
      "string"
        ? (obj.response as { message: string }).message
        : tapStatus;
    const isDecline =
      isTapDeclineStatus(tapStatus) ||
      code === "505" ||
      (code !== undefined && code.startsWith("50"));
    const decline = isDecline
      ? {
          code: code ?? tapStatus,
          message: declineMessage,
          ...(code !== undefined ? { providerCode: code } : {}),
        }
      : undefined;

    const references = buildProviderReferences({
      gateway: "tap",
      gatewayId: id,
      status,
      providerNativeStatus: tapStatus,
      ...(kind === "authorize" ? { authorizationId: id } : {}),
      ...(kind === "charge" ? { chargeId: id } : {}),
    });

    const extras =
      decline !== undefined && outcome === "declined"
        ? {
            decline,
            ...(redirectUrl !== undefined
              ? { action: { type: "redirect" as const, url: redirectUrl } }
              : {}),
          }
        : redirectUrl !== undefined
          ? { action: { type: "redirect" as const, url: redirectUrl } }
          : undefined;

    const result = applyOutcomeToGatewayResult(
      {
        gateway: "tap",
        gatewayId: id,
        status,
        redirectUrl,
        rawResponse: raw,
        references,
        ...(amount !== undefined ? { amount } : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(kind === "authorize" ? { authorizationId: id } : {}),
        providerNativeStatus: tapStatus,
      },
      outcome === "declined" ? "declined" : outcome,
      extras,
    );
    if (redirectUrl !== undefined && result.nextAction === undefined) {
      result.nextAction = { type: "redirect", url: redirectUrl };
    }
    return result;
  }

  private mapRefundObject(raw: unknown): GatewayRefundResult {
    if (raw === null || typeof raw !== "object") {
      throw new InvalidRequestError("Tap refund response must be an object");
    }
    const obj = raw as TapApiObject;
    const id = this.requireString(obj.id, "id");
    const tapStatus = typeof obj.status === "string" ? obj.status : "UNKNOWN";
    const status = mapTapRefundEntityStatus(tapStatus);
    const outcome =
      status === "completed"
        ? "succeeded"
        : status === "pending"
          ? "pending"
          : "failed";
    const currency =
      typeof obj.currency === "string" ? obj.currency.toUpperCase() : undefined;
    let totalRefunded: number | undefined;
    if (obj.amount !== undefined && currency !== undefined) {
      totalRefunded = tapMajorNumber(parseTapAmount(obj.amount, currency), currency);
    }
    return applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: id,
        status,
        rawResponse: raw,
        ...(totalRefunded !== undefined ? { totalRefunded } : {}),
      },
      outcome,
    );
  }

  private buildCreateBody(
    params: CreatePaymentParams,
    tap: {
      customer: TapCustomerInput;
      sourceId: string;
      postUrl: string | undefined;
      threeDSecure: boolean;
      merchantId: string | undefined;
    },
    idempotencyKey: string,
  ): Record<string, unknown> {
    const currency = params.currency.toUpperCase();
    const body: Record<string, unknown> = {
      amount: tapMajorNumber(params.amount, currency),
      currency,
      customer_initiated: true,
      threeDSecure: tap.threeDSecure,
      customer: this.serializeCustomer(tap.customer),
      source: { id: tap.sourceId },
      redirect: { url: params.callbackUrl },
      reference: {
        idempotent: idempotencyKey,
        ...(params.orderId !== undefined ? { order: params.orderId } : {}),
      },
    };
    if (params.description !== undefined) body.description = params.description;
    const metadata = this.toTapMetadata(params.metadata);
    if (metadata !== undefined) body.metadata = metadata;
    if (tap.postUrl !== undefined) body.post = { url: tap.postUrl };
    if (tap.merchantId !== undefined) body.merchant = { id: tap.merchantId };
    return body;
  }

  private readTapCreate(params: CreatePaymentParams): {
    customer: TapCustomerInput;
    sourceId: string;
    postUrl: string | undefined;
    threeDSecure: boolean;
    merchantId: string | undefined;
  } {
    const extra = params as CreatePaymentParams & TapCreatePaymentParams;
    if (typeof extra.callbackUrl !== "string" || extra.callbackUrl.trim().length === 0) {
      throw new InvalidRequestError("Tap createPayment requires callbackUrl");
    }
    const customer = extra.tapCustomer ??
      (typeof extra.customerId === "string" && extra.customerId.length > 0
        ? { id: extra.customerId }
        : undefined);
    if (customer === undefined) {
      throw new InvalidRequestError(
        "Tap createPayment requires tapCustomer or customerId",
      );
    }
    const sourceId = resolveTapSourceId(extra.tapSource);
    const postUrl = extra.tapPostUrl ?? this.tapConfig.webhookUrl;
    const threeDSecure = extra.tapThreeDSecure !== false;
    const merchantId = extra.tapMerchantId ?? this.tapConfig.merchantId;
    return { customer, sourceId, postUrl, threeDSecure, merchantId };
  }

  private serializeCustomer(customer: TapCustomerInput): Record<string, unknown> {
    if ("id" in customer && customer.id.length > 0) {
      return { id: customer.id };
    }
    if ("firstName" in customer) {
      const out: Record<string, unknown> = {
        first_name: customer.firstName,
        email: customer.email,
      };
      if (customer.lastName !== undefined) out.last_name = customer.lastName;
      if (customer.middleName !== undefined) out.middle_name = customer.middleName;
      if (customer.phone !== undefined) {
        out.phone = {
          country_code: customer.phone.countryCode,
          number: customer.phone.number,
        };
      }
      return out;
    }
    throw new InvalidRequestError("Tap customer requires id or firstName+email");
  }

  private customerFromObject(raw: unknown): Record<string, unknown> | undefined {
    if (raw === null || typeof raw !== "object") return undefined;
    const customer = (raw as TapApiObject).customer;
    if (customer !== null && typeof customer === "object" && !Array.isArray(customer)) {
      const id = (customer as { id?: unknown }).id;
      if (typeof id === "string" && id.length > 0) return { id };
    }
    return undefined;
  }

  private toTapMetadata(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, string> | undefined {
    if (metadata === undefined) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined) continue;
      if (value !== null && typeof value === "object") {
        throw new InvalidRequestError(
          "Tap metadata values must be scalar strings, numbers, or booleans",
        );
      }
      out[key] = String(value);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private createIdempotencyKey(provided: string | undefined): string {
    if (typeof provided === "string" && provided.trim().length > 0) {
      return provided;
    }
    const minted = this.runtime.randomUUID();
    this.logger.warn(
      "[Tap] createPayment minted an ephemeral idempotencyKey for in-process retry only; supply a stable key to retry after process crash",
    );
    return minted;
  }

  private assertMutationKey(key: string | undefined, operation: string): void {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new InvalidRequestError(`Tap ${operation} requires idempotencyKey`);
    }
  }

  private assertIdPrefix(id: string, prefix: string): string {
    if (!id.startsWith(prefix)) {
      throw new InvalidRequestError(
        `Tap expected an id starting with ${prefix} (got "${id}")`,
      );
    }
    return id;
  }

  private kindFromId(id: string): "charge" | "authorize" {
    if (id.startsWith("auth_")) return "authorize";
    if (id.startsWith("chg_")) return "charge";
    throw new InvalidRequestError(
      `Tap getPayment expected chg_… or auth_… (got "${id}")`,
    );
  }

  private refundReason(params: RefundParams): TapRefundReason {
    const extra = params as RefundParams & { tapReason?: TapRefundReason };
    if (extra.tapReason !== undefined && TAP_REFUND_REASONS.has(extra.tapReason)) {
      return extra.tapReason;
    }
    const reason = params.reason?.trim().toLowerCase().replace(/ /g, "_");
    if (reason === "duplicate" || reason === "fraudulent") return reason;
    if (reason === "requested_by_customer") return reason;
    return "requested_by_customer";
  }

  private redirectUrl(obj: TapApiObject): string | undefined {
    const tx = obj.transaction;
    if (tx !== null && typeof tx === "object" && !Array.isArray(tx)) {
      const url = (tx as { url?: unknown }).url;
      if (typeof url === "string" && url.length > 0) return url;
    }
    const redirect = obj.redirect;
    if (redirect !== null && typeof redirect === "object" && !Array.isArray(redirect)) {
      const url = (redirect as { url?: unknown }).url;
      if (typeof url === "string" && url.length > 0) return url;
    }
    return undefined;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new InvalidRequestError(`Tap response missing ${field}`);
    }
    return value;
  }

  private metadataPaymentId(obj: TapApiObject): string | undefined {
    const metadata = (obj as { metadata?: unknown }).metadata;
    if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
      const rec = metadata as Record<string, unknown>;
      for (const key of ["paymentId", "orderId", "udf1"]) {
        const value = rec[key];
        if (typeof value === "string" && value.length > 0) return value;
      }
    }
    const reference = obj.reference;
    if (reference !== null && typeof reference === "object") {
      const order = (reference as { order?: unknown }).order;
      if (typeof order === "string" && order.length > 0) return order;
    }
    return undefined;
  }

  private webhookTimestamp(createdRaw: string): Date {
    const asNumber = Number(createdRaw);
    if (!Number.isFinite(asNumber) || asNumber <= 0) {
      throw new InvalidRequestError("Tap webhook created timestamp is not a unix time");
    }
    // Tap charge/authorize samples use millisecond unix strings (13 digits).
    // Values below 1e12 are treated as seconds so Date is not 1970.
    const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    return new Date(ms);
  }
}
