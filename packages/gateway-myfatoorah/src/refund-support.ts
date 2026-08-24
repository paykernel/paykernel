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

/** `GetRefundStatus` list — supports official `RefundStatusResult`, legacy `Refunds`, and `{ Data: [] }` wrappers. */
export function myFatoorahRefundItems(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    // Official: Data.RefundStatusResult
    const official = rec.RefundStatusResult;
    if (Array.isArray(official)) return official;
    // Legacy: Data.Refunds
    const legacyRefunds = rec.Refunds;
    if (Array.isArray(legacyRefunds)) return legacyRefunds;
    // Legacy wrapper { Data: [...] } (rare)
    const data = rec.Data;
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
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : undefined;
}

/**
 * Nested refund for crash-replay. Only maps when `ExternalIdentifier` matches
 * `idempotencyKey` (last match wins). Single unkeyed entries are not mapped
 * to an unrelated key — caller will fail-closed with already-refunded.
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
    return undefined;
  }
  if (items.length === 1) return items[0];
  return undefined;
}

/**
 * Remaining refundable major units, or 0 when fully refunded.
 * Refunds whose status is `Refunded` / `Pending` count; `Canceled` does not.
 * When the refund list is missing/empty, remaining equals the invoice amount
 * (no refunds yet). Throws only when the invoice amount itself is unparseable
 * or refund amounts are malformed. Callers that already have an explicit
 * `amount` can proceed even when remaining cannot be determined — the gateway
 * flow handles that by treating `remaining` as undefined in that path.
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
  // No refunds yet — remaining is full invoice amount.
  if (items === undefined || items.length === 0) {
    return myFatoorahMajorNumber(invoice, currency);
  }
  let refundedMinor = 0n;
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new InvalidRequestError("MyFatoorah refunds list has no parseable amounts");
    }
    const normalized = myFatoorahRefundStatus(item).trim().toUpperCase();
    if (normalized === "CANCELED" || normalized === "CANCELLED") continue;
    const rec = item as Record<string, unknown>;
    // Amount may be a plain number (legacy) or an object (official sibling Amount),
    // or an official RefundAmount / ValueInBaseCurrency field.
    let rawAmount: unknown = rec.Amount;
    if (rawAmount !== null && typeof rawAmount === "object" && !Array.isArray(rawAmount)) {
      const amtRec = rawAmount as Record<string, unknown>;
      rawAmount = amtRec.ValueInBaseCurrency ?? amtRec.Value ?? amtRec.Amount ?? rawAmount;
    }
    // Fallback for official RefundStatusResult shape with RefundAmount
    if (rawAmount === undefined) {
      rawAmount = rec.RefundAmount ?? rec.ValueInBaseCurrency;
    }
    const amount = readMyFatoorahMoney(rawAmount, currency);
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
/**
 * Extract the account base currency from a GetRefundStatus payload.
 * Prefers the first `BaseCurrency` / `Currency` on a `RefundStatusResult` entry,
 * falling back to undefined when not present.
 */
export function myFatoorahRefundBaseCurrency(refundData: unknown): string | undefined {
  const items = myFatoorahRefundItems(refundData);
  if (items !== undefined) {
    for (const item of items) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        const base = rec.BaseCurrency;
        if (typeof base === "string" && base.trim().length > 0) return base.trim().toUpperCase();
        // Amount object may carry base currency on some shapes
        const amt = rec.Amount;
        if (amt !== null && typeof amt === "object" && !Array.isArray(amt)) {
          const amtRec = amt as Record<string, unknown>;
          const c = amtRec.BaseCurrency;
          if (typeof c === "string" && c.trim().length > 0) return c.trim().toUpperCase();
        }
      }
    }
  }
  if (refundData !== null && typeof refundData === "object" && !Array.isArray(refundData)) {
    const rec = refundData as Record<string, unknown>;
    const invCur = rec.InvoiceCurrency ?? rec.BaseCurrency;
    if (typeof invCur === "string" && invCur.trim().length > 0) return invCur.trim().toUpperCase();
  }
  return undefined;
}
