/**
 * PCI fence for the customer / stored-method surface (Phase 22.1).
 *
 * Rejects PAN-like string or number leaves (13–19 digits after stripping
 * spaces/dashes) anywhere in the params tree — including nested metadata,
 * evidence, tokens, and payment-method ids — plus CVC-shaped keys when the
 * value looks like a 3–4 digit CVC. Raw `source.type === "creditcard"` stays
 * rejected. Tokenized gateway ids (`pm_`, `tok_`, `cus_`, `pi_`, `cs_`,
 * `dp_`, `ch_`, `sk_`, `pk_`) are not treated as PAN.
 */

import { InvalidRequestError } from "../errors";

const PAN_DIGITS = /^\d{13,19}$/;
const CVC_DIGITS = /^\d{3,4}$/;
const GATEWAY_ID_PREFIX = /^(pm_|tok_|cus_|pi_|cs_|dp_|ch_|sk_|pk_)/i;
const CVC_KEYS = new Set([
  "cvc",
  "cvv",
  "cid",
  "securitycode",
  "security_code",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGatewayIdLeaf(value: string): boolean {
  return GATEWAY_ID_PREFIX.test(value.trim());
}

function isPanLike(value: unknown): boolean {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return false;
    }
    return PAN_DIGITS.test(String(Math.abs(value)));
  }
  if (typeof value !== "string") {
    return false;
  }
  if (isGatewayIdLeaf(value)) {
    return false;
  }
  const digits = value.replace(/[\s-]/g, "");
  return PAN_DIGITS.test(digits);
}

function isCvcLike(value: unknown): boolean {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return false;
    }
    return CVC_DIGITS.test(String(Math.abs(value)));
  }
  if (typeof value !== "string") {
    return false;
  }
  const digits = value.replace(/[\s-]/g, "");
  return CVC_DIGITS.test(digits);
}

function isCvcKey(key: string): boolean {
  return CVC_KEYS.has(key.toLowerCase());
}

/**
 * True when `params` carries raw cardholder data this SDK must never persist.
 * Deep-walks records and arrays; inspects every string/number leaf for PAN
 * shape and CVC-shaped keys for 3–4 digit values. Also rejects
 * `source.type === "creditcard"`.
 */
function containsRawCardMaterial(params: unknown): boolean {
  return walkRawCardMaterial(params, new WeakSet());
}

function walkRawCardMaterial(value: unknown, seen: WeakSet<object>): boolean {
  if (isPanLike(value)) {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (walkRawCardMaterial(item, seen)) {
        return true;
      }
    }
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (isRecord(rec.source) && rec.source.type === "creditcard") {
    return true;
  }
  // Moyasar backend-safe sources (token / applepay DPAN / samsungpay / stcpay)
  // carry network-token material that is PAN-shaped. Reject only raw creditcard.
  if (isRecord(rec.moyasarSource) && rec.moyasarSource.type === "creditcard") {
    return true;
  }
  for (const [key, child] of Object.entries(rec)) {
    if (
      key === "moyasarSource" &&
      isRecord(child) &&
      child.type !== "creditcard"
    ) {
      continue;
    }
    if (isCvcKey(key) && isCvcLike(child)) {
      return true;
    }
    if (walkRawCardMaterial(child, seen)) {
      return true;
    }
  }
  return false;
}

/** Throw {@link InvalidRequestError} when params carry PAN-like cardholder data. */
export function assertNoRawCardMaterial(params: unknown): void {
  if (containsRawCardMaterial(params)) {
    throw new InvalidRequestError(
      "Raw card details (PAN/CVC) are not accepted. Use a tokenized payment method; this SDK does not store PCI card data.",
    );
  }
}
