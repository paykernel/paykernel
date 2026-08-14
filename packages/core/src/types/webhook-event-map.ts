// file: packages/core/src/types/webhook-event-map.ts

/**
 * Provider-native webhook event type → stable {@link StablePaymentEventType}
 * mapping (Phase 7).
 *
 * Pure data + pure functions. Provider-native names are **never** renamed on
 * {@link import('./webhook.types').WebhookEvent.type}; they live on
 * {@link import('./payment-event').ProviderEventMetadata.eventType}.
 *
 * Policy: map only when the stable name is unambiguous. Ambiguous domains
 * (Stripe invoice/subscription schedules, Paymob redirect-only without status
 * context, unknown custom gateway events) return `'provider.unmapped'`.
 *
 * Paymob honesty:
 * - `TRANSACTION_RESPONSE` (browser/redirect) never dual-writes fulfillment-ready
 *   `payment.succeeded` / `capture.completed` — use `payment.processing` and wait
 *   for the processed `TRANSACTION` webhook (or inquiry).
 * - `partially_captured` is not full settlement (`isPaidOutcome` excludes it) →
 *   `payment.processing`, not `payment.succeeded` (Paymob flags/status and Stripe
 *   `payment_intent.succeeded` dual-write when context.status is partially_captured).
 *
 * Cross-gateway: domain status `approved` (PayPal buyer pre-capture) is never
 * mapped to `payment.succeeded` on status-only fallbacks — use `payment.processing`.
 *
 * @see docs/webhook-events.md
 */

import {
  isStablePaymentEventType,
  type StablePaymentEventType,
} from "./stable-payment-event-types";

/** Result of {@link mapProviderEventTypeToStable}. */
export type MappedStableEventType = StablePaymentEventType | "provider.unmapped";

/**
 * Optional context for status-/flag-dependent mappings (Paymob transaction
 * flags, Stripe checkout payment_status, refund entity status, etc.).
 */
export type ProviderEventMapContext = {
  /** Normalized or provider-native status string when known. */
  status?: string;
  /** Provider object type (e.g. Stripe `data.object.object`). */
  objectType?: string;
  /**
   * Paymob / similar boolean-ish transaction flags.
   * Prefer explicit flags over inventing from free-form type alone.
   */
  flags?: {
    success?: boolean;
    pending?: boolean;
    isAuth?: boolean;
    isCapture?: boolean;
    isVoid?: boolean;
    isRefund?: boolean;
    isVoided?: boolean;
    isRefunded?: boolean;
  };
  /**
   * Paymob (and similar) amount fields in **minor units**.
   * Used so dual-write stable types agree with amount-derived status
   * (`refunded_amount_cents` alone, `captured_amount` vs sticky `is_auth`).
   * Prefer normalized `status` when both are present.
   */
  amounts?: {
    amountCents?: number;
    refundedAmountCents?: number;
    capturedAmountCents?: number;
  };
  /**
   * Stripe checkout.session payment_status, or similar secondary signal.
   */
  paymentStatus?: string;
  /** Stripe checkout session mode (`payment` | `setup` | `subscription`). */
  mode?: string;
};

// ─── Stripe ──────────────────────────────────────────────────────────────────

/**
 * Direct Stripe event.type → stable map for unambiguous events.
 * Status-dependent cases (checkout.session.completed, refunds,
 * payment_intent.succeeded partial capture) are handled in
 * {@link mapStripeEventType}.
 */
export const STRIPE_EVENT_TYPE_MAP: Readonly<
  Record<string, StablePaymentEventType>
> = {
  "payment_intent.created": "payment.created",
  "payment_intent.processing": "payment.processing",
  "payment_intent.requires_action": "payment.processing",
  "payment_intent.amount_capturable_updated": "payment.authorized",
  "payment_intent.succeeded": "payment.succeeded",
  "payment_intent.payment_failed": "payment.failed",
  "payment_intent.canceled": "payment.cancelled",
  "checkout.session.async_payment_succeeded": "payment.succeeded",
  "checkout.session.async_payment_failed": "payment.failed",
  "checkout.session.expired": "payment.cancelled",
  "setup_intent.succeeded": "payment_method.setup_completed",
  "charge.dispute.created": "dispute.opened",
  "charge.dispute.updated": "dispute.updated",
  "charge.dispute.closed": "dispute.closed",
  "charge.dispute.funds_withdrawn": "dispute.updated",
  "charge.dispute.funds_reinstated": "dispute.updated",
  // charge.refunded is the charge-level "refund activity happened" signal.
  // Status-dependent demotion (refund_completed → refund.pending) is in
  // mapStripeEventType (CORE-2); bare type without incomplete status stays completed.
  "charge.refunded": "refund.completed",
  "refund.failed": "refund.failed",
};

