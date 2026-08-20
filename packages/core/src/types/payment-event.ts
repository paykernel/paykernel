// file: packages/core/src/types/payment-event.ts

/**
 * Phase 7 — Typed & versioned payment webhook events.
 *
 * Stable names (`payment.succeeded`, `refund.completed`, …) are the public
 * contract for new handlers. Provider-native types stay on
 * {@link ProviderEventMetadata.eventType}. Legacy {@link WebhookEvent} remains
 * required-field compatible (dual-write); prefer `event.event` (PaymentEvent)
 * or {@link webhookEventToPaymentEvent} for new code.
 *
 * Persistence: use {@link toPersistedPaymentEventEnvelope} which **strips**
 * raw payloads and never includes headers/signatures/secrets.
 *
 * @see docs/webhook-events.md
 */

import { InvalidRequestError } from "../errors";
import { sha256Hex } from "../runtime/crypto-portable";
import { unixSecondsToIso } from "../runtime/clock";
import type {
  CaptureStatus,
  RefundDomainStatus,
  SetupTokenStatus,
} from "./domain-status";
import { mapNativeDisputeStatus } from "./domain-status";
import type { Dispute } from "./dispute.types";
import type { PaymentDecline, Payment } from "./operation-result";
import type { GatewayId, PaymentStatus } from "./payment.types";
import type { ProviderReferences } from "./provider-refs";
import { buildProviderReferences } from "./provider-refs";
import type { WebhookEvent } from "./webhook.types";
import {
  mapProviderEventTypeToStable,
  type ProviderEventMapContext,
} from "./webhook-event-map";

// Re-export stable catalog from the cycle-free module (single source of truth).
export {
  STABLE_PAYMENT_EVENT_TYPES,
  isStablePaymentEventType,
  type StablePaymentEventType,
} from "./stable-payment-event-types";

// ─── Schema version ──────────────────────────────────────────────────────────

/** Current PaymentEvent schema version. Starts at `'1'`. */
export const PAYMENT_EVENT_SCHEMA_VERSION = "1" as const;

export type PaymentEventSchemaVersion = typeof PAYMENT_EVENT_SCHEMA_VERSION;

/**
 * Open template for provider-prefixed strings. The discriminated
 * {@link PaymentEvent} escape hatch is the literal arm `type: 'provider.unmapped'`.
 */
export type UnmappedPaymentEventType = `provider.${string}`;

// ─── Provider metadata ───────────────────────────────────────────────────────

/**
 * Structured provider identity for a webhook / payment event.
 *
 * Times are portable ISO-8601 strings (Engineering Rule 15) — not `Date`.
 * `eventType` is always the **provider-native** string (never silently renamed).
 */
export type ProviderEventMetadata = {
  gateway: GatewayId;
  eventId: string;
  /** Provider-native event type string (never rename silently). */
  eventType: string;
  apiVersion?: string;
  livemode?: boolean;
  /** ISO-8601 when the provider says the event occurred. */
  occurredAt: string;
  /** ISO-8601 when the SDK received/parsed the event. */
  receivedAt: string;
  requestId?: string;
};

// ─── Supporting entity types ─────────────────────────────────────────────────

/**
 * Failure details on `payment.failed` / `refund.failed` arms.
 * Shape-aligned with {@link PaymentDecline}; never put secrets in `raw`.
 */
export type PaymentFailure = PaymentDecline;

/**
 * Refund entity embedded on `refund.*` PaymentEvent arms.
 */
export type Refund = {
  status: RefundDomainStatus | string;
  amount?: number;
  currency?: string;
  references: ProviderReferences;
  /** Request-local only — stripped from {@link PersistedPaymentEventEnvelope}. */
  rawResponse?: unknown;
};

/**
 * Capture entity embedded on `capture.completed`.
 */
export type Capture = {
  status: CaptureStatus | string;
  amount?: number;
  currency?: string;
  references: ProviderReferences;
};

export type { Dispute } from "./dispute.types";

/**
 * Payment-method setup entity on `payment_method.setup_completed`.
 */
export type PaymentMethodSetup = {
  status: SetupTokenStatus | string;
  /** Gateway token when safe to surface (not a secret key). */
  token?: string;
  references: ProviderReferences;
};

// ─── PaymentEvent discriminated union ────────────────────────────────────────

type PaymentEventBase = {
  schemaVersion: PaymentEventSchemaVersion;
  provider: ProviderEventMetadata;
};

/**
 * Versioned, discriminated payment event (schema v1).
 *
 * Switch on `schemaVersion` then `type` for exhaustive handling.
 * Unknown provider events use `type: 'provider.unmapped'` with native
 * `provider.eventType` preserved.
 */
