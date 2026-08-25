import {
  attachPaymentEvent,
  hashWebhookPayload,
  InvalidRequestError,
  type PaymentStatus,
  type WebhookEvent,
} from "@paykernel/core";
import { normalizeMyFatoorahCurrency } from "./currency";
import { myFatoorahMajorNumber, parseMyFatoorahAmount } from "./money";
import {
  inferMyFatoorahStableType,
  mapMyFatoorahInvoiceStatus,
  mapMyFatoorahRefundPaymentStatus,
  mapMyFatoorahTransactionEvidence,
} from "./status";
import { coerceWebhookPayload, myFatoorahWebhookKind } from "./webhooks";

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
 *
 * Stateless mapper — does NOT remember prior webhook state. Invoice `PAID`
 * is authoritative per https://docs.myfatoorah.com/docs/v3-updating-payment-status-guidelines
 * and stays `paid` regardless of Transaction status (KNET can emit
 * duplicate/aux transaction statuses). A pending invoice stays pending even
 * when transaction is `AUTHORIZE` (auth/capture not implemented; no fulfilled
 * authorized state). Customer can retry the same invoice when transaction failed.
 *
 * Paid is terminal: this mapper returns `paid` for `PAID` accurately, but it
 * cannot downgrade a prior `paid` if a later webhook delivers `PENDING` —
 * callers must enforce terminal Paid at the application/inbox layer
 * (e.g. `PaymentClient.handleWebhook` inbox `claim` + ignore `pending`/`failed`
 * after `paid` for the same `Invoice.Id`/`ExternalIdentifier`).
 * See `docs/webhooks.md#paid-is-terminal` and
 * https://docs.myfatoorah.com/docs/v3-updating-payment-status-guidelines.
 *
 * Unknown invoice status (→ `failed` via shared `mapMyFatoorahInvoiceStatus`)
 * stays `failed` and never becomes `paid` via transaction evidence alone:
 * `UNKNOWN` + `SUCCESS` → `failed` (fail-closed). Only explicit `PAID` maps
 * to `paid`. Shared with `getPayment` via `mapMyFatoorahInvoiceStatus`.
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
  if (
    invoice === "cancelled" ||
    invoice === "failed" ||
    invoice === "refunded" ||
    invoice === "partially_refunded"
  ) {
    return invoice;
  }
  switch (mapMyFatoorahTransactionEvidence(transactionStatus)) {
    case "authorized":
      return "pending";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

/**
 * Whether a MyFatoorah payment status is terminal Paid.
 * Use at the application/inbox layer to ensure a previously fulfilled
 * `paid` order is not un-fulfilled by a later `pending`/`failed` webhook
 * for the same `Invoice.Id`/`ExternalIdentifier` (stateless mapper cannot
 * enforce this). See `docs/webhooks.md#paid-is-terminal`.
 * @see https://docs.myfatoorah.com/docs/v3-updating-payment-status-guidelines
 */
export function isMyFatoorahPaidTerminal(status: PaymentStatus): boolean {
  return status === "paid";
}

/**
 * Attach `Transaction.PaymentId` (gateway paymentId) to the `payment` event's
 * `references.relatedIds.paymentId`.
 *
 * `paymentId` (merchant `paymentId` / `Invoice.ExternalIdentifier`) itself is
 * set from `Invoice.ExternalIdentifier` which is `Customer.Reference` (orderId
 * or explicit `myfatoorahCustomer.reference`) — see `sources.ts` and
 * `gateway.ts#buildCreateBody` where `orderId` is sent as both
 * `Order.ExternalIdentifier` and `Customer.Reference` so the webhook reliably
 * carries it for `paymentId` correlation. `Transaction.PaymentId` is the
 * provider's payment attempt id and rides `relatedIds` instead.
 */
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

/**
 * Webhook `Amount` uses the portal's base currency (e.g. KWD) while create/getPayment
 * Amounts are in the requested pay/display currency (e.g. SAR). Webhook surfaced
 * `amount`/`currency` is therefore intentionally the base amount — keep base preference
 * here. create/getPayment prefer pay → display → base by request currency; webhook-map
 * prefers base → display → pay. This drift is by design (webhook vs. checkout currency
 * differ; see `docs/money.md` MF-WEBHOOK-MONEY-DRIFT). Currency aliases (KD→KWD, SR→SAR
 * and dotted variants `K.D.` / `S.R.`) are normalized via `normalizeMyFatoorahCurrency`
 * and amounts handle grouping commas (`12,345.000`) via `parseMyFatoorahAmount`.
 */
function webhookMoneyFromAmountRecord(
  amount: unknown,
): { amount: number; currency: string } | undefined {
  const rec = asRecord(amount);
  const tryParse = (
    value: unknown,
    currency: unknown,
  ): { amount: number; currency: string } | undefined => {
    const normalized = normalizeMyFatoorahCurrency(currency);
    if (normalized === undefined) return undefined;
    if (value === undefined || value === null) return undefined;
    try {
      const money = parseMyFatoorahAmount(value, normalized);
      return { amount: myFatoorahMajorNumber(money, normalized), currency: normalized };
    } catch {
      return undefined;
    }
  };
  // Prefer base currency (webhook amount is always base), then display, then pay
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
  const normalized = coerceWebhookPayload(payload);
  const event = asRecord((normalized as Record<string, unknown>).Event);
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
  const normalized = coerceWebhookPayload(payload);
  const event = asRecord((normalized as Record<string, unknown>).Event);
  const reference = event.Reference;
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw new InvalidRequestError("MyFatoorah webhook missing Event.Reference");
  }
  return reference.trim();
}

