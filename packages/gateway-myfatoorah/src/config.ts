import { InvalidRequestError } from "@paykernel/core";
import { assertMyFatoorahPaymentMethod } from "./sources";
import type { MyFatoorahPaymentMethod } from "./types";

export const MYFATOORAH_DEFAULT_TIMEOUT_MS = 30_000;
export const MYFATOORAH_TEST_API_BASE_URL = "https://apitest.myfatoorah.com";

export type MyFatoorahCountry = "KWT" | "SAU" | "ARE" | "QAT" | "BHR" | "OMN" | "JOR" | "EGY";

export const MYFATOORAH_COUNTRIES: readonly MyFatoorahCountry[] = [
  "KWT",
  "SAU",
  "ARE",
  "QAT",
  "BHR",
  "OMN",
  "JOR",
  "EGY",
];

/**
 * Live API hosts by portal country. KWT/BHR/JOR/OMN share the default host;
 * ARE/SAU/QAT/EGY use country subdomains. Sandbox always uses
 * {@link MYFATOORAH_TEST_API_BASE_URL} (country host is ignored there).
 */
export const MYFATOORAH_LIVE_API_BASE_URL: Record<MyFatoorahCountry, string> = {
  KWT: "https://api.myfatoorah.com",
  BHR: "https://api.myfatoorah.com",
  JOR: "https://api.myfatoorah.com",
  OMN: "https://api.myfatoorah.com",
  ARE: "https://api-ae.myfatoorah.com",
  SAU: "https://api-sa.myfatoorah.com",
  QAT: "https://api-qa.myfatoorah.com",
  EGY: "https://api-eg.myfatoorah.com",
};

/** Base currency for each portal country (ISO Lookups). */
export const MYFATOORAH_COUNTRY_CURRENCY: Record<MyFatoorahCountry, string> = {
  KWT: "KWD",
  BHR: "BHD",
  JOR: "JOD",
  OMN: "OMR",
  ARE: "AED",
  SAU: "SAR",
  QAT: "QAR",
  EGY: "EGP",
};

/**
 * Closed-over MyFatoorah adapter configuration. Secrets never go on the
 * manifest or {@link import("@paykernel/core").GatewayContext}.
 */
export type MyFatoorahConfig = {
  /** Portal API token (`Bearer …`). Never used as the webhook HMAC key. */
  apiToken: string;
  /** Portal country; selects the live API host when `live` is true. */
  country: MyFatoorahCountry;
  /** Use the live host for `country`. Default: false (sandbox apitest). */
  live?: boolean;
  /**
   * Webhook V2 HMAC secret (portal secure key). Distinct from `apiToken`.
   * `verifyWebhook` fails closed (`false`) when omitted.
   */
  webhookSecret?: string;
  /** Request timeout in milliseconds. Must be finite and > 0. Default: 30000 */
  timeoutMs?: number;
  /** HTTPS `IntegrationUrls.Webhook` for create (V3). */
  webhookUrl?: string;
  /** Default `PaymentMethod` on V3 create. Omitted: all enabled methods. */
  defaultPaymentMethod?: MyFatoorahPaymentMethod;
};

export function resolveMyFatoorahBaseUrl(config: MyFatoorahConfig): string {
  if (config.live === true) {
    return MYFATOORAH_LIVE_API_BASE_URL[config.country];
  }
  return MYFATOORAH_TEST_API_BASE_URL;
}

export function assertMyFatoorahApiToken(apiToken: unknown): asserts apiToken is string {
  if (typeof apiToken !== "string" || apiToken.trim().length === 0) {
    throw new InvalidRequestError("myfatoorah.apiToken must be a non-empty string");
  }
}

export function assertMyFatoorahCountry(country: unknown): asserts country is MyFatoorahCountry {
  if (
    typeof country !== "string" ||
    !(MYFATOORAH_COUNTRIES as readonly string[]).includes(country)
  ) {
    throw new InvalidRequestError(
      `myfatoorah.country must be one of ${MYFATOORAH_COUNTRIES.join(", ")}`,
    );
  }
}

export function assertMyFatoorahTimeoutMs(timeoutMs: unknown): asserts timeoutMs is number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new InvalidRequestError("myfatoorah.timeoutMs must be a finite number > 0");
  }
}
/** MyFatoorah will not redirect/webhook to non-HTTPS URLs. */
export function assertMyFatoorahHttpsUrl(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} must be a non-empty HTTPS URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new InvalidRequestError(`${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new InvalidRequestError(`${field} must be an HTTPS URL`);
  }
  if (parsed.hostname.length === 0 || parsed.host === "") {
    throw new InvalidRequestError(`${field} must be an HTTPS URL`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new InvalidRequestError(`${field} must not contain credentials`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new InvalidRequestError(`${field} must not be localhost (MyFatoorah rejects non-public hosts)`);
  }
}

export function copyMyFatoorahConfig(config: MyFatoorahConfig): MyFatoorahConfig {
  assertMyFatoorahApiToken(config.apiToken);
  assertMyFatoorahCountry(config.country);
  if (config.live !== undefined && typeof config.live !== "boolean") {
    throw new InvalidRequestError("myfatoorah.live must be a boolean");
  }
  if (
    config.webhookSecret !== undefined &&
    typeof config.webhookSecret === "string" &&
    config.webhookSecret.length > 0 &&
    config.webhookSecret.trim().length === 0
  ) {
    throw new InvalidRequestError("myfatoorah.webhookSecret must be a non-empty string when provided");
  }
  const copied: MyFatoorahConfig = {
    apiToken: config.apiToken.trim(),
    country: config.country,
  };
  if (config.live !== undefined) copied.live = config.live === true;
  if (config.webhookSecret !== undefined) {
    const trimmed = config.webhookSecret.trim();
    if (trimmed.length > 0) {
      copied.webhookSecret = trimmed;
    }
  }
  if (config.timeoutMs !== undefined) {
    assertMyFatoorahTimeoutMs(config.timeoutMs);
    copied.timeoutMs = config.timeoutMs;
  }
  if (config.webhookUrl !== undefined) {
    assertMyFatoorahHttpsUrl(config.webhookUrl, "myfatoorah.webhookUrl");
    copied.webhookUrl = config.webhookUrl.trim();
  }
  if (config.defaultPaymentMethod !== undefined) {
    assertMyFatoorahPaymentMethod(config.defaultPaymentMethod);
    copied.defaultPaymentMethod = config.defaultPaymentMethod;
  }
  return copied;
}
