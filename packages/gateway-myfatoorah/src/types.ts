import type { CreatePaymentParams, GetPaymentParams, RefundParams } from "@paykernel/core";

/**
 * Payment methods accepted on V3 create. `INVOICE` renders the hosted
 * all-methods page; specific methods narrow the page. Never cardholder data.
 */
export type MyFatoorahPaymentMethod =
  | "INVOICE"
  | "CARD"
  | "APPLE_PAY"
  | "GOOGLE_PAY"
  | "KNET"
  | "BENEFIT"
  | "STC_PAY"
  | "MADA"
  | "QPAY"
  | "OMANNET";

/** Optional customer block for V3 create (all fields optional). */
export type MyFatoorahCustomerInput = {
  name?: string;
  email?: string;
  mobile?: { countryCode: string; number: string };
  /** Order / transaction id in your system (returned in webhooks). */
  reference?: string;
  civilId?: string;
};

/**
 * Typed MyFatoorah create payload. Extends the common 0.x create shape with
 * MyFatoorah-only fields. Do not add these keys to core `CreatePaymentParams`.
 */
export type MyFatoorahCreatePaymentParams = CreatePaymentParams & {
  /** Customer details. Optional. `customerId` becomes `{ Reference }` when omitted. */
  myfatoorahCustomer?: MyFatoorahCustomerInput;
  /**
   * PaymentMethod on V3 create. Omitted (and no config default): the hosted
   * page shows all methods enabled on the account. Never send `OperationType`
   * (defaults PAY) and never send `SaveCardOptions`.
   */
  myfatoorahPaymentMethod?: MyFatoorahPaymentMethod;
  /** Lowercase method tokens shown on the page (`card`, `knet`, `googlepay`, …). */
  myfatoorahDisplayPaymentMethods?: string[];
  /** Invoice language. Default: omitted (portal default). */
  myfatoorahLanguage?: "EN" | "AR";
  /** Per-request `IntegrationUrls.Webhook` override (else config `webhookUrl`). */
  myfatoorahWebhookUrl?: string;
  /** Embedded-session id from MyFatoorah embedded payments (SourceOfFund.SessionId). */
  myfatoorahSessionId?: string;
  /** Saved-card token id (SourceOfFund.Token). Never a PAN. */
  myfatoorahToken?: string;
};

export type MyFatoorahRefundParams = RefundParams & {
  /** Refund comment (max 500 chars). Defaults to trimmed `reason` when omitted. */
  myfatoorahComment?: string;
};

export type MyFatoorahGetPaymentParams = GetPaymentParams & {
  /** GetPaymentStatus lookup key. Default: InvoiceId. */
  myfatoorahKeyType?: "InvoiceId" | "PaymentId";
};

export type MyFatoorahObjectKind = "invoice" | "refund";

/** MyFatoorah API envelope: `{ IsSuccess, Message, ValidationErrors, Data }`. */
export type MyFatoorahApiEnvelope = {
  IsSuccess?: unknown;
  Message?: unknown;
  ValidationErrors?: unknown;
  Data?: unknown;
};