export function parseMyFatoorahPaymentWebhookEvent(payload: unknown): WebhookEvent {
  const normalized = coerceWebhookPayload(payload);
  if (myFatoorahWebhookKind(normalized) !== "payment") {
    throw new InvalidRequestError("Expected a PAYMENT_STATUS_CHANGED webhook");
  }
  const data = asRecord((normalized as Record<string, unknown>).Data);
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
  const timestamp = myFatoorahWebhookTimestamp(normalized);
  const id = myFatoorahEventReference(normalized);
  const money = webhookMoneyFromAmountRecord(data.Amount);

  const legacy: WebhookEvent = {
    id,
    type: stable ?? nativeType,
    gateway: "myfatoorah",
    paymentId,
    gatewayPaymentId: invoiceId,
    status,
    timestamp,
    rawPayload: normalized,
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
    payloadHash: hashWebhookPayload(normalized),
  };
}

export function parseMyFatoorahRefundWebhookEvent(payload: unknown): WebhookEvent {
  const normalized = coerceWebhookPayload(payload);
  if (myFatoorahWebhookKind(normalized) !== "refund") {
    throw new InvalidRequestError("Expected a REFUND_STATUS_CHANGED webhook");
  }
  const data = asRecord((normalized as Record<string, unknown>).Data);
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
  const timestamp = myFatoorahWebhookTimestamp(normalized);
  const id = myFatoorahEventReference(normalized);
  const refundMoney = webhookMoneyFromAmountRecord(
    data.Amount !== undefined ? data.Amount : refund.Amount,
  );
  // ReferencedInvoice.ExternalIdentifier carries the original orderId (Customer.Reference).
  // Do not fallback to Refund.ExternalIdentifier (refund idempotency key).
  const referencedExternalId =
    typeof referencedInvoice.ExternalIdentifier === "string" &&
    referencedInvoice.ExternalIdentifier.trim().length > 0
      ? referencedInvoice.ExternalIdentifier.trim()
      : undefined;
  const legacy: WebhookEvent = {
    id,
    type: stable ?? nativeType,
    gateway: "myfatoorah",
    paymentId: referencedExternalId,
    gatewayPaymentId: invoiceId,
    gatewayObjectId: refundId,
    status,
    timestamp,
    rawPayload: normalized,
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
    payloadHash: hashWebhookPayload(normalized),
  };
}
