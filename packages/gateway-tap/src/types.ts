import type {
  CaptureParams,
  CreatePaymentParams,
  RefundParams,
  VoidParams,
} from "@paykernel/core";

/** Existing Tap customer id, or inline customer details required by Charges. */
export type TapCustomerInput =
  | { id: string }
  | {
      firstName: string;
      lastName: string;
      email: string;
      middleName?: string;
      phone?: { countryCode: string; number: string };
    };

/**
 * Payment source id. Tokens (`tok_…`), hosted method lists (`src_all`,
 * `src_card`), and documented local methods (`src_kw.knet`, `src_sa.mada`, …).
 * Never a raw PAN or PCI `source.card` blob.
 */
export type TapSource = {
  id: string;
};

export type TapRefundReason =
  | "duplicate"
  | "fraudulent"
  | "requested_by_customer";

/**
 * Typed Tap create payload. Extends the common 0.x create shape with Tap-only
 * fields. Do not add these keys to core `CreatePaymentParams`.
 */
export type TapCreatePaymentParams = CreatePaymentParams & {
  /**
   * Customer for the Tap charge/authorize. Either an existing `cus_…` id or
   * inline first name + last name + email (Tap error 1132 requires last name).
   * `customerId` on {@link CreatePaymentParams} is accepted as `{ id }` when
   * this field is omitted.
   */
  tapCustomer?: TapCustomerInput;
  /**
   * Source id. Defaults to `src_all` (Tap hosted methods page). Tokens and
   * local methods (`src_kw.knet`, …) must be explicit.
   */
  tapSource?: TapSource;
  /** Per-request `post.url` override (else config `webhookUrl`). */
  tapPostUrl?: string;
  /** 3-D Secure. Default `true`. */
  tapThreeDSecure?: boolean;
  /** Per-request merchant id override. */
  tapMerchantId?: string;
};

export type TapCaptureParams = CaptureParams & {
  /** Per-request `redirect.url` override (else authorize object `redirect.url`). */
  tapRedirectUrl?: string;
};
export type TapRefundParams = RefundParams & {
  tapReason?: TapRefundReason;
};
export type TapVoidParams = VoidParams;

export type TapObjectKind = "charge" | "authorize" | "refund";

/** Minimal Tap JSON object used by mapping helpers. */
export type TapApiObject = {
  id?: unknown;
  object?: unknown;
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
  live_mode?: unknown;
  api_version?: unknown;
  description?: unknown;
  customer?: unknown;
  source?: unknown;
  transaction?: unknown;
  reference?: unknown;
  response?: unknown;
  redirect?: unknown;
  post?: unknown;
  card?: unknown;
  charge_id?: unknown;
  errors?: unknown;
};