export type PaymentEvent =
  | (PaymentEventBase & {
      type: "payment.created";
      payment: Payment;
    })
  | (PaymentEventBase & {
      type: "payment.processing";
      payment: Payment;
    })
  | (PaymentEventBase & {
      type: "payment.authorized";
      payment: Payment;
    })
  | (PaymentEventBase & {
      type: "payment.succeeded";
      payment: Payment;
    })
  | (PaymentEventBase & {
      type: "payment.failed";
      payment: Payment;
      failure: PaymentFailure;
    })
  | (PaymentEventBase & {
      type: "payment.cancelled";
      payment: Payment;
    })
  | (PaymentEventBase & {
      type: "capture.completed";
      capture: Capture;
      payment?: Payment;
    })
  | (PaymentEventBase & {
      type: "refund.pending";
      refund: Refund;
    })
  | (PaymentEventBase & {
      type: "refund.completed";
      refund: Refund;
    })
  | (PaymentEventBase & {
      type: "refund.failed";
      refund: Refund;
      failure?: PaymentFailure;
    })
  | (PaymentEventBase & {
      type: "payment_method.setup_completed";
      setup: PaymentMethodSetup;
    })
  | (PaymentEventBase & {
      type: "dispute.opened";
      dispute: Dispute;
    })
  | (PaymentEventBase & {
      type: "dispute.updated";
      dispute: Dispute;
    })
  | (PaymentEventBase & {
      type: "dispute.closed";
      dispute: Dispute;
    })
  | (PaymentEventBase & {
      type: "provider.unmapped";
      payment?: Payment;
      note?: string;
    });

// ─── Type guards ─────────────────────────────────────────────────────────────

function isProviderEventMetadata(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.gateway === "string" &&
    p.gateway.length > 0 &&
    typeof p.eventId === "string" &&
    p.eventId.length > 0 &&
    typeof p.eventType === "string" &&
    p.eventType.length > 0 &&
    typeof p.occurredAt === "string" &&
    p.occurredAt.length > 0 &&
    typeof p.receivedAt === "string" &&
    p.receivedAt.length > 0
  );
}

function hasRequiredPaymentEventArm(
  type: string,
  value: Record<string, unknown>,
): boolean {
  if (
    type === "payment.created" ||
    type === "payment.processing" ||
    type === "payment.authorized" ||
    type === "payment.succeeded" ||
    type === "payment.failed" ||
    type === "payment.cancelled"
  ) {
    return value.payment !== null && typeof value.payment === "object";
  }
  if (type === "capture.completed") {
    return value.capture !== null && typeof value.capture === "object";
  }
  if (
    type === "refund.pending" ||
    type === "refund.completed" ||
    type === "refund.failed"
  ) {
    return value.refund !== null && typeof value.refund === "object";
  }
  if (type === "payment_method.setup_completed") {
    return value.setup !== null && typeof value.setup === "object";
  }
  if (
    type === "dispute.opened" ||
    type === "dispute.updated" ||
    type === "dispute.closed"
  ) {
    return value.dispute !== null && typeof value.dispute === "object";
  }
  return true;
}

/**
 * Runtime check: value looks like a v1 {@link PaymentEvent}.
 *
 * Requires complete {@link ProviderEventMetadata} and the type's entity arm.
 * A thin 3-field `{schemaVersion, type, provider:{}}` is **not** trusted
 * (CORE-4 — handleWebhook must still attach + demote incomplete money).
 */
export function isPaymentEvent(value: unknown): value is PaymentEvent {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== PAYMENT_EVENT_SCHEMA_VERSION) return false;
  if (typeof v.type !== "string" || v.type.length === 0) return false;
  if (!isProviderEventMetadata(v.provider)) return false;
  return hasRequiredPaymentEventArm(v.type, v);
}

export function isPaymentSucceededEvent(
  e: PaymentEvent,
): e is Extract<PaymentEvent, { type: "payment.succeeded" }> {
  return e.type === "payment.succeeded";
}

export function isPaymentFailedEvent(
  e: PaymentEvent,
): e is Extract<PaymentEvent, { type: "payment.failed" }> {
  return e.type === "payment.failed";
}

export function isRefundCompletedEvent(
  e: PaymentEvent,
): e is Extract<PaymentEvent, { type: "refund.completed" }> {
  return e.type === "refund.completed";
}

export function isProviderUnmappedEvent(
  e: PaymentEvent,
): e is Extract<PaymentEvent, { type: "provider.unmapped" }> {
  return e.type === "provider.unmapped";
}

// ─── Persisted envelope ──────────────────────────────────────────────────────

/**
 * Sanitized, persistable event envelope for inbox / outbox adapters.
 *
 * **Never** includes `rawPayload`, headers, signatures, or secrets.
 * Hash inputs must use redacted canonical bytes ({@link hashWebhookPayload}).
 */
