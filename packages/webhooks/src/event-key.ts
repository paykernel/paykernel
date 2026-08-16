/**
 * Derive a stable webhook inbox event key from gateway + provider event id.
 *
 * Format: `{gateway}:{providerEventId}` (colon separator).
 * Both parts MUST be non-empty after trim; otherwise throws.
 *
 * **Gateway must not contain `:`** — otherwise `parseWebhookEventKey` and
 * store key namespaces collide (e.g. `a:b` + `c` vs `a` + `b:c`).
 * `providerEventId` may contain colons (rest of the key after the first colon).
 *
 * **Paymob (WEBHOOKS-1):** redirect `TRANSACTION_RESPONSE` and processed
 * `TRANSACTION` share the same transaction id on `WebhookEvent.id`. When
 * `notificationClass` is provided (provider-native type / HMAC notification
 * class), the key is `paymob:{class}:{txnId}` so a normal return on redirect
 * cannot `already_completed`-suppress the later paid snapshot. Other gateways
 * ignore `notificationClass` (their provider event ids are already unique).
 */

const PAYMOB_GATEWAY = "paymob";
const PAYMOB_REDIRECT_SUFFIX = ":redirect";
const PAYMOB_REDIRECT_CLASS = "TRANSACTION_RESPONSE";

/**
 * Qualify Paymob inbox ids with notification class without double-prefixing.
 * Stripe / PayPal / Moyasar ids stay unchanged.
 *
 * Paymob parse sets redirect `event.id` to `{txnId}:redirect`. The engine also
 * passes `TRANSACTION_RESPONSE` as the class. Strip the suffix and use one
 * canonical form (`TRANSACTION_RESPONSE:{txnId}`) so `event.id` alone and
 * `event.id` + class do not create two inbox rows for the same redirect.
 */
export function qualifyPaymobProviderEventId(
  gateway: string,
  providerEventId: string,
  notificationClass?: string,
): string {
  if (gateway !== PAYMOB_GATEWAY) return providerEventId;
  let id = providerEventId;
  let cls =
    typeof notificationClass === "string" ? notificationClass.trim() : "";
  if (id.endsWith(PAYMOB_REDIRECT_SUFFIX)) {
    id = id.slice(0, -PAYMOB_REDIRECT_SUFFIX.length);
    if (!cls) cls = PAYMOB_REDIRECT_CLASS;
  }
  if (!id) return providerEventId;
  if (!cls) return id;
  if (id === cls || id.startsWith(`${cls}:`)) {
    return id;
  }
  return `${cls}:${id}`;
}

/**
 * Stable key for inbox claim/dedupe.
 *
 * @param gateway - Gateway id (e.g. `"stripe"`, `"moyasar"`). Non-empty; no `:`.
 * @param providerEventId - Provider-native event id. Non-empty.
 * @param notificationClass - Optional provider-native type (Paymob: `TRANSACTION`
 *   vs `TRANSACTION_RESPONSE`). Ignored for non-Paymob gateways.
 * @returns `gateway:providerEventId` (Paymob: `paymob:{class}:{id}` when class given)
 * @throws Error when either part is empty/whitespace-only, or gateway contains `:`.
 */
export function deriveWebhookEventKey(
  gateway: string,
  providerEventId: string,
  notificationClass?: string,
): string {
  const g = typeof gateway === "string" ? gateway.trim() : "";
  const id =
    typeof providerEventId === "string" ? providerEventId.trim() : "";
  if (!g) {
    throw new Error("deriveWebhookEventKey: gateway must be a non-empty string");
  }
  if (g.includes(":")) {
    throw new Error(
      "deriveWebhookEventKey: gateway must not contain ':' (colon is the key separator)",
    );
  }
  if (!id) {
    throw new Error(
      "deriveWebhookEventKey: providerEventId must be a non-empty string",
    );
  }
  const classified = qualifyPaymobProviderEventId(g, id, notificationClass);
  return `${g}:${classified}`;
}

/**
 * Best-effort split of a key produced by {@link deriveWebhookEventKey}.
 * Returns undefined if the key has no colon or empty parts.
 * Gateway is the segment before the **first** colon (must not itself contain `:`).
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
