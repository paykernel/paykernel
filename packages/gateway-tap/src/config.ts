import { InvalidRequestError } from "@paykernel/core";

export const TAP_API_BASE_URL = "https://api.tap.company/v2";
export const TAP_DEFAULT_TIMEOUT_MS = 30_000;
export const TAP_DEFAULT_SOURCE_ID = "src_all";

/**
 * Closed-over Tap adapter configuration. Secrets never go on the manifest
 * or {@link import("@paykernel/core").GatewayContext}.
 */
export type TapConfig = {
  /** Secret API key (`sk_test_…` / `sk_live_…`). Also used as webhook HMAC key. */
  secretKey: string;
  /** Optional merchant id sent as `merchant.id` on create. */
  merchantId?: string;
  /** Default `post.url` for Tap IPN / webhook delivery. */
  webhookUrl?: string;
  /** Request timeout in milliseconds. Default: 30000 */
  timeoutMs?: number;
};

export function assertTapSecretKey(secretKey: unknown): asserts secretKey is string {
  if (typeof secretKey !== "string" || secretKey.trim().length === 0) {
    throw new InvalidRequestError("tap.secretKey must be a non-empty string");
  }
}

export function copyTapConfig(config: TapConfig): TapConfig {
  assertTapSecretKey(config.secretKey);
  const copied: TapConfig = { secretKey: config.secretKey };
  if (config.merchantId !== undefined) copied.merchantId = config.merchantId;
  if (config.webhookUrl !== undefined) copied.webhookUrl = config.webhookUrl;
  if (config.timeoutMs !== undefined) copied.timeoutMs = config.timeoutMs;
  return copied;
}
