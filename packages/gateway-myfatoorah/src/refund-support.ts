import { fromMinorUnits, InvalidRequestError, toMinorUnits, type Money } from "@paykernel/core";
import { myFatoorahMajorNumber, parseMyFatoorahAmount } from "./money";

export function readMyFatoorahMoney(value: unknown, currency: string): Money | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return parseMyFatoorahAmount(value, currency);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return parseMyFatoorahAmount(value, currency);
  }
  return undefined;
}

/** `GetRefundStatus` `Data.Refunds` list (array or `{ data }`-shaped). */
export function myFatoorahRefundItems(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const data = (raw as { Data?: unknown }).Data;
    if (Array.isArray(data)) return data;
    return undefined;
  }
  return undefined;
}

export function myFatoorahRefundId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  const id = rec.RefundId ?? rec.Id;
  if (typeof id === "string" && id.trim().length > 0) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return undefined;
}

export function myFatoorahRefundStatus(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const rec = value as Record<string, unknown>;
  const status = rec.RefundStatus ?? rec.Status;
  return typeof status === "string" ? status : "";
}

export function myFatoorahRefundExternalIdentifier(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const id = (value as Record<string, unknown>).ExternalIdentifier;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * Nested refund for crash-replay. Prefer `ExternalIdentifier` match (last
 * match wins). A single refund entry without an ExternalIdentifier is mapped;
 * a single entry with a **different** key, or multiple unmatched entries,
 * returns undefined so the caller fail-closes instead of posting again.
 */
export function nestedRefundFromInvoice(
  refunds: unknown,
  idempotencyKey?: string,
): unknown | undefined {
  const items = myFatoorahRefundItems(refunds);
  if (items === undefined || items.length === 0) return undefined;
  if (idempotencyKey !== undefined) {
    const matched = items.filter(
      (entry) => myFatoorahRefundExternalIdentifier(entry) === idempotencyKey,
    );
    if (matched.length > 0) return matched[matched.length - 1];
    if (items.length === 1 && myFatoorahRefundExternalIdentifier(items[0]) === undefined) {
      return items[0];
    }
    return undefined;
  }
  if (items.length === 1) return items[0];
  return undefined;
}

/**
 * Remaining refundable major units, or 0 when fully refunded.
 * Refunds whose status is `Refunded` / `Pending` count; `Canceled` does not.
 * Throws when the invoice amount or refund list is not parseable (caller must
 * pass an explicit amount instead of guessing).
 */
export function myFatoorahRemainingRefundMajor(
  invoiceAmount: unknown,
  refunds: unknown,
  currency: string,
): number {
  const invoice = readMyFatoorahMoney(invoiceAmount, currency);
  if (invoice === undefined) {
    throw new InvalidRequestError(
      "MyFatoorah refund requires amount (invoice does not expose remaining)",
    );
  }
  const items = myFatoorahRefundItems(refunds);
  if (items === undefined) {
    throw new InvalidRequestError(
      "MyFatoorah refund requires amount (invoice does not expose remaining)",
    );
  }
  let refundedMinor = 0n;
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new InvalidRequestError("MyFatoorah refunds list has no parseable amounts");
    }
    const normalized = myFatoorahRefundStatus(item).trim().toUpperCase();
    if (normalized === "CANCELED" || normalized === "CANCELLED") continue;
    const amount = readMyFatoorahMoney((item as { Amount?: unknown }).Amount, currency);
    if (amount === undefined) {
      throw new InvalidRequestError("MyFatoorah refunds list has no parseable amounts");
    }
    refundedMinor += toMinorUnits(amount);
  }
  const remainingMinor = toMinorUnits(invoice) - refundedMinor;
  if (remainingMinor < 0n) {
    throw new InvalidRequestError("MyFatoorah refund remaining is invalid");
  }
  if (remainingMinor === 0n) {
    return 0;
  }
  return myFatoorahMajorNumber(fromMinorUnits(remainingMinor, currency), currency);
}
