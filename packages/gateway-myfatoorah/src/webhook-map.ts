import {
  attachPaymentEvent,
  hashWebhookPayload,
  InvalidRequestError,
  type PaymentStatus,
  type WebhookEvent,
} from "@paykernel/core";
import { myFatoorahMajorNumber, parseMyFatoorahAmount } from "./money";
import {
  inferMyFatoorahStableType,
  mapMyFatoorahInvoiceStatus,
  mapMyFatoorahRefundPaymentStatus,
  mapMyFatoorahTransactionEvidence,
} from "./status";
import { myFatoorahWebhookKind } from "./webhooks";

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringOrNumberId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Payment-domain status from a `PAYMENT_STATUS_CHANGED` event.
 * Invoice `PAID` is authoritative — it stays `paid` regardless of the
 * Transaction status (KNET can emit duplicate/aux transaction statuses).
 * A pending invoice stays pending even when transaction is `AUTHORIZE`
 * (auth/capture not implemented; no fulfilled authorized state). Customer
 * can retry the same invoice when transaction failed.
 */
export function myFatoorahPaymentWebhookStatus(
  invoiceStatus: unknown,
  transactionStatus: unknown,
): PaymentStatus {
  const invoice = mapMyFatoorahInvoiceStatus(invoiceStatus);
  if (invoice === "paid") {
    return "paid";
  }
  if (invoice === "pending") {
    return "pending";
  }
  if (invoice === "cancelled" || invoice === "failed") return invoice;
  switch (mapMyFatoorahTransactionEvidence(transactionStatus)) {
    case "authorized":
      return "pending";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

export function withRelatedIdsOnPaymentEvent(
  event: NonNullable<WebhookEvent["event"]>,
  relatedIds: { paymentId?: string | undefined },
): NonNullable<WebhookEvent["event"]> {
  if (!("payment" in event) || event.payment === undefined) return event;
  const paymentId = relatedIds.paymentId;
  if (paymentId === undefined) return event;
  const payment = event.payment;
  return {
    ...event,
    payment: {
      ...payment,
      references: {
        ...payment.references,
        relatedIds: {
          ...payment.references.relatedIds,
          paymentId,
        },
      },
    },
  };
}
function webhookMoneyFromAmountRecord(
  amount: unknown,
): { amount: number; currency: string } | undefined {
  const rec = asRecord(amount);
  const tryParse = (
    value: unknown,
    currency: unknown,
  ): { amount: number; currency: string } | undefined => {
    if (typeof currency !== "string" || currency.trim().length !== 3) return undefined;
    const cur = currency.trim().toUpperCase();
    if (value === undefined || value === null) return undefined;
    try {
      const money = parseMyFatoorahAmount(value, cur);
      return { amount: myFatoorahMajorNumber(money, cur), currency: cur };
    } catch {
      return undefined;
    }
  };
  // Prefer base currency, then display, then pay
  const base = tryParse(rec.ValueInBaseCurrency, rec.BaseCurrency);
  if (base !== undefined) return base;
  const display = tryParse(rec.ValueInDisplayCurrency, rec.DisplayCurrency);
  if (display !== undefined) return display;
  const pay = tryParse(rec.ValueInPayCurrency, rec.PayCurrency);
  if (pay !== undefined) return pay;
  // Fallback legacy plain Value
  const fallback = tryParse(
    rec.Value ?? rec.Amount,
    rec.Currency ?? rec.BaseCurrency ?? rec.DisplayCurrency,
  );
  if (fallback !== undefined) return fallback;
  return undefined;
}

/** Webhook timestamp: `Event.CreationDate` ISO string, fail-closed. */
export function myFatoorahWebhookTimestamp(payload: unknown): Date {
  const event = asRecord((payload as Record<string, unknown>)?.Event);
  const created = event.CreationDate;
  if (typeof created !== "string" || created.trim().length === 0) {
    throw new InvalidRequestError("MyFatoorah webhook missing Event.CreationDate");
  }
  const parsed = new Date(created.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidRequestError("MyFatoorah webhook Event.CreationDate is not a valid ISO date");
  }
  return parsed;
}

function myFatoorahEventReference(payload: unknown): string {
  const event = asRecord((payload as Record<string, unknown>)?.Event);
  const reference = event.Reference;
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw new InvalidRequestError("MyFatoorah webhook missing Event.Reference");
  }
  return reference.trim();
}

export function parseMyFatoorahPaymentWebhookEvent(payload: unknown): WebhookEvent {
  if (myFatoorahWebhookKind(payload) !== "payment") {
    throw new InvalidRequestError("Expected a PAYMENT_STATUS_CHANGED webhook");
  }
  const data = asRecord((payload as Record<string, unknown>)?.Data);
  const invoice = asRecord(data.Invoice);
  const transaction = asRecord(data.Transaction);

  const invoiceId = stringOrNumberId(invoice.Id);
  if (invoiceId === undefined) {
    throw new InvalidRequestError("MyFatoorah webhook missing Invoice.Id");
  }
  const merchantId = invoice.ExternalIdentifier;
  const paymentId =
    typeof merchantId === "string" && merchantId.length > 0 ? merchantId : undefined;
  const status = myFatoorahPaymentWebhookStatus(invoice.Status, transaction.Status);
  const transactionPaymentId = stringOrNumberId(transaction.PaymentId);
  const nativeType = `invoice.${typeof invoice.Status === "string" ? invoice.Status : "UNKNOWN"}`;
  const stable = inferMyFatoorahStableType("invoice", status);
  const timestamp = myFatoorahWebhookTimestamp(payload);
  const id = myFatoorahEventReference(payload);
  const money = webhookMoneyFromAmountRecord(data.Amount);

  const legacy: WebhookEvent = {
    id,
    type: stable ?? nativeType,
    gateway: "myfatoorah",
    paymentId,
    gatewayPaymentId: invoiceId,
    status,
    timestamp,
    rawPayload: payload,
    ...(money !== undefined ? { amount: money.amount, currency: money.currency } : {}),
  };

  const attached = attachPaymentEvent(legacy);
  const provider = attached.provider
    ? { ...attached.provider, eventType: nativeType }
    : attached.provider;
  const nested = attached.event
    ? withRelatedIdsOnPaymentEvent(
        {
          ...attached.event,
          provider: { ...attached.event.provider, eventType: nativeType },
        },
        { paymentId: transactionPaymentId },
      )
    : attached.event;
  return {
    ...attached,
    type: nativeType,
    ...(provider !== undefined ? { provider } : {}),
    ...(nested !== undefined ? { event: nested } : {}),
    payloadHash: hashWebhookPayload(payload),
  };
}

export function parseMyFatoorahRefundWebhookEvent(payload: unknown): WebhookEvent {
  if (myFatoorahWebhookKind(payload) !== "refund") {
    throw new InvalidRequestError("Expected a REFUND_STATUS_CHANGED webhook");
  }
  const data = asRecord((payload as Record<string, unknown>)?.Data);
  const refund = asRecord(data.Refund);
  // Official shape has ReferencedInvoice as sibling of Refund; legacy nests it under Refund.
  const referencedInvoice = asRecord(
    data.ReferencedInvoice !== undefined ? data.ReferencedInvoice : refund.ReferencedInvoice,
  );

  const invoiceId = stringOrNumberId(referencedInvoice.Id);
  if (invoiceId === undefined) {
    throw new InvalidRequestError("MyFatoorah webhook missing ReferencedInvoice.Id");
  }
  const refundId = stringOrNumberId(refund.Id);
  if (refundId === undefined) {
    throw new InvalidRequestError("MyFatoorah webhook missing Refund.Id");
  }
  const status = mapMyFatoorahRefundPaymentStatus(refund.Status);
  const nativeType = `refund.${typeof refund.Status === "string" ? refund.Status : "UNKNOWN"}`;
  const stable = inferMyFatoorahStableType("refund", status);
  const timestamp = myFatoorahWebhookTimestamp(payload);
  const id = myFatoorahEventReference(payload);
  const refundMoney = webhookMoneyFromAmountRecord(
    data.Amount !== undefined ? data.Amount : refund.Amount,
  );

  const legacy: WebhookEvent = {
    id,
    type: stable ?? nativeType,
    gateway: "myfatoorah",
    paymentId: undefined,
    gatewayPaymentId: invoiceId,
    gatewayObjectId: refundId,
    status,
    timestamp,
    rawPayload: payload,
    ...(refundMoney !== undefined
      ? { amount: refundMoney.amount, currency: refundMoney.currency }
      : {}),
  };

  const attached = attachPaymentEvent(legacy);
  const provider = attached.provider
    ? { ...attached.provider, eventType: nativeType }
    : attached.provider;
  const nested = attached.event
    ? {
        ...attached.event,
        provider: { ...attached.event.provider, eventType: nativeType },
      }
    : attached.event;
  return {
    ...attached,
    type: nativeType,
    ...(provider !== undefined ? { provider } : {}),
    ...(nested !== undefined ? { event: nested } : {}),
    payloadHash: hashWebhookPayload(payload),
  };
}
