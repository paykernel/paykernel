import type {
  CaptureParams,
  CommonPaymentInput,
  OperationRequestOptions,
  RefundParams,
  VoidParams,
} from "@paykernel/core";

/** Existing Tap customer id, or inline customer details required by Charges. */
export type TapCustomerInput =
  | { id: string }
  | {
      firstName: string;
      email: string;
      lastName?: string;
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
export type TapCreatePaymentParams = CommonPaymentInput &
  OperationRequestOptions & {
    currency: string;
    callbackUrl: string;
    capture?: boolean;
    idempotencyKey?: string;
    /**
     * Customer for the Tap charge/authorize. Either an existing `cus_…` id or
     * inline first name + email. `customerId` on {@link CreatePaymentParams}
     * is accepted as `{ id }` when this field is omitted.
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

export type TapCaptureParams = CaptureParams;
export type TapRefundParams = RefundParams & {
  tapReason?: TapRefundReason;
};
export type TapVoidParams = VoidParams;

export type TapObjectKind = "charge" | "authorize" | "refund";

export type TapChargeStatus =
  | "INITIATED"
  | "ABANDONED"
  | "CANCELLED"
  | "FAILED"
  | "DECLINED"
  | "RESTRICTED"
  | "CAPTURED"
  | "VOID"
  | "TIMEDOUT"
  | "UNKNOWN"
  | "AUTHORIZED";

export type TapRefundStatus =
  | "REFUNDED"
  | "PENDING"
  | "IN PROGRESS"
  | "CANCELED"
  | "FAILED"
  | "DECLINED"
  | "RESTRICTED"
  | "TIMEDOUT"
  | "UNKNOWN";

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