/** Stripe event types intentionally left unmapped (ambiguous / non-payment). */
export const STRIPE_UNMAPPED_EVENT_TYPES: readonly string[] = [
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "invoice.created",
  "invoice.finalized",
  "invoice.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "subscription_schedule.created",
  "subscription_schedule.updated",
  "subscription_schedule.released",
  "subscription_schedule.canceled",
  "subscription_schedule.completed",
  "subscription_schedule.expiring",
  "subscription_schedule.aborted",
];

function mapStripeEventType(
  providerEventType: string,
  context?: ProviderEventMapContext,
): MappedStableEventType {
  if (STRIPE_UNMAPPED_EVENT_TYPES.includes(providerEventType)) {
    return "provider.unmapped";
  }

  if (providerEventType === "checkout.session.completed") {
    // Prefer provider payment_status; also accept normalized WebhookEvent.status
    // so dual-write works without gateway-specific mapContext.
    if (
      context?.paymentStatus === "paid" ||
      context?.status === "paid"
    ) {
      return "payment.succeeded";
    }
    if (
      context?.status === "setup_completed" ||
      (context?.paymentStatus === "no_payment_required" &&
        (context.mode === "setup" || context.objectType === "setup_intent"))
    ) {
      return "payment_method.setup_completed";
    }
    // complete without paid — not a stable success
    return "provider.unmapped";
  }

  // Partial capture: domain status is partially_captured but Stripe still emits
  // payment_intent.succeeded. Demote dual-write to payment.processing so type-only
  // fulfillment matches isPaidOutcome (partial is not paid-like). Full paid keeps
  // STRIPE_EVENT_TYPE_MAP → payment.succeeded.
  if (providerEventType === "payment_intent.succeeded") {
    const status = (context?.status ?? "").toLowerCase();
    if (status === "partially_captured") {
      return "payment.processing";
    }
  }

  // CORE-2: charge.refunded is charge-level refund activity. Static map settles
  // as refund.completed, but incomplete domain snapshots (refund_completed) must
  // demote to refund.pending so pure attachPaymentEvent / custom gateways match
  // Stripe gateway demotion and type-only handlers do not over-settle.
  if (providerEventType === "charge.refunded") {
    const status = (context?.status ?? "").toLowerCase();
    if (status === "refund_completed") {
      return "refund.pending";
    }
    if (status === "failed" || status === "canceled" || status === "cancelled") {
      return "refund.failed";
    }
    if (status === "pending" || status === "requires_action") {
      return "refund.pending";
    }
    if (
      status === "refunded" ||
      status === "partially_refunded" ||
      status === "succeeded" ||
      status === "completed" ||
      status === ""
    ) {
      // Proven full/partial (or bare charge.refunded without status context —
      // gateway is expected to set domain status when incomplete).
      return "refund.completed";
    }
    // Unrecognized status: fail-closed pending rather than type-only settle.
    return "refund.pending";
  }

  if (
    providerEventType === "refund.created" ||
    providerEventType === "refund.updated" ||
    providerEventType === "charge.refund.updated"
  ) {
    const status = (context?.status ?? "").toLowerCase();
    if (status === "failed" || status === "canceled" || status === "cancelled") {
      return "refund.failed";
    }
    if (status === "pending" || status === "requires_action") {
      return "refund.pending";
    }
    if (
      status === "succeeded" ||
      status === "completed" ||
      status === "refunded" ||
      status === "partially_refunded"
    ) {
      return "refund.completed";
    }
    // Incomplete domain marker: dual-write stays pending until amount proves
    // full/partial (gateway demotion path). Do not type-only settle.
    if (status === "refund_completed") {
      return "refund.pending";
    }
    // CORE-1: empty / unknown status must not fail-open to refund.completed.
    // refund.created without status is creation (not settlement); refund.updated
    // / charge.refund.updated with missing or unrecognized status are incomplete
    // snapshots — type-only handlers must not mark refunds settled.
    return "refund.pending";
  }

  const direct = STRIPE_EVENT_TYPE_MAP[providerEventType];
  if (direct !== undefined) {
    return direct;
  }

  return "provider.unmapped";
}

// ─── Moyasar ─────────────────────────────────────────────────────────────────

/**
 * Moyasar envelope `type` → stable map.
 * Note: `payment_faild` is a historical Moyasar typo; gateways normalize to
 * `payment_failed` before dual-write, but both map here.
 */
