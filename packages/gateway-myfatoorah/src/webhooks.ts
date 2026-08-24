import {
  base64ToBytes,
  bytesToBase64,
  hmacSha256,
  InvalidRequestError,
  timingSafeEqualBytes,
} from "@paykernel/core";

/**
 * Extract the `MyFatoorah-Signature` header (case-insensitive) from the
 * explicit signature argument or a headers bag.
 */
export function extractMyFatoorahSignatureHeader(
  signature?: string,
  headers?: Record<string, string | string[]>,
): string | undefined {
  if (typeof signature === "string" && signature.trim().length > 0) {
    return signature.trim();
  }
  if (headers === undefined) return undefined;
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== "myfatoorah-signature") continue;
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
    if (Array.isArray(raw)) {
      for (const v of raw) {
        if (typeof v === "string" && v.trim().length > 0) return v.trim();
      }
    }
  }
  return undefined;
}

export type MyFatoorahWebhookKind = "payment" | "refund";

/** Webhook V2 event kinds. `Event.Name` is authoritative; `Event.Code` 1/2 is fallback only when Name is missing. */
export function myFatoorahWebhookKind(payload: unknown): MyFatoorahWebhookKind {
  const event = myFatoorahEventRecord(payload);
  const name = typeof event.Name === "string" ? event.Name.trim().toUpperCase() : "";
  if (name === "PAYMENT_STATUS_CHANGED") return "payment";
  if (name === "REFUND_STATUS_CHANGED") return "refund";
  if (name.length > 0) {
    throw new InvalidRequestError(
      `Unsupported MyFatoorah webhook event ${String(event.Name)} (PAYMENT_STATUS_CHANGED or REFUND_STATUS_CHANGED)`,
    );
  }
  // Fallback to Code only when Name is empty — accept number or string "1"/"2"
  const codeRaw = event.Code;
  const codeNum =
    typeof codeRaw === "number"
      ? codeRaw
      : typeof codeRaw === "string" && codeRaw.trim().length > 0
        ? Number(codeRaw.trim())
        : undefined;
  if (codeNum === 1) return "payment";
  if (codeNum === 2) return "refund";
  throw new InvalidRequestError(
    `Unsupported MyFatoorah webhook event ${String(event.Name)} (PAYMENT_STATUS_CHANGED or REFUND_STATUS_CHANGED)`,
  );
}

function myFatoorahEventRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidRequestError("MyFatoorah webhook payload must be a JSON object");
  }
  const event = (payload as { Event?: unknown }).Event;
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new InvalidRequestError("MyFatoorah webhook missing Event");
  }
  return event as Record<string, unknown>;
}

function myFatoorahDataRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidRequestError("MyFatoorah webhook payload must be a JSON object");
  }
  const data = (payload as { Data?: unknown }).Data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidRequestError("MyFatoorah webhook missing Data");
  }
  return data as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Canonical field: numbers/strings as sent; null / missing → empty string. */
export function myFatoorahCanonicalField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Payment canonical string (fixed field order — never sort keys):
 * `Invoice.Id,Invoice.Status,Transaction.Status,Transaction.PaymentId,Invoice.ExternalIdentifier`
 */
export function canonicalMyFatoorahPaymentString(payload: unknown): string {
  const data = myFatoorahDataRecord(payload);
  const invoice = asRecord(data.Invoice);
  const transaction = asRecord(data.Transaction);
  return (
    `Invoice.Id=${myFatoorahCanonicalField(invoice.Id)}` +
    `,Invoice.Status=${myFatoorahCanonicalField(invoice.Status)}` +
    `,Transaction.Status=${myFatoorahCanonicalField(transaction.Status)}` +
    `,Transaction.PaymentId=${myFatoorahCanonicalField(transaction.PaymentId)}` +
    `,Invoice.ExternalIdentifier=${myFatoorahCanonicalField(invoice.ExternalIdentifier)}`
  );
}

/**
 * Refund canonical string (fixed field order — never sort keys):
 * `Refund.Id,Refund.Status,Amount.ValueInBaseCurrency,ReferencedInvoice.Id`
 * Official Data has siblings `{ Refund, Amount, ReferencedInvoice }`; legacy
 * fixtures nested Amount/ReferencedInvoice under Refund. Both are supported,
 * with sibling (official) preferred.
 */
export function canonicalMyFatoorahRefundString(payload: unknown): string {
  const data = myFatoorahDataRecord(payload);
  const refund = asRecord(data.Refund);
  // Official: Data.Amount and Data.ReferencedInvoice are siblings of Refund.
  // Legacy: they were nested under Refund. Prefer sibling when present.
  const amount = asRecord(data.Amount !== undefined ? data.Amount : refund.Amount);
  const invoice = asRecord(
    data.ReferencedInvoice !== undefined ? data.ReferencedInvoice : refund.ReferencedInvoice,
  );
  return (
    `Refund.Id=${myFatoorahCanonicalField(refund.Id)}` +
    `,Refund.Status=${myFatoorahCanonicalField(refund.Status)}` +
    `,Amount.ValueInBaseCurrency=${myFatoorahCanonicalField(amount.ValueInBaseCurrency)}` +
    `,ReferencedInvoice.Id=${myFatoorahCanonicalField(invoice.Id)}`
  );
}

export function canonicalMyFatoorahString(payload: unknown): string {
  const kind = myFatoorahWebhookKind(payload);
  return kind === "payment"
    ? canonicalMyFatoorahPaymentString(payload)
    : canonicalMyFatoorahRefundString(payload);
}

/** Webhook V2 signature: Base64(HMAC-SHA256(secret, canonicalString)). */
export function computeMyFatoorahSignature(canonical: string, webhookSecret: string): string {
  return bytesToBase64(hmacSha256(webhookSecret, canonical));
}

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Constant-time verification of a Webhook V2 signature.
 *
 * Fails closed (`false`): missing/empty secret, missing/empty header,
 * unsupported event, unparseable payload, invalid Base64, or byte mismatch.
 */
export function verifyMyFatoorahSignature(
  payload: unknown,
  webhookSecret: string | undefined,
  provided: string | undefined,
): boolean {
  const trimmedProvided = typeof provided === "string" ? provided.trim() : undefined;
  if (trimmedProvided === undefined || trimmedProvided.length === 0) return false;
  if (webhookSecret === undefined || webhookSecret.trim().length === 0) return false;
  if (!BASE64_RE.test(trimmedProvided)) return false;

  let canonical: string;
  try {
    canonical = canonicalMyFatoorahString(payload);
  } catch {
    return false;
  }
  const computed = computeMyFatoorahSignature(canonical, webhookSecret.trim());

  let providedBytes: Uint8Array;
  let computedBytes: Uint8Array;
  try {
    providedBytes = base64ToBytes(trimmedProvided);
    computedBytes = base64ToBytes(computed);
  } catch {
    return false;
  }
  return timingSafeEqualBytes(providedBytes, computedBytes);
}
