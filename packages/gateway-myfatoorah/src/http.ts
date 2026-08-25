import {
  AuthenticationError,
  GatewayApiError,
  InvalidRequestError,
  NetworkError,
  PaymentAbortedError,
  RateLimitError,
  ResourceNotFoundError,
  parseRetryAfterSeconds,
} from "@paykernel/core";

/** `IsSuccess` is success when boolean true or case-insensitive string "true". */
export function myFatoorahIsSuccess(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const value = (body as Record<string, unknown>).IsSuccess;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }
  return false;
}

export function myFatoorahValidationErrors(
  body: unknown,
): Array<Record<string, unknown>> | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const rec = body as Record<string, unknown>;
  const errors = rec.ValidationErrors ?? rec.FieldsErrors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const entry of errors) {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      out.push(entry as Record<string, unknown>);
    }
  }
  return out.length > 0 ? out : undefined;
}

export function myFatoorahValidationMessage(body: unknown): string | undefined {
  const errors = myFatoorahValidationErrors(body);
  if (errors === undefined) return undefined;
  const parts: string[] = [];
  for (const entry of errors) {
    const name = typeof entry.Name === "string" ? entry.Name.trim() : "";
    const error = typeof entry.Error === "string" ? entry.Error.trim() : "";
    const text =
      name.length > 0 && error.length > 0 ? `${name}: ${error}` : name.length > 0 ? name : error;
    if (text.length > 0) parts.push(text);
  }
  if (parts.length === 0) return "MyFatoorah validation error";
  return parts.join("; ");
}

function myFatoorahEnvelopeMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const message = (body as Record<string, unknown>).Message;
  if (typeof message !== "string") return undefined;
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isOfficialInquiryNotFoundMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\.+$/, "");
  if (
    normalized === "not found" ||
    normalized === "no invoice" ||
    normalized === "no data" ||
    normalized === "invoice not found"
  ) {
    return true;
  }
  return (
    normalized.includes("no data matches this key") ||
    normalized.includes("no invoices match") ||
    normalized.includes("no invoice found")
  );
}

/**
 * Official GetPaymentStatus “no invoice yet” on HTTP 2xx: IsSuccess false,
 * no ValidationErrors, empty Data, and a not-found Message. Generic
 * IsSuccess-false must not be treated as empty — that would create.
 */
export function isMyFatoorahInquiryNotFoundBody(body: unknown): boolean {
  if (myFatoorahIsSuccess(body)) return false;
  if (myFatoorahValidationErrors(body) !== undefined) return false;
  const message = myFatoorahEnvelopeMessage(body);
  if (message === undefined || !isOfficialInquiryNotFoundMessage(message)) {
    return false;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const data = (body as Record<string, unknown>).Data;
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  const invoiceId = rec.InvoiceId;
  if (typeof invoiceId === "string" && invoiceId.trim().length > 0) return false;
  if (typeof invoiceId === "number" && Number.isFinite(invoiceId)) return false;
  return Object.keys(rec).length === 0;
}

function myFatoorahFailureMessage(body: unknown, fallback: string): string {
  return myFatoorahValidationMessage(body) ?? myFatoorahEnvelopeMessage(body) ?? fallback;
}

/** Read the envelope `Data` object, or undefined when missing / unusable. */
export function readMyFatoorahData(body: unknown): Record<string, unknown> | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const data = (body as Record<string, unknown>).Data;
  if (data === null || data === undefined) {
    return undefined;
  }
  if (Array.isArray(data)) {
    return { RefundStatusResult: data };
  }
  if (typeof data !== "object") {
    return undefined;
  }
  return data as Record<string, unknown>;
}