export type PersistedPaymentEventEnvelope = {
  schemaVersion: "1";
  event: PaymentEvent;
  /** Hex sha256 of redacted canonical payload bytes (not secrets). */
  payloadHash: string;
  /** ISO-8601 when the envelope was built for storage. */
  storedAt: string;
};

// ─── Raw retention (request-local / encrypted) ───────────────────────────────

/**
 * Application-supplied codec for optional encrypted long-term raw storage.
 * Core never encrypts with a built-in key — apps own the crypto.
 */
export interface RawWebhookPayloadCodec {
  encrypt(plaintext: Uint8Array | string): Promise<string> | string;
  decrypt(
    ciphertext: string,
  ): Promise<Uint8Array | string> | Uint8Array | string;
}

/**
 * Request-local webhook context — **never** put on
 * {@link PersistedPaymentEventEnvelope}.
 */
export type RequestLocalWebhookContext = {
  rawPayload: unknown;
  headers?: Record<string, string>;
};

/**
 * Encrypted raw payload record for apps that must retain provider bytes.
 */
export type EncryptedRawPayloadRecord = {
  schemaVersion: "1";
  ciphertext: string;
  /** Codec identifier for the app (not a secret). */
  codecId?: string;
  payloadHash: string;
};

// ─── Secret redaction + hashing ──────────────────────────────────────────────

/**
 * Known secret / signature field names stripped from hash inputs and envelope
 * sanitization. Matching is case-insensitive. Nested keys matching these
 * (including camelCase aliases) are redacted.
 */
export const WEBHOOK_PAYLOAD_SECRET_KEYS: readonly string[] = [
  "secret_token",
  "secret",
  "signature",
  "hmac",
  "authorization",
  "client_secret",
  "clientSecret",
  "secretToken",
  "webhook_secret",
  "webhookSecret",
  "webhooksecret",
  "api_key",
  "apikey",
  "password",
  "private_key",
  "privatekey",
  "access_token",
  "accessToken",
  "refresh_token",
  "stripe-signature",
  "paypal-transmission-sig",
  "paypal_transmission_sig",
  // NEW-MONEY-2: PAN / CVC keys the logger already scrubs
  "number",
  "cvc",
  "cvv",
  "pan",
  "card",
];

const SECRET_KEY_SET: ReadonlySet<string> = new Set(
  WEBHOOK_PAYLOAD_SECRET_KEYS.map((k) => k.toLowerCase()),
);

function isSecretKey(key: string): boolean {
  return SECRET_KEY_SET.has(key.toLowerCase());
}

/**
 * Deep-clone `value` with known secret keys replaced by `"[REDACTED]"`.
 * Does not mutate the input.
 */
export function redactWebhookPayloadSecrets(value: unknown): unknown {
  return redactDeep(value, new WeakSet());
}

function tryParseJsonObjectOrArray(value: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // non-JSON / binary-ish string
  }
  return undefined;
}

function isBinaryPayload(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
  );
}

function redactDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  // Parse JSON strings and redact (same as prepareEncryptPlaintext). Remain a
  // string so string vs object hashes may still differ after redaction (WEBHOOKS-2).
  if (typeof value === "string") {
    const parsed = tryParseJsonObjectOrArray(value);
    if (parsed !== undefined) {
      return stableStringifyForHash(redactDeep(parsed, seen));
    }
    return value;
  }

  if (typeof value !== "object") return value;

  if (seen.has(value as object)) {
    return "[Circular]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, seen));
  }

  // Nested binary: contribute actual bytes, not a length marker.
  if (isBinaryPayload(value)) {
    return Array.from(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactDeep(v, seen);
    }
  }
  return out;
}

/**
 * Deterministic JSON stringify with sorted object keys (canonical form for hashing).
 */
export function stableStringifyForHash(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return String(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = canonicalize(obj[k]);
  }
  return out;
}

/**
 * Hex sha256 of redacted canonical payload bytes.
 *
 * Uses pure portable SHA-256 ({@link sha256Hex}) — no `node:crypto`. Secrets
 * are redacted before hashing so `secret_token` / signatures never enter the
 * digest input. Algorithm and encoding are unchanged (UTF-8 → lowercase hex).
 *
 * **JSON strings** are parsed and redacted the same way as
 * {@link prepareEncryptPlaintext}: if `JSON.parse` yields a non-null
 * object/array, secret keys are stripped before the digest. Non-JSON strings
 * pass through as the original string.
 *
 * **Binary:** top-level `Uint8Array` / `Buffer` is hashed as the raw bytes
 * (not a length marker). Nested binary values contribute their actual bytes.
 *
 * **Shape is part of the digest (WEBHOOKS-2 / inbox honesty):** after
 * redaction, `hashWebhookPayload(rawBodyString)` and
 * `hashWebhookPayload(parsedObject)` may still differ — mixing them on an
 * **active lease** yields `payload_conflict`; idle pending rows **supersede**
 * the hash (WEBHOOKS-3/4 — not a permanent stuck conflict). Prefer a single
 * source: gateway `event.payloadHash` when set
 * (e.g. `computePayloadHash: true` on the **parsed** `rawPayload`), or always
 * hash the same object shape the gateway used.
 */
