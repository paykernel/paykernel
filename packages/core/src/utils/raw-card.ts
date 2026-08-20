/**
 * PCI fence for the customer / stored-method surface (Phase 22.1).
 *
 * Rejects PAN-like values and raw `creditcard` sources on the client facade
 * before any adapter runs. Does not walk provider-specific nested payloads
 * (e.g. Moyasar `moyasarSource`) — those keep their existing adapter checks.
 */

import { InvalidRequestError } from "../errors";

const PAN_DIGITS = /^\d{13,19}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPanLike(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const digits = value.replace(/[\s-]/g, "");
  return PAN_DIGITS.test(digits);
}

/**
 * True when `params` carries raw cardholder data this SDK must never persist.
 * Inspects top-level PAN keys, nested `card`, and `source.type === "creditcard"`.
 */
function containsRawCardMaterial(params: unknown): boolean {
  if (!isRecord(params)) {
    return false;
  }
  if (
    isPanLike(params.number) ||
    isPanLike(params.pan) ||
    isPanLike(params.cardNumber)
  ) {
    return true;
  }
  if (isRecord(params.card)) {
    if (isPanLike(params.card.number) || isPanLike(params.card.pan)) {
      return true;
    }
  }
  if (isRecord(params.source)) {
    if (params.source.type === "creditcard") {
      return true;
    }
    if (isPanLike(params.source.number) || isPanLike(params.source.pan)) {
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
