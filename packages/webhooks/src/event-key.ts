/**
 * Derive a stable webhook inbox event key from gateway + provider event id.
 *
 * Format: `{gateway}:{providerEventId}` (colon separator).
 * Both parts MUST be non-empty after trim; otherwise throws.
 */

/**
 * Stable key for inbox claim/dedupe.
 *
 * @param gateway - Gateway id (e.g. `"stripe"`, `"moyasar"`). Non-empty.
 * @param providerEventId - Provider-native event id. Non-empty.
 * @returns `gateway:providerEventId`
 * @throws Error when either part is empty/whitespace-only.
 */
export function deriveWebhookEventKey(
  gateway: string,
  providerEventId: string,
): string {
  const g = typeof gateway === "string" ? gateway.trim() : "";
  const id =
    typeof providerEventId === "string" ? providerEventId.trim() : "";
  if (!g) {
    throw new Error("deriveWebhookEventKey: gateway must be a non-empty string");
  }
  if (!id) {
    throw new Error(
      "deriveWebhookEventKey: providerEventId must be a non-empty string",
    );
  }
  return `${g}:${id}`;
}

/**
 * Best-effort split of a key produced by {@link deriveWebhookEventKey}.
 * Returns undefined if the key has no colon or empty parts.
 */
export function parseWebhookEventKey(
  key: string,
): { gateway: string; providerEventId: string } | undefined {
  if (typeof key !== "string" || key.length === 0) return undefined;
  const idx = key.indexOf(":");
  if (idx <= 0 || idx === key.length - 1) return undefined;
  const gateway = key.slice(0, idx);
  const providerEventId = key.slice(idx + 1);
  if (!gateway || !providerEventId) return undefined;
  return { gateway, providerEventId };
}