export function hashWebhookPayload(raw: unknown): string {
  if (isBinaryPayload(raw)) {
    return sha256Hex(raw);
  }
  const redacted = redactWebhookPayloadSecrets(raw);
  const canonical = stableStringifyForHash(redacted);
  return sha256Hex(canonical);
}

/**
 * Prepare plaintext for {@link encryptRawWebhookPayload} before the app codec runs.
 *
 * - **object** (non-binary): secrets redacted via {@link redactWebhookPayloadSecrets},
 *   then canonical-stringified.
 * - **string**: if `JSON.parse` yields a non-null object/array, same redaction +
 *   stringify path so secret keys in JSON text are not encrypted verbatim. If
 *   parse fails or yields a non-object primitive, the original string is passed
 *   through unchanged (app-owned non-JSON / binary-ish text).
 * - **Uint8Array / Buffer**: passed through unchanged (app-owned binary; core does
 *   not invent binary redaction).
 */
function prepareEncryptPlaintext(raw: unknown): string | Uint8Array {
  if (typeof raw === "string") {
    const parsed = tryParseJsonObjectOrArray(raw);
    if (parsed !== undefined) {
      return stableStringifyForHash(redactWebhookPayloadSecrets(parsed));
    }
    return raw;
  }
  if (isBinaryPayload(raw)) {
    return raw;
  }
  return stableStringifyForHash(redactWebhookPayloadSecrets(raw));
}

/**
 * Encrypt raw webhook bytes with an application-supplied codec.
 * Default path is request-local raw on `WebhookEvent.rawPayload`; use this only
 * when long-term encrypted retention is required.
 *
 * Plaintext handed to the codec:
 * - Objects are secret-redacted then canonical-stringified.
 * - JSON **strings** that parse to an object/array are redacted the same way
 *   (see {@link prepareEncryptPlaintext}); non-JSON strings pass through.
 * - `Uint8Array` / `Buffer` remain app-owned (no binary redaction).
 *
 * `payloadHash` always uses {@link hashWebhookPayload} (redacted) regardless of
 * the plaintext path.
 */
export async function encryptRawWebhookPayload(
  raw: unknown,
  codec: RawWebhookPayloadCodec,
  opts?: { codecId?: string },
): Promise<EncryptedRawPayloadRecord> {
  const payloadHash = hashWebhookPayload(raw);
  const plaintext = prepareEncryptPlaintext(raw);

  const ciphertext = await Promise.resolve(codec.encrypt(plaintext));
  const record: EncryptedRawPayloadRecord = {
    schemaVersion: "1",
    ciphertext,
    payloadHash,
  };
  if (opts?.codecId !== undefined) {
    record.codecId = opts.codecId;
  }
  return record;
}

// ─── Envelope helpers ────────────────────────────────────────────────────────

/**
 * Recursively strip raw / secret-bearing fields from a PaymentEvent tree
 * before persistence. Returns a new object (does not mutate).
 */
