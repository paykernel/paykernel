import { InvalidRequestError } from "@paykernel/core";
import type { MyFatoorahPaymentMethod } from "./types";

const MYFATOORAH_PAYMENT_METHODS: Record<string, true> = {
  INVOICE: true,
  CARD: true,
  APPLE_PAY: true,
  GOOGLE_PAY: true,
  KNET: true,
};

/** PaymentMethod must be an uppercase documented method token (never a PAN). */
export function assertMyFatoorahPaymentMethod(
  method: unknown,
): asserts method is MyFatoorahPaymentMethod {
  if (typeof method !== "string" || MYFATOORAH_PAYMENT_METHODS[method] !== true) {
    throw new InvalidRequestError(
      `Unsupported MyFatoorah PaymentMethod "${String(method)}". Use ${Object.keys(
        MYFATOORAH_PAYMENT_METHODS,
      ).join(", ")}.`,
    );
  }
}

const DISPLAY_METHOD_TOKEN = /^[a-z][a-z0-9_-]*$/;

/** `DisplayPaymentMethods` entries are lowercase method tokens (`card`, `knet`, …). */
export function assertMyFatoorahDisplayPaymentMethods(methods: string[]): void {
  for (const method of methods) {
    if (typeof method !== "string" || !DISPLAY_METHOD_TOKEN.test(method)) {
      throw new InvalidRequestError(
        `Invalid MyFatoorah DisplayPaymentMethods entry "${String(method)}". Use lowercase method tokens like card, knet, googlepay, applepay.`,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * PCI fence: this backend adapter only sends `SourceOfFund.SessionId` /
 * `SourceOfFund.Token`. Raw `SourceOfFund.Card`, `myfatoorahCard`,
 * `source.card`, `Card.Number` / `SecurityCode` blobs are rejected before
 * any fetch. (Core `assertNoRawCardMaterial` also fences the full params.)
 */
export function assertNoPciCardSource(params: Record<string, unknown>): void {
  const sourceOfFund = params.SourceOfFund;
  if (isRecord(sourceOfFund) && sourceOfFund.Card !== undefined && sourceOfFund.Card !== null) {
    throw new InvalidRequestError(
      "MyFatoorah PCI SourceOfFund.Card is not accepted by this backend adapter",
    );
  }
  if (params.myfatoorahCard !== undefined && params.myfatoorahCard !== null) {
    throw new InvalidRequestError(
      "MyFatoorah PCI card objects are not accepted by this backend adapter",
    );
  }
  const source = params.source;
  if (isRecord(source) && source.card !== undefined && source.card !== null) {
    throw new InvalidRequestError(
      "MyFatoorah PCI source.card is not accepted by this backend adapter",
    );
  }
  const card = params.Card;
  if (
    isRecord(card) &&
    ((card.Number !== undefined && card.Number !== null) ||
      (card.SecurityCode !== undefined && card.SecurityCode !== null))
  ) {
    throw new InvalidRequestError(
      "MyFatoorah PCI card details are not accepted by this backend adapter",
    );
  }
}

/**
 * Resolve MyFatoorah V3 `Customer.Reference` (CustomerIdentifier).
 *
 * Official V3 contract: `Invoice.ExternalIdentifier` (webhook `paymentId`) is
 * populated from `Customer.Reference`, NOT from `Order.ExternalIdentifier` alone.
 * To make webhooks correlatable, Customer.Reference must be the merchant
 * orderId — or an explicit `myfatoorahCustomer.reference` override.
 *
 * `gateway.ts#buildCreateBody` sends `orderId` as **both**
 * `Order.ExternalIdentifier` and `Customer.Reference` (both carry `orderId` when
 * no explicit `myfatoorahCustomer.reference`). Webhook `Data.Invoice` contains
 * `ExternalIdentifier` (= `Customer.Reference` = `orderId`); the inbox can
 * correlate via either identifier, but `paymentId` is always `Customer.Reference`.
 *
 * NEVER use `customerId` (opaque user/session id) as Reference. That field
 * belongs to PayKernel's generic customer model, not MyFatoorah's per-order
 * CustomerIdentifier. Using it breaks webhook `paymentId` correlation and
 * leaks internal user ids to the provider.
 *
 * Priority: 1) explicit `myfatoorahCustomer.reference` (trimmed non-empty)
 *           2) `orderId` (trimmed non-empty)
 *           → `undefined` when neither is provided. Callers must not pass
 *           `customerId` here: core's opaque customer id is not a MyFatoorah
 *           per-order CustomerIdentifier.
 *
 * @see gateway.ts#buildCreateBody for the Order.ExternalIdentifier + Customer.Reference wiring.
 * @see docs/webhooks.md for `paymentId` correlation and docs/overview.md for the dual-send contract.
 */
export function resolveMyFatoorahCustomerReference(input: {
  orderId?: string | undefined;
  myfatoorahCustomerReference?: string | undefined;
}): string | undefined {
  const explicit = input.myfatoorahCustomerReference;
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim();
  const order = input.orderId;
  if (typeof order === "string" && order.trim().length > 0) return order.trim();
  return undefined;
}