export const MOYASAR_EVENT_TYPE_MAP: Readonly<
  Record<string, StablePaymentEventType>
> = {
  payment_paid: "payment.succeeded",
  payment_failed: "payment.failed",
  payment_faild: "payment.failed",
  payment_authorized: "payment.authorized",
  payment_abandoned: "payment.failed",
  payment_voided: "payment.cancelled",
  payment_refunded: "refund.completed",
  payment_captured: "capture.completed",
  payment_verified: "payment_method.setup_completed",
};

function mapMoyasarEventType(
  providerEventType: string,
  _context?: ProviderEventMapContext,
): MappedStableEventType {
  const direct = MOYASAR_EVENT_TYPE_MAP[providerEventType];
  if (direct !== undefined) {
    return direct;
  }
  // Unknown / free-form types stay unmapped. Do not status-fallback
  // (unknown + paid must not invent payment.succeeded).
  return "provider.unmapped";
}

// ─── PayPal ──────────────────────────────────────────────────────────────────

/**
 * PayPal `event_type` → stable map.
 *
 * **Choice:** `PAYMENT.CAPTURE.COMPLETED` → `capture.completed` (capture domain).
 * Fulfillment apps that previously keyed off status `paid` should switch on
 * `capture.completed` **or** treat it as money-settled. We deliberately do
 * **not** silently rename it to `payment.succeeded` (different semantic arm).
 *
 * **Partial auth capture:** `PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED` →
 * `payment.processing` (not `capture.completed` / `payment.succeeded`). Domain
 * status stays `partially_captured`; type-only fulfillment must not over-ship
 * (aligns with Paymob partial dual-write + `isPaidOutcome` paid-only).
 */
export const PAYPAL_EVENT_TYPE_MAP: Readonly<
  Record<string, StablePaymentEventType>
> = {
  "PAYMENT.CAPTURE.COMPLETED": "capture.completed",
  "PAYMENT.CAPTURE.DENIED": "payment.failed",
  "PAYMENT.CAPTURE.DECLINED": "payment.failed",
  "PAYMENT.CAPTURE.PENDING": "payment.processing",
  "PAYMENT.CAPTURE.REFUNDED": "refund.completed",
  "PAYMENT.REFUND.PENDING": "refund.pending",
  "PAYMENT.REFUND.COMPLETED": "refund.completed",
  "PAYMENT.REFUND.FAILED": "refund.failed",
  "PAYMENT.AUTHORIZATION.CREATED": "payment.authorized",
  "PAYMENT.AUTHORIZATION.VOIDED": "payment.cancelled",
  "PAYMENT.AUTHORIZATION.CAPTURED": "capture.completed",
  // Partial capture is an open money story — not full settlement type
  "PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED": "payment.processing",
  "CHECKOUT.ORDER.APPROVED": "payment.processing",
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED": "payment.cancelled",
  // Customer disputes (when present)
  "CUSTOMER.DISPUTE.CREATED": "dispute.opened",
  "CUSTOMER.DISPUTE.UPDATED": "dispute.updated",
  "CUSTOMER.DISPUTE.RESOLVED": "dispute.closed",
};

function mapPayPalEventType(
  providerEventType: string,
  context?: ProviderEventMapContext,
): MappedStableEventType {
  // CHECKOUT.ORDER.COMPLETED: only `paid` is settled money; `approved` is not capture
  if (providerEventType === "CHECKOUT.ORDER.COMPLETED") {
    const status = (context?.status ?? "").toLowerCase();
    if (status === "paid") return "payment.succeeded";
    if (status === "approved") return "payment.processing";
    return "provider.unmapped";
  }

  // REVERSED has no stable payment.reversed arm — do not invent cancelled
  if (providerEventType === "PAYMENT.CAPTURE.REVERSED") {
    return "provider.unmapped";
  }

  // PARTIALLY_CAPTURED → payment.processing via PAYPAL_EVENT_TYPE_MAP (not full settlement).
  const direct = PAYPAL_EVENT_TYPE_MAP[providerEventType];
  if (direct !== undefined) {
    return direct;
  }

  return "provider.unmapped";
}

// ─── Paymob ──────────────────────────────────────────────────────────────────

/**
 * Paymob type strings that are token/setup callbacks.
 */
export const PAYMOB_TOKEN_EVENT_TYPES: readonly string[] = ["TOKEN", "token"];

/**
 * Stable types that mean "money settled / capture complete" for fulfillment
 * switch arms. Redirect callbacks must never dual-write these.
 */