export function stripRawFromPaymentEvent(event: PaymentEvent): PaymentEvent {
  const cloned = structuredCloneSafe(event) as PaymentEvent;
  return stripRawInPlace(cloned);
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripRawInPlace(event: PaymentEvent): PaymentEvent {
  const e = event as PaymentEvent & {
    payment?: Payment;
    refund?: Refund;
    capture?: Capture;
    dispute?: Dispute;
    setup?: PaymentMethodSetup;
    failure?: PaymentFailure;
  };

  if (e.payment) {
    e.payment = stripPayment(e.payment);
  }
  if (e.refund) {
    e.refund = stripRefund(e.refund);
  }
  if (e.failure && "raw" in e.failure) {
    const { raw: _raw, ...rest } = e.failure;
    e.failure = rest;
  }
  // capture / dispute / setup have no raw by default
  return e as PaymentEvent;
}

function stripPayment(p: Payment): Payment {
  const { rawResponse: _r, clientSecret: _c, ...rest } = p;
  // clientSecret is a secret — never persist on envelopes (top-level or nextAction)
  if (rest.nextAction && typeof rest.nextAction === "object") {
    const { clientSecret: _nested, ...nextRest } = rest.nextAction as {
      clientSecret?: string;
    } & typeof rest.nextAction;
    rest.nextAction = nextRest;
  }
  return rest;
}

function stripRefund(r: Refund): Refund {
  const { rawResponse: _r, ...rest } = r;
  return rest;
}

export type ToPersistedEnvelopeOptions = {
  /**
   * Precomputed hash (non-empty). Required unless `rawForHash` is provided
   * (CORE-3 fail-closed — no silent empty-object default).
   */
  payloadHash?: string;
  /** ISO-8601; defaults to now. */
  storedAt?: string;
  /**
   * Raw (or already-redacted) body to hash when `payloadHash` is omitted.
   * Prefer the request body after gateway secret redaction (e.g. Moyasar
   * without `secret_token`). Presence of this key (even with `undefined`)
   * is intentional hashing input — not a missing-opts path.
   */
  rawForHash?: unknown;
};

/**
 * Build a {@link PersistedPaymentEventEnvelope} for inbox persistence.
 *
 * - Strips nested raw payloads / client secrets from `event`
 * - Does **not** include headers, signatures, or raw webhook bodies
 * - **CORE-3 (fail-closed):** `payloadHash` must come from `opts.payloadHash`
 *   or {@link hashWebhookPayload}(`opts.rawForHash`). Omitting both throws
 *   {@link InvalidRequestError} — never silently hash `{}` (identical false
 *   digests across unrelated envelopes).
 */
export function toPersistedPaymentEventEnvelope(
  event: PaymentEvent,
  opts?: ToPersistedEnvelopeOptions,
): PersistedPaymentEventEnvelope {
  const sanitized = stripRawFromPaymentEvent(event);

  let payloadHash: string;
  if (opts?.payloadHash !== undefined) {
    if (
      typeof opts.payloadHash !== "string" ||
      opts.payloadHash.trim().length === 0
    ) {
      throw new InvalidRequestError(
        "toPersistedPaymentEventEnvelope: payloadHash must be a non-empty string",
      );
    }
    payloadHash = opts.payloadHash;
  } else if (opts !== undefined && Object.hasOwn(opts, "rawForHash")) {
    payloadHash = hashWebhookPayload(opts.rawForHash);
  } else {
    // CORE-3: refuse silent empty-object hash (all bare callers would collide).
    throw new InvalidRequestError(
      "toPersistedPaymentEventEnvelope requires payloadHash or rawForHash " +
        "(refuse default hash of empty object)",
    );
  }

  return {
    schemaVersion: "1",
    event: sanitized,
    payloadHash,
    storedAt: opts?.storedAt ?? new Date().toISOString(),
  };
}

/** Keys that must never appear on a persisted envelope (case-insensitive). */
const ENVELOPE_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "rawpayload",
  "rawresponse",
  "clientsecret",
  "client_secret",
  "secret_token",
  "webhook_secret",
  "webhooksecret",
]);

/** Keys allowed only when value is the redaction placeholder. */
const ENVELOPE_REDACT_ONLY_KEYS: ReadonlySet<string> = new Set([
  "signature",
  "hmac",
  "authorization",
]);

/**
 * Test / debug helper: ensure an envelope has no forbidden raw/secret fields.
 * Throws if secrets/raw fields are found.
 */
export function assertNoSecretsInEnvelope(
  envelope: PersistedPaymentEventEnvelope,
): void {
  walkForbid(envelope as unknown as Record<string, unknown>, "");
}

function walkForbid(node: unknown, path: string): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkForbid(item, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (ENVELOPE_FORBIDDEN_KEYS.has(lower)) {
      throw new Error(
        `assertNoSecretsInEnvelope: forbidden field "${k}" at ${path}.${k}`,
      );
    }
    if (
      ENVELOPE_REDACT_ONLY_KEYS.has(lower) &&
      v !== "[REDACTED]" &&
      v !== undefined
    ) {
      throw new Error(
        `assertNoSecretsInEnvelope: unredacted secret field "${k}" at ${path}.${k}`,
      );
    }
    walkForbid(v, path ? `${path}.${k}` : k);
  }
}

// ─── Build helpers ───────────────────────────────────────────────────────────

export type BuildProviderEventMetadataOptions = {
  receivedAt?: string;
  requestId?: string;
  /** Override occurredAt ISO string; default from `event.timestamp`. */
  occurredAt?: string;
};

/**
 * Build {@link ProviderEventMetadata} from a legacy {@link WebhookEvent}.
 */
