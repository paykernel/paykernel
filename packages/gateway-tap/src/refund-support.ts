import {
  fromMinorUnits,
  InvalidRequestError,
  toMinorUnits,
  type Money,
} from "@paykernel/core";
import { parseTapAmount, tapMajorNumber } from "./money";
import type { TapApiObject } from "./types";

export function readTapMoney(value: unknown, currency: string): Money | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return parseTapAmount(value, currency);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return parseTapAmount(value, currency);
  }
  return undefined;
}

export function refundCollectionItems(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { data?: unknown }).data)
  ) {
    return (raw as { data: unknown[] }).data;
  }
  return undefined;
}

export function sumRefundAmounts(raw: unknown, currency: string): Money | undefined {
  const items = refundCollectionItems(raw);
  if (items === undefined) return undefined;
  if (items.length === 0) return parseTapAmount(0, currency);
  let total = 0n;
  for (const refundEntry of items) {
    if (refundEntry === null || typeof refundEntry !== "object") {
      return undefined;
    }
    const parsed = readTapMoney((refundEntry as { amount?: unknown }).amount, currency);
    if (parsed === undefined) return undefined;
    total += toMinorUnits(parsed);
  }
  return fromMinorUnits(total, currency);
}

export function refundIdFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith("re_")) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.startsWith("re_")) return id;
  }
  return undefined;
}

export function isMappableRefundObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (refundIdFromUnknown(value) === undefined) return false;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" && status.trim().length > 0;
}

function refundIdempotentKey(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const reference = (value as { reference?: unknown }).reference;
  if (
    reference === null ||
    typeof reference !== "object" ||
    Array.isArray(reference)
  ) {
    return undefined;
  }
  const idempotent = (reference as { idempotent?: unknown }).idempotent;
  return typeof idempotent === "string" && idempotent.length > 0
    ? idempotent
    : undefined;
}

function nestedRefundCandidates(obj: TapApiObject): unknown[] {
  const rec = obj as TapApiObject & Record<string, unknown>;
  const candidates: unknown[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const id = refundIdFromUnknown(value);
    if (id === undefined || seen.has(id)) return;
    seen.add(id);
    candidates.push(value);
  };
  push(rec.refund);
  const items = refundCollectionItems(rec.refunds);
  if (items !== undefined) {
    for (const refundEntry of items) push(refundEntry);
  } else {
    push(rec.refunds);
  }
  return candidates;
}

/**
 * Nested refund for crash-replay. Prefer `reference.idempotent` match.
 * A single nested refund is mapped only when Tap omits that field.
 * Unmatched keys (including a single nested refund with a different key)
 * return undefined so the caller fail-closes instead of posting again.
 */
export function nestedRefundFromCharge(
  obj: TapApiObject,
  idempotencyKey?: string,
): unknown | undefined {
  const candidates = nestedRefundCandidates(obj);
  if (candidates.length === 0) return undefined;
  if (idempotencyKey !== undefined) {
    const matched = candidates.filter(
      (entry) => refundIdempotentKey(entry) === idempotencyKey,
    );
    if (matched.length > 0) return matched[matched.length - 1];
    if (
      candidates.length === 1 &&
      refundIdempotentKey(candidates[0]) === undefined
    ) {
      return candidates[0];
    }
    return undefined;
  }
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

/**
 * Remaining refundable major units, or 0 when fully refunded.
 * Throws when remaining cannot be derived (caller must pass amount).
 */
export function tapRemainingRefundMajor(obj: TapApiObject, currency: string): number {
  const rec = obj as TapApiObject & Record<string, unknown>;
  const remainingDirect = readTapMoney(rec.remaining ?? rec.refundable, currency);
  if (remainingDirect !== undefined) {
    const major = tapMajorNumber(remainingDirect, currency);
    if (major < 0) {
      throw new InvalidRequestError("Tap refund remaining is invalid");
    }
    return major;
  }
  const refunded =
    readTapMoney(rec.amount_refunded ?? rec.refunded, currency) ??
    sumRefundAmounts(rec.refunds, currency);
  if (refunded === undefined) {
    const items = refundCollectionItems(rec.refunds);
    if (items !== undefined && items.length > 0) {
      throw new InvalidRequestError(
        "Tap charge refunds list has no parseable amounts",
      );
    }
    throw new InvalidRequestError(
      "Tap refund requires amount (charge does not expose remaining/refunded)",
    );
  }
  const total = parseTapAmount(obj.amount, currency);
  const remainingMinor = toMinorUnits(total) - toMinorUnits(refunded);
  if (remainingMinor < 0n) {
    throw new InvalidRequestError("Tap refund remaining is invalid");
  }
  if (remainingMinor === 0n) {
    return 0;
  }
  return tapMajorNumber(fromMinorUnits(remainingMinor, currency), currency);
}
