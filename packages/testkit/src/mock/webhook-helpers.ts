/**
 * Webhook helpers for mock gateway: HMAC signatures, duplicates, out-of-order,
 * and Phase 7 dual-write (`PaymentEvent` via core `attachPaymentEvent`).
 *
 * Signatures use portable HMAC-SHA256 from `@paykernel/core` (no
 * `node:crypto`). Test-only — never reuse mock secrets in production.
 *
 * Mapping is delegated to `@paykernel/core` — never reimplemented here.
 */

import {
  attachPaymentEvent,
  hmacSha256Hex,
  MOYASAR_EVENT_TYPE_MAP,
  type AttachPaymentEventOptions,
  type PaymentStatus,
  type WebhookEvent,
} from "@paykernel/core";

export const DEFAULT_MOCK_WEBHOOK_SECRET = "testkit_mock_secret";

export type MockWebhookPayload = {
  id: string;
  type: string;
  gatewayPaymentId: string;
  status: PaymentStatus;
  paymentId?: string | undefined;
  amount?: number | undefined;
  currency?: string | undefined;
  /** Mock HMAC signature field. */
  signature?: string | undefined;
  /** Sequence for out-of-order tests. */
  sequence?: number | undefined;
  /** ISO timestamp string. */
  createdAt?: string | undefined;
};

export type SignMockWebhookOptions = {
  /** Shared secret used only in tests (never a production secret). */
  secret?: string;
  /** Precomputed signature to attach. */
  signature?: string;
};

export type GenerateWebhookEventOptions = {
  /**
   * Free-form provider-native type (default `payment_paid`) **or** a Phase 7
   * stable name (`payment.succeeded`, …). Stable names dual-write cleanly;
   * Moyasar-shaped free-form types map via core tables when possible.
   */
  type?: string;
  paymentId?: string;
  gatewayPaymentId?: string;
  status?: PaymentStatus;
  amount?: number;
  currency?: string;
  sequence?: number;
  id?: string;
  createdAt?: string;
  /** Gateway name on the normalized event. Default: "mock". */
  gateway?: string;
  secret?: string;
  /**
   * When true, set `payloadHash` from redacted canonical raw bytes
   * (core `hashWebhookPayload`). Default false.
   */
  computePayloadHash?: boolean;
  /** ISO-8601 override for `provider.receivedAt` on the dual-write. */
  receivedAt?: string;
};

/**
 * Canonical body for signing: payload without the `signature` field.
 */
function webhookSigningBody(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload === null || typeof payload !== "object") {
    return JSON.stringify(payload) ?? "null";
  }
  const clone = { ...(payload as Record<string, unknown>) };
  delete clone.signature;
  return stableStringify(clone);
}

/**
 * HMAC-SHA256 mock signature (hex, prefixed with `mocksig_`).
 * Deterministic; uses core portable `hmacSha256Hex` (Workers/Deno/Bun/Node).
 */
export function computeMockWebhookSignature(
  payload: unknown,
  secret = DEFAULT_MOCK_WEBHOOK_SECRET,
): string {
  const body = webhookSigningBody(payload);
  const digest = hmacSha256Hex(secret, body);
  return `mocksig_${digest}`;
}

/**
 * Roadmap name: signWebhook(payload, secret?) → signature string.
 */
export function signWebhook(
  payload: unknown,
  secret = DEFAULT_MOCK_WEBHOOK_SECRET,
): string {
  return computeMockWebhookSignature(payload, secret);
}

/**
 * Attach an HMAC signature to a mock webhook payload.
 */
export function signMockWebhook(
  payload: MockWebhookPayload,
  options: SignMockWebhookOptions = {},
): MockWebhookPayload {
  const secret = options.secret ?? DEFAULT_MOCK_WEBHOOK_SECRET;
  const signature =
    options.signature ?? computeMockWebhookSignature(payload, secret);
  return { ...payload, signature };
}