export function buildProviderEventMetadata(
  event: WebhookEvent,
  opts?: BuildProviderEventMetadataOptions,
): ProviderEventMetadata {
  const occurredAt =
    opts?.occurredAt ??
    (event.timestamp instanceof Date
      ? event.timestamp.toISOString()
      : new Date(event.timestamp as unknown as string | number).toISOString());

  const meta: ProviderEventMetadata = {
    gateway: event.gateway,
    eventId: event.id,
    eventType: event.type,
    occurredAt,
    receivedAt: opts?.receivedAt ?? new Date().toISOString(),
  };

  if (event.apiVersion !== undefined) {
    meta.apiVersion = event.apiVersion;
  }
  if (event.livemode !== undefined) {
    meta.livemode = event.livemode;
  }
  if (opts?.requestId !== undefined) {
    meta.requestId = opts.requestId;
  }

  return meta;
}

type WebhookReferenceExtras = {
  relatedIds?: NonNullable<ProviderReferences["relatedIds"]>;
  captureId?: string;
  refundId?: string;
};

/**
 * Shared ProviderReferences builder for webhook-derived entities.
 * Single place for gatewayPaymentId / object / subscription / internal id mapping.
 */
function referencesFromWebhookEvent(
  event: WebhookEvent,
  extras?: WebhookReferenceExtras,
): ProviderReferences {
  const relatedIds: NonNullable<ProviderReferences["relatedIds"]> = {
    ...(extras?.relatedIds ?? {}),
  };
  if (event.gatewayObjectId !== undefined && relatedIds.objectId === undefined) {
    relatedIds.objectId = event.gatewayObjectId;
  }
  if (
    event.gatewaySubscriptionId !== undefined &&
    relatedIds.subscriptionId === undefined
  ) {
    relatedIds.subscriptionId = event.gatewaySubscriptionId;
  }

  return buildProviderReferences({
    gateway: event.gateway,
    gatewayId: event.gatewayPaymentId,
    status: event.status,
    ...(event.gatewayObjectId !== undefined
      ? { gatewayObjectId: event.gatewayObjectId }
      : {}),
    ...(event.paymentId !== undefined
      ? { internalReference: event.paymentId }
      : {}),
    ...(extras?.captureId !== undefined ? { captureId: extras.captureId } : {}),
    ...(extras?.refundId !== undefined ? { refundId: extras.refundId } : {}),
    ...(Object.keys(relatedIds).length > 0 ? { relatedIds } : {}),
  });
}

/**
 * Money snapshot from webhook fields (CORE-3 / NEW-MONEY-3 / fail-closed).
 *
 * Mirrors {@link import("./operation-result").paymentFromGatewayResult}: major-unit
 * `amount` is published only when `currency` is a non-empty string **and** the
 * value is {@link Number.isFinite}. Currency alone (no amount) is still copied
 * when present. Naked major units without currency, or NaN / ±Infinity, are
 * omitted rather than dual-written incomplete.
 */
function moneyFieldsFromWebhook(event: WebhookEvent): {
  amount?: number;
  currency?: string;
} {
  const out: { amount?: number; currency?: string } = {};
  const currency =
    typeof event.currency === "string" && event.currency.trim().length > 0
      ? event.currency.trim().toUpperCase()
      : undefined;
  if (currency !== undefined) {
    out.currency = currency;
    if (typeof event.amount === "number" && Number.isFinite(event.amount)) {
      out.amount = event.amount;
    }
  }
  return out;
}

/**
 * Build a Phase 6 {@link Payment} snapshot from webhook fields.
 * Does **not** invent references from thin data — uses gatewayPaymentId.
 * Omits `rawResponse` by default (request-local raw stays on WebhookEvent).
 */
export function paymentFromWebhookEvent(
  event: WebhookEvent,
  options?: { includeRaw?: boolean },
): Payment {
  const payment: Payment = {
    status: event.status as PaymentStatus,
    references: referencesFromWebhookEvent(event),
    ...moneyFieldsFromWebhook(event),
  };

  if (options?.includeRaw === true && event.rawPayload !== undefined) {
    payment.rawResponse = event.rawPayload;
  }

  return payment;
}

function refundFromWebhookEvent(event: WebhookEvent): Refund {
  return {
    status: refundStatusFromPaymentStatus(event.status),
    references: referencesFromWebhookEvent(event, {
      ...(event.gatewayObjectId !== undefined
        ? { refundId: event.gatewayObjectId }
        : {}),
    }),
    ...moneyFieldsFromWebhook(event),
  };
}

function refundStatusFromPaymentStatus(
  status: PaymentStatus | string,
): RefundDomainStatus | string {
  switch (status) {
    case "refund_pending":
      return "pending";
    case "refund_failed":
      return "failed";
    // PAYMOB-3: incomplete money snapshot — entity is not terminal completed.
    case "refund_completed":
      return "pending";
    case "refunded":
    case "partially_refunded":
      return "completed";
    case "failed":
      return "failed";
    default:
      return status;
  }
}

