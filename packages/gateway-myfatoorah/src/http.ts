import {
  AuthenticationError,
  GatewayApiError,
  InvalidRequestError,
  NetworkError,
  RateLimitError,
  ResourceNotFoundError,
  parseRetryAfterSeconds,
} from "@paykernel/core";

export function isMutatingMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

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

/** Read the envelope `Data` object, or undefined when missing / unusable. */
export function readMyFatoorahData(body: unknown): Record<string, unknown> | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const data = (body as Record<string, unknown>).Data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
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
    postSubmit === true ? true : postSubmit === false ? false : isMutatingMethod(method);
  const message = myFatoorahValidationMessage(body) ?? `MyFatoorah API error (${status})`;
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
  return new GatewayApiError(message, "myfatoorah", raw);
}

export function isMyFatoorahRetryableError(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RateLimitError;
}

/**
 * Retry predicate for mutations the provider does **not** deduplicate
 * (MakeRefund): excludes post-submit `NetworkError` so a timeout after the
 * provider accepted the refund is reconciled, not re-POSTed.
 */
export function isMyFatoorahRetryableBeforeSubmit(error: unknown): boolean {
  return (
    isMyFatoorahRetryableError(error) &&
    !(error instanceof NetworkError && error.afterProviderSubmit === true)
  );
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
    input.postSubmit === true
      ? true
      : input.postSubmit === false
        ? false
        : isMutatingMethod(input.method);
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
    const message =
      myFatoorahValidationMessage(input.data) ?? "MyFatoorah API returned IsSuccess false";
    throw new InvalidRequestError(message, [raw]);
  }
}