const PAYMOB_FULFILLMENT_READY_STABLE: ReadonlySet<MappedStableEventType> =
  new Set(["payment.succeeded", "capture.completed"]);

/**
 * True when amount fields show a partial capture (captured > 0 and < auth amount).
 * Missing either side → not proven partial (caller may still use status).
 */
function isPartialCaptureAmounts(
  amounts?: ProviderEventMapContext["amounts"],
): boolean {
  const captured = amounts?.capturedAmountCents;
  const amount = amounts?.amountCents;
  return (
    captured !== undefined &&
    amount !== undefined &&
    captured > 0 &&
    captured < amount
  );
}

/**
 * Map amount-/flag-derived capture (without status) to a stable type.
 * Explicit `is_capture` keeps the capture domain; amount-only partial capture
 * is `payment.processing` (aligns with `isPaidOutcome` excluding partial).
 */
function mapPaymobCaptureSettle(
  flags: NonNullable<ProviderEventMapContext["flags"]>,
  amounts?: ProviderEventMapContext["amounts"],
): MappedStableEventType {
  if (flags.isCapture === true) {
    return "capture.completed";
  }
  if (isPartialCaptureAmounts(amounts)) {
    return "payment.processing";
  }
  return "payment.succeeded";
}

/**
 * Map Paymob TRANSACTION flags/amounts to a stable type.
 *
 * Order aligns with `PaymobGateway.mapTransactionStatus`: normalized status
 * first, then amount-derived refunds, then flags. Never invent
 * `payment.succeeded` from uncertain outcomes. Partial capture is never
 * `payment.succeeded` (full paid only).
 */
function mapPaymobFromFlags(
  flags: NonNullable<ProviderEventMapContext["flags"]>,
  status?: string,
  amounts?: ProviderEventMapContext["amounts"],
): MappedStableEventType | undefined {
  const s = (status ?? "").toLowerCase();
  const hasAmountRefund =
    amounts?.refundedAmountCents !== undefined && amounts.refundedAmountCents > 0;
  const hasAmountCapture =
    amounts?.capturedAmountCents !== undefined && amounts.capturedAmountCents > 0;

  // Explicit capture action on paid-like / partial status keeps capture domain
  // (before generic status map). Capture-domain arms still require amount-aware
  // fulfillment for partials; they are not `payment.succeeded`.
  if (
    (s === "paid" || s === "approved" || s === "partially_captured") &&
    flags.isCapture === true &&
    flags.success === true
  ) {
    return "capture.completed";
  }

  // Status wins over bare success / sticky is_auth (amount-only refunds, auth+capture).
  const fromStatus = mapPaymobStatusOnly(status);
  if (fromStatus !== undefined) {
    return fromStatus;
  }

  // Amount-only refund when status absent (mirrors mapTransactionStatus).
  if (hasAmountRefund) {
    return "refund.completed";
  }

  if (flags.isVoid === true || flags.isVoided === true) {
    return "payment.cancelled";
  }
  // is_refunded = terminal state; is_refund action requires success (gateway parity).
  if (flags.isRefunded === true) {
    return "refund.completed";
  }
  if (flags.isRefund === true && flags.success === true) {
    return "refund.completed";
  }

  // Capture amounts / is_capture beat sticky is_auth.
  if (flags.isAuth === true && flags.success === true) {
    if (flags.isCapture === true || hasAmountCapture) {
      return mapPaymobCaptureSettle(flags, amounts);
    }
    return "payment.authorized";
  }
  if (flags.isCapture === true && flags.success === true) {
    return "capture.completed";
  }
  if (hasAmountCapture && flags.success === true) {
    return mapPaymobCaptureSettle(flags, amounts);
  }
  if (flags.success === true) {
    return "payment.succeeded";
  }
  if (flags.pending === true) {
    return "payment.processing";
  }
  if (flags.success === false) {
    return "payment.failed";
  }

  return undefined;
}

/**
 * Status-only Paymob map. `payment.succeeded` only for full paid-like settlement
 * (`paid`). Buyer `approved` and `partially_captured` are open money stories →
 * `payment.processing` (matches `isPaidOutcome` / paid-like = paid only).
 */