/**
 * Capture dual-write status from webhook domain status (CORE-4).
 *
 * Partials must not look fully settled: `partially_captured` → entity
 * `partially_completed`; pending/processing-style statuses stay non-terminal;
 * only paid/approved-style full captures map to `completed`.
 */
function captureStatusFromWebhookEvent(
  status: PaymentStatus | string,
): Capture["status"] {
  switch (status) {
    case "partially_captured":
      return "partially_completed";
    case "pending":
    case "processing":
    case "authorized":
    case "requires_action":
    case "approved":
      return "processing";
    case "failed":
    case "cancelled":
    case "voided":
    case "expired":
      return "failed";
    case "paid":
    case "captured":
      return "completed";
    default:
      // Unknown / provider-specific: fail closed to processing rather than
      // claiming completed settlement.
      return "processing";
  }
}

function captureFromWebhookEvent(event: WebhookEvent): Capture {
  return {
    status: captureStatusFromWebhookEvent(event.status),
    references: referencesFromWebhookEvent(event, {
      ...(event.gatewayObjectId !== undefined
        ? { captureId: event.gatewayObjectId }
        : {}),
    }),
    ...moneyFieldsFromWebhook(event),
  };
}

function stripeDisputeObjectFromRaw(raw: unknown): {
  id?: unknown;
  object?: unknown;
  status?: unknown;
  reason?: unknown;
  charge?: unknown;
  payment_intent?: unknown;
  evidence_details?: { due_by?: unknown };
  livemode?: unknown;
} | undefined {
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const root = raw as Record<string, unknown>;
  const data = root.data;
  if (data !== null && typeof data === "object") {
    const object = (data as { object?: unknown }).object;
    if (
      object !== null &&
      typeof object === "object" &&
      (object as { object?: unknown }).object === "dispute"
    ) {
      return object as {
        id?: unknown;
        object?: unknown;
        status?: unknown;
        reason?: unknown;
        charge?: unknown;
        payment_intent?: unknown;
        evidence_details?: { due_by?: unknown };
        livemode?: unknown;
      };
    }
  }
  if ((root as { object?: unknown }).object === "dispute") {
    return root;
  }
  return undefined;
}

function expandableRawId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  ) {
    const id = (value as { id: string }).id;
    return id.length > 0 ? id : undefined;
  }
  return undefined;
}

function disputeFromWebhookEvent(event: WebhookEvent): Dispute {
  const native = event.status;
  const status = mapNativeDisputeStatus(native);
  const stripeObject = stripeDisputeObjectFromRaw(event.rawPayload);
  const disputeId =
    expandableRawId(stripeObject?.id) ?? event.gatewayObjectId;
  const chargeId = expandableRawId(stripeObject?.charge);
  const paymentIntentId = expandableRawId(stripeObject?.payment_intent);
  const livemode =
    typeof stripeObject?.livemode === "boolean"
      ? stripeObject.livemode
      : event.livemode;
  const providerObjectId =
    disputeId !== undefined && disputeId.startsWith("dp_")
      ? disputeId
      : event.gatewayPaymentId;
  const snapshot: Dispute = {
    status,
    providerStatus: native,
    references: buildProviderReferences({
      gateway: event.gateway,
      gatewayId: providerObjectId,
      status,
      providerNativeStatus: native,
      relatedIds: {
        ...(chargeId !== undefined ? { chargeId } : {}),
        ...(paymentIntentId !== undefined
          ? { paymentIntentId }
          : {}),
      },
    }),
    ...moneyFieldsFromWebhook(event),
  };
  if (typeof stripeObject?.reason === "string" && stripeObject.reason.length > 0) {
    snapshot.reason = stripeObject.reason;
  }
  const due = unixSecondsToIso(stripeObject?.evidence_details?.due_by);
  if (due !== undefined) {
    snapshot.evidenceDueBy = due;
  }
  if (disputeId !== undefined && disputeId.startsWith("dp_")) {
    const host =
      livemode === true
        ? "https://dashboard.stripe.com"
        : "https://dashboard.stripe.com/test";
    snapshot.dashboardUrl =
      chargeId !== undefined && chargeId.startsWith("ch_")
        ? `${host}/payments/${chargeId}`
        : `${host}/disputes/${disputeId}`;
  }
  return snapshot;
}

function setupFromWebhookEvent(event: WebhookEvent): PaymentMethodSetup {
  const setup: PaymentMethodSetup = {
    status: "succeeded",
    references: referencesFromWebhookEvent(event),
  };
  if (event.gatewayToken !== undefined) {
    setup.token = event.gatewayToken;
  }
  return setup;
}

