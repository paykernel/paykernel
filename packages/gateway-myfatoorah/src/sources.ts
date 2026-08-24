import { InvalidRequestError } from "@paykernel/core";
import type { MyFatoorahPaymentMethod } from "./types";

const MYFATOORAH_PAYMENT_METHODS: Record<string, true> = {
  INVOICE: true,
  CARD: true,
  APPLE_PAY: true,
  GOOGLE_PAY: true,
  KNET: true,
  BENEFIT: true,
  STC_PAY: true,
  MADA: true,
  QPAY: true,
  OMANNET: true,
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

const DISPLAY_METHOD_TOKEN = /^[a-z][a-z0-9_]*$/;

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
 * `source.card`, or `Card.Number` / `SecurityCode` blobs are rejected before
 * any fetch. (Core `assertNoRawCardMaterial` also fences the full params.)
 */
export function assertNoPciCardSource(params: Record<string, unknown>): void {
  const sourceOfFund = params.SourceOfFund;
  if (isRecord(sourceOfFund)) {
    if (sourceOfFund.Card !== undefined && sourceOfFund.Card !== null) {
      throw new InvalidRequestError(
        "MyFatoorah PCI SourceOfFund.Card is not accepted by this backend adapter",
      );
    }
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
  if (isRecord(card)) {
    if (
      (card.Number !== undefined && card.Number !== null) ||
      (card.SecurityCode !== undefined && card.SecurityCode !== null)
    ) {
      throw new InvalidRequestError(
        "MyFatoorah PCI card details are not accepted by this backend adapter",
      );
    }
  }
}