function mapPaymobStatusOnly(status?: string): MappedStableEventType | undefined {
  const s = (status ?? "").toLowerCase();
  if (s === "paid") {
    return "payment.succeeded";
  }
  if (s === "approved" || s === "partially_captured") {
    return "payment.processing";
  }
  if (s === "failed") return "payment.failed";
  if (s === "authorized") return "payment.authorized";
  if (s === "cancelled" || s === "voided") return "payment.cancelled";
  // Full / partial refund money completeness only.
  if (s === "refunded" || s === "partially_refunded") {
    return "refund.completed";
  }
  // PAYMOB-3: incomplete refund snapshot (refund_completed) must not look done
  // to Phase-7-only handlers — preserve incomplete marker as refund.pending.
  if (s === "refund_completed") {
    return "refund.pending";
  }
  if (s === "pending" || s === "processing") return "payment.processing";
  if (s === "setup_completed") return "payment_method.setup_completed";
  return undefined;
}

/**
 * Resolve TRANSACTION / TRANSACTION_RESPONSE using flags, amounts, status.
 * Does not apply redirect demotion — caller handles TRANSACTION_RESPONSE.
 */
function mapPaymobTransactionSignals(
  context?: ProviderEventMapContext,
): MappedStableEventType | undefined {
  if (context?.flags) {
    const fromFlags = mapPaymobFromFlags(
      context.flags,
      context.status,
      context.amounts,
    );
    if (fromFlags !== undefined) return fromFlags;
  }
  // Amount-only without decisive flags (pure mapper / incomplete context)
  if (
    context?.amounts?.refundedAmountCents !== undefined &&
    context.amounts.refundedAmountCents > 0
  ) {
    return "refund.completed";
  }
  return mapPaymobStatusOnly(context?.status);
}

function mapPaymobEventType(
  providerEventType: string,
  context?: ProviderEventMapContext,
): MappedStableEventType {
  const upper = providerEventType.toUpperCase();
  if (PAYMOB_TOKEN_EVENT_TYPES.includes(providerEventType) || upper === "TOKEN") {
    return "payment_method.setup_completed";
  }

  const isRedirectResponse =
    upper === "TRANSACTION_RESPONSE" ||
    providerEventType === "TRANSACTION_RESPONSE";
  const isTransaction =
    upper === "TRANSACTION" || providerEventType === "TRANSACTION";

  // TRANSACTION / TRANSACTION_RESPONSE — require status, amounts, or flags
  if (isTransaction || isRedirectResponse) {
    const mapped = mapPaymobTransactionSignals(context);
    if (mapped === undefined) {
      // Redirect-only / bare type without usable signals — do not invent
      return "provider.unmapped";
    }

    // Browser/redirect callbacks must never look fulfillment-ready. Native type
    // distinguishes them from processed TRANSACTION server webhooks — demote
    // settlement arms so fulfill-on-succeeded handlers ignore redirects.
    if (
      isRedirectResponse &&
      PAYMOB_FULFILLMENT_READY_STABLE.has(mapped)
    ) {
      return "payment.processing";
    }
    return mapped;
  }

  // Only TOKEN / TRANSACTION / TRANSACTION_RESPONSE map. Unknown types stay
  // unmapped even when flags.success or status would otherwise settle.
  return "provider.unmapped";
}

// ─── Public mapper ───────────────────────────────────────────────────────────

/**
 * Map a provider-native webhook event type string to a stable name.
 *
 * Returns `'provider.unmapped'` when the mapping is unknown or ambiguous —
 * never invents a stable name. Provider-native type must still be preserved
 * on `ProviderEventMetadata.eventType`.
 *
 * @param gateway - Gateway id (`stripe` | `moyasar` | `paypal` | `paymob` | custom)
 * @param providerEventType - Provider-native type (e.g. `payment_intent.succeeded`)
 * @param context - Optional status/flags for ambiguous types
 */
export function mapProviderEventTypeToStable(
  gateway: string,
  providerEventType: string,
  context?: ProviderEventMapContext,
): MappedStableEventType {
  if (typeof providerEventType !== "string" || providerEventType.length === 0) {
    return "provider.unmapped";
  }

  // Already a stable name (e.g. dual-write consumers re-mapping) — accept as-is
  // so mapping is idempotent. Uses shared catalog (no duplicated name list).
  if (isStablePaymentEventType(providerEventType)) {
    return providerEventType;
  }

  const g = gateway.toLowerCase();

  switch (g) {
    case "stripe":
      return mapStripeEventType(providerEventType, context);
    case "moyasar":
      return mapMoyasarEventType(providerEventType, context);
    case "paypal":
      return mapPayPalEventType(providerEventType, context);
    case "paymob":
      return mapPaymobEventType(providerEventType, context);
    default: {
      // Custom gateways: only map if type is already stable; else unmapped
      return "provider.unmapped";
    }
  }
}