function failureFromWebhookEvent(event: WebhookEvent): PaymentFailure {
  return {
    code: "payment_failed",
    message: `Payment failed (${event.status})`,
    providerCode: event.status,
  };
}

export type WebhookEventToPaymentEventOptions = {
  receivedAt?: string;
  requestId?: string;
  /** Extra mapping context (Paymob flags, Stripe payment_status, …). */
  mapContext?: ProviderEventMapContext;
  /** Include rawPayload on nested Payment.rawResponse (default false). */
  includeRawOnPayment?: boolean;
};

/**
 * Convert a legacy {@link WebhookEvent} into a versioned {@link PaymentEvent}.
 *
 * - `PaymentEvent.type` is always a stable name or `'provider.unmapped'`
 * - Provider-native type remains on `provider.eventType`
 * - Does **not** mutate the input WebhookEvent
 */
export function webhookEventToPaymentEvent(
  event: WebhookEvent,
  opts?: WebhookEventToPaymentEventOptions,
): PaymentEvent {
  const provider = buildProviderEventMetadata(event, {
    ...(opts?.receivedAt !== undefined ? { receivedAt: opts.receivedAt } : {}),
    ...(opts?.requestId !== undefined ? { requestId: opts.requestId } : {}),
  });

  const mapContext: ProviderEventMapContext = {
    status: event.status,
    ...(opts?.mapContext ?? {}),
  };

  const stable = mapProviderEventTypeToStable(
    event.gateway,
    event.type,
    mapContext,
  );

  const payment = paymentFromWebhookEvent(event, {
    includeRaw: opts?.includeRawOnPayment === true,
  });

  if (stable === "provider.unmapped") {
    return {
      schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
      type: "provider.unmapped",
      provider,
      payment,
      note: `Unmapped provider event type: ${event.type}`,
    };
  }

  switch (stable) {
    case "payment.created":
    case "payment.processing":
    case "payment.authorized":
    case "payment.succeeded":
    case "payment.cancelled":
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: stable,
        payment,
        provider,
      };

    case "payment.failed":
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: "payment.failed",
        payment,
        failure: failureFromWebhookEvent(event),
        provider,
      };

    case "capture.completed":
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: "capture.completed",
        capture: captureFromWebhookEvent(event),
        payment,
        provider,
      };

    case "refund.pending":
    case "refund.completed":
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: stable,
        refund: refundFromWebhookEvent(event),
        provider,
      };

    case "refund.failed":
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: "refund.failed",
        refund: refundFromWebhookEvent(event),
        failure: failureFromWebhookEvent(event),
        provider,
      };

    case "payment_method.setup_completed":
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: "payment_method.setup_completed",
        setup: setupFromWebhookEvent(event),
        provider,
      };

    case "dispute.opened":
    case "dispute.updated":
    case "dispute.closed":
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: stable,
        dispute: disputeFromWebhookEvent(event),
        provider,
      };

    default: {
      // Exhaustiveness — should not reach
      const _never: never = stable;
      return {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: "provider.unmapped",
        provider,
        payment,
        note: `Unhandled stable type: ${String(_never)}`,
      };
    }
  }
}

export type AttachPaymentEventOptions = WebhookEventToPaymentEventOptions & {
  /**
   * When true, also set `payloadHash` from `event.rawPayload` (redacted).
   * Default false — hashing is optional at attach time.
   */
  computePayloadHash?: boolean;
};

/**
 * Dual-write helper: attach {@link PaymentEvent} + metadata onto a
 * {@link WebhookEvent} **without** changing legacy `type` (provider-native).
 *
 * Sets:
 * - `schemaVersion: '1'`
 * - `event` — PaymentEvent (stable type)
 * - `stableType` — stable name when mapped; omit when unmapped
 * - `provider` — ProviderEventMetadata
 * - optional `payloadHash`
 *
 * Returns a **new** object (shallow copy + new fields). Does not mutate input.
 */
export function attachPaymentEvent(
  event: WebhookEvent,
  opts?: AttachPaymentEventOptions,
): WebhookEvent {
  const paymentEvent = webhookEventToPaymentEvent(event, opts);
  const provider = paymentEvent.provider;

  const out: WebhookEvent = {
    ...event,
    schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
    event: paymentEvent,
    provider,
  };

  if (paymentEvent.type !== "provider.unmapped") {
    out.stableType = paymentEvent.type;
  }

  // Hash the gateway's parsed rawPayload object (not a raw HTTP body string).
  // Callers who re-hash a body string for inbox claim will not match this digest.
  // Spread already copies event.payloadHash. Only hash when asked and absent.
  if (opts?.computePayloadHash === true && event.payloadHash === undefined) {
    out.payloadHash = hashWebhookPayload(event.rawPayload);
  }

  return out;
}