export function createMockWebhookPayload(
  overrides: Partial<MockWebhookPayload> = {},
): MockWebhookPayload {
  const payload: MockWebhookPayload = {
    id: overrides.id ?? `evt_mock_${Math.random().toString(36).slice(2, 10)}`,
    type: overrides.type ?? "payment_paid",
    gatewayPaymentId: overrides.gatewayPaymentId ?? "pay_mock_1",
    status: overrides.status ?? "paid",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
  if (overrides.paymentId !== undefined) payload.paymentId = overrides.paymentId;
  if (overrides.amount !== undefined) payload.amount = overrides.amount;
  if (overrides.currency !== undefined) payload.currency = overrides.currency;
  if (overrides.sequence !== undefined) payload.sequence = overrides.sequence;
  if (overrides.signature !== undefined) payload.signature = overrides.signature;
  return payload;
}

/**
 * Roadmap name: generateWebhookEvent → normalized dual-write event + raw signed payload.
 *
 * `event` always includes Phase 7 fields (`schemaVersion`, `event` PaymentEvent,
 * `provider`, optional `stableType`) while preserving 0.x free-form `type` +
 * `rawPayload`.
 */
export function generateWebhookEvent(options: GenerateWebhookEventOptions = {}): {
  event: WebhookEvent;
  raw: MockWebhookPayload;
  signature: string;
} {
  const gateway = options.gateway ?? "mock";
  const secret = options.secret ?? DEFAULT_MOCK_WEBHOOK_SECRET;
  const overrides: Partial<MockWebhookPayload> = {
    type: options.type ?? "payment_paid",
    gatewayPaymentId: options.gatewayPaymentId ?? "pay_mock_1",
    status: options.status ?? "paid",
  };
  if (options.id !== undefined) overrides.id = options.id;
  if (options.paymentId !== undefined) overrides.paymentId = options.paymentId;
  if (options.amount !== undefined) overrides.amount = options.amount;
  if (options.currency !== undefined) overrides.currency = options.currency;
  if (options.sequence !== undefined) overrides.sequence = options.sequence;
  if (options.createdAt !== undefined) overrides.createdAt = options.createdAt;
  const raw = signMockWebhook(createMockWebhookPayload(overrides), { secret });
  const signature = raw.signature ?? computeMockWebhookSignature(raw, secret);

  const attachOpts: AttachPaymentEventOptions = {};
  if (options.computePayloadHash === true) {
    attachOpts.computePayloadHash = true;
  }
  if (options.receivedAt !== undefined) {
    attachOpts.receivedAt = options.receivedAt;
  }

  return {
    event: mockPayloadToWebhookEvent(raw, gateway, attachOpts),
    raw,
    signature,
  };
}

/**
 * Generate a list that includes an intentional duplicate of the first event.
 */
export function withDuplicateWebhook(
  events: MockWebhookPayload[],
): MockWebhookPayload[] {
  if (events.length === 0) return events;
  return [...events, { ...events[0]! }];
}

/** Roadmap alias for {@link withDuplicateWebhook}. */
export const generateDuplicateWebhooks = withDuplicateWebhook;

/**
 * Return events sorted by sequence descending (out-of-order relative to creation).
 */
export function outOfOrderWebhooks(
  events: MockWebhookPayload[],
): MockWebhookPayload[] {
  return [...events].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
}

/** Roadmap alias for {@link outOfOrderWebhooks}. */
export const generateOutOfOrderWebhooks = outOfOrderWebhooks;

/**
 * Normalize a mock payload to a 0.x {@link WebhookEvent} **with Phase 7 dual-write**.
 *
 * - `type` remains free-form (provider-native / mock alias)
 * - `rawPayload` still required (request-local)
 * - `event` / `stableType` / `provider` / `schemaVersion` attached via core
 *   {@link attachPaymentEvent} (no local remapping of stable names)
 *
 * Mock free-form types that match Moyasar envelope names (`payment_paid`, …)
 * are dual-written to the same stable names as production Moyasar mapping,
 * while keeping native `type` and `provider.eventType` on the wire shape.
 * Pass a built-in `gateway` (`stripe` / `moyasar` / …) to use that gateway’s
 * full core map, or pass a stable name as `type` for a direct stable dual-write.
 */
export function mockPayloadToWebhookEvent(
  payload: MockWebhookPayload,
  gateway: string,
  attachOpts?: AttachPaymentEventOptions,
): WebhookEvent {
  const base: WebhookEvent = {
    id: payload.id,
    type: payload.type,
    gateway,
    paymentId: payload.paymentId,
    gatewayPaymentId: payload.gatewayPaymentId,
    status: payload.status,
    timestamp: payload.createdAt ? new Date(payload.createdAt) : new Date(),
    rawPayload: payload,
  };
  if (payload.amount !== undefined) base.amount = payload.amount;
  if (payload.currency !== undefined) base.currency = payload.currency;

  return dualWriteMockWebhookEvent(base, attachOpts);
}

/**
 * Dual-write via core only. For custom/`mock` gateways, free-form types that
 * appear in {@link MOYASAR_EVENT_TYPE_MAP} are mapped by temporarily using the
 * stable name for `attachPaymentEvent`, then restoring the native `type` and
 * `provider.eventType` (Engineering Rule 8: do not hide provider-native names).
 */
function dualWriteMockWebhookEvent(
  event: WebhookEvent,
  opts?: AttachPaymentEventOptions,
): WebhookEvent {
  const first = attachPaymentEvent(event, opts);
  if (first.event && first.event.type !== "provider.unmapped") {
    return first;
  }

  // Built-in gateway maps already ran inside attachPaymentEvent; only fall
  // through for free-form mock aliases (or unknown custom types that happen
  // to match Moyasar envelope names).
  const alias = MOYASAR_EVENT_TYPE_MAP[event.type];
  if (alias === undefined) {
    return first;
  }

  const remapped = attachPaymentEvent({ ...event, type: alias }, opts);
  const provider = remapped.provider
    ? { ...remapped.provider, eventType: event.type }
    : undefined;
  const paymentEvent = remapped.event
    ? {
        ...remapped.event,
        provider: {
          ...remapped.event.provider,
          eventType: event.type,
        },
      }
    : undefined;

  const out: WebhookEvent = {
    ...remapped,
    type: event.type,
  };
  if (provider !== undefined) {
    out.provider = provider;
  }
  if (paymentEvent !== undefined) {
    // PaymentEvent is a discriminated union; provider-only rewrite keeps arm
    out.event = paymentEvent as NonNullable<WebhookEvent["event"]>;
  }
  return out;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`)
    .join(",")}}`;
}