export function mapMyFatoorahHttpFailure(input: {
  status: number;
  body: unknown;
  method: string;
  headers?: Headers;
  /** True only for money-mutating calls (/v3/payments, /v2/MakeRefund). Inquiries must be false. */
  postSubmit?: boolean;
}): Error {
  const { status, body, method, headers, postSubmit } = input;
  const isPostSubmit =
    postSubmit === true ? true : postSubmit === false ? false : false;
  const message = myFatoorahFailureMessage(body, `MyFatoorah API error (${status})`);
  const raw = { status, body };

  if (status === 429) {
    const retryAfter = parseRetryAfterSeconds(headers);
    return retryAfter !== undefined
      ? new RateLimitError("myfatoorah", retryAfter)
      : new RateLimitError("myfatoorah");
  }
  // HTTP 5xx is classified before body codes.
  if (status >= 500) {
    return new NetworkError(message, raw, isPostSubmit ? { afterProviderSubmit: true } : undefined);
  }
  if (status === 401 || status === 403) {
    return new AuthenticationError(message, raw);
  }
  if (status === 404) {
    return new ResourceNotFoundError(message, raw);
  }
  if (!myFatoorahIsSuccess(body) && myFatoorahValidationErrors(body) !== undefined) {
    return new InvalidRequestError(message, [raw]);
  }
  if (!myFatoorahIsSuccess(body) && status >= 400 && status < 500) {
    return new InvalidRequestError(message, [raw]);
  }
  return new GatewayApiError(message, "myfatoorah", raw);
}

export function isMyFatoorahRetryableError(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RateLimitError;
}

/**
 * Retry predicate for unkeyed mutations (create outside KWT/SAU, MakeRefund).
 * Only a pre-send `NetworkError` without a caller abort is retryable.
 * `RateLimitError`, post-submit `NetworkError`, and caller aborts are not —
 * the POST already left the process or the caller cancelled it.
 * Inquiries still use {@link isMyFatoorahRetryableError} (429 retry is correct).
 * Mirrors `isMyFatoorahRetryableNetworkError` in `gateway.ts`.
 */
export function isMyFatoorahRetryableBeforeSubmit(error: unknown): boolean {
  if (error instanceof PaymentAbortedError) return false;
  if (error instanceof NetworkError) {
    if (error.afterProviderSubmit === true) return false;
    if (error.message.toLowerCase().includes("aborted by caller")) return false;
    return true;
  }
  return false;
}

/**
 * HTTP 2xx body must be a JSON object with `IsSuccess` true. Empty / HTML /
 * null / array are unusable. `IsSuccess` false on 2xx is a business failure
 * (definitive, mapped like other client errors) — never success.
 */
export function assertMyFatoorahSuccessEnvelope(input: {
  method: string;
  status: number;
  responseText: string;
  jsonParseFailed: boolean;
  data: unknown;
  /** True only for money-mutating calls. Inquiries must be false. */
  postSubmit?: boolean;
}): void {
  const isPostSubmit =
    input.postSubmit === true ? true : input.postSubmit === false ? false : false;
  const tag = isPostSubmit ? ({ afterProviderSubmit: true } as const) : undefined;
  const raw = { status: input.status, body: input.responseText };
  if (input.jsonParseFailed) {
    throw new NetworkError("MyFatoorah API returned invalid JSON", raw, tag);
  }
  if (input.responseText.trim().length === 0) {
    throw new NetworkError("MyFatoorah API returned an empty response", raw, tag);
  }
  if (input.data === null || typeof input.data !== "object" || Array.isArray(input.data)) {
    throw new NetworkError("MyFatoorah API returned an unusable JSON body", raw, tag);
  }
  if (!myFatoorahIsSuccess(input.data)) {
    if (isPostSubmit !== true && isMyFatoorahInquiryNotFoundBody(input.data)) {
      throw new ResourceNotFoundError(
        myFatoorahFailureMessage(input.data, "MyFatoorah API returned IsSuccess false"),
        raw,
      );
    }
    const message = myFatoorahFailureMessage(
      input.data,
      "MyFatoorah API returned IsSuccess false",
    );
    throw new InvalidRequestError(message, [raw]);
  }
}
