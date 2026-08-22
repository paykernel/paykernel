import {
  AuthenticationError,
  CardDeclinedError,
  GatewayApiError,
  InsufficientFundsError,
  InvalidRequestError,
  NetworkError,
  RateLimitError,
  ResourceNotFoundError,
  parseRetryAfterSeconds,
} from "@paykernel/core";

export type TapErrorBody = {
  errors?: Array<{ code?: unknown; description?: unknown }>;
};

const NOT_FOUND_CODES = new Set(["1144", "1115", "1160", "1106", "2102"]);
const AUTH_CODES = new Set(["2104", "2106", "2105", "2107", "1101"]);
const AMOUNT_CODES = new Set(["1150", "1161", "1117"]);
const DECLINE_CODES = new Set([
  "501",
  "502",
  "503",
  "504",
  "506",
  "507",
  "508",
  "509",
  "510",
  "511",
  "512",
  "513",
  "514",
  "515",
  "516",
]);

export function isMutatingMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

export function tapErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const errors = (body as TapErrorBody).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const code = errors[0]?.code;
  return typeof code === "string" || typeof code === "number"
    ? String(code)
    : undefined;
}

export function tapErrorDescription(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const errors = (body as TapErrorBody).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const description = errors[0]?.description;
  return typeof description === "string" ? description : undefined;
}

export function mapTapHttpFailure(input: {
  status: number;
  body: unknown;
  method: string;
  headers?: Headers;
}): Error {
  const { status, body, method, headers } = input;
  const code = tapErrorCode(body);
  const message = tapErrorDescription(body) ?? `Tap API error (${status})`;
  const mutating = isMutatingMethod(method);
  const raw = { status, body, code };

  if (status === 429) {
    const retryAfter = parseRetryAfterSeconds(headers);
    return retryAfter !== undefined
      ? new RateLimitError("tap", retryAfter)
      : new RateLimitError("tap");
  }
  if (status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
    return new AuthenticationError(message, raw);
  }
  if (status === 404 || (code !== undefined && NOT_FOUND_CODES.has(code))) {
    return new ResourceNotFoundError(message, raw);
  }
  if (code !== undefined && AMOUNT_CODES.has(code)) {
    return new InvalidRequestError(message);
  }
  if (code === "505") {
    return new InsufficientFundsError(message, raw);
  }
  if (code !== undefined && DECLINE_CODES.has(code)) {
    return new CardDeclinedError(message, raw);
  }
  if (status >= 500 || code === "2101" || code === "9999" || code === "1151") {
    return new NetworkError(message, raw, mutating ? { afterProviderSubmit: true } : undefined);
  }
  return new GatewayApiError(message, "tap", raw);
}

export function isTapRetryableError(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RateLimitError;
}

/**
 * HTTP 2xx body must be a JSON object. Empty / HTML / null / array are not a
 * charge. Mutating 2xx is post-submit unknown (`afterProviderSubmit`).
 */
export function assertTapSuccessBody(input: {
  method: string;
  status: number;
  responseText: string;
  jsonParseFailed: boolean;
  data: unknown;
}): void {
  const mutating = isMutatingMethod(input.method);
  const tag = mutating ? ({ afterProviderSubmit: true } as const) : undefined;
  const raw = { status: input.status, body: input.responseText };
  if (input.jsonParseFailed) {
    throw new NetworkError("Tap API returned invalid JSON", raw, tag);
  }
  if (input.responseText.trim().length === 0) {
    throw new NetworkError("Tap API returned an empty response", raw, tag);
  }
  if (
    input.data === null ||
    typeof input.data !== "object" ||
    Array.isArray(input.data)
  ) {
    throw new NetworkError("Tap API returned an unusable JSON body", raw, tag);
  }
  if (!mutating) return;
  const id = (input.data as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0) {
    throw new NetworkError(
      "Tap API returned a 2xx mutation body without an id",
      { status: input.status, body: input.data },
      { afterProviderSubmit: true },
    );
  }
}

export function tapResponseCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const response = (body as { response?: { code?: unknown } }).response;
  if (response && typeof response.code === "string") return response.code;
  if (response && typeof response.code === "number") return String(response.code);
  return undefined;
}
