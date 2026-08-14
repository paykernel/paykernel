// file: packages/payments/src/gateways/stripe/stripe.gateway.ts

import { BaseGateway } from "../base.gateway";
import type {
  AmountInput,
  CaptureParams,
  CreatePaymentParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  PaymentNextAction,
  PaymentStatus,
  RefundParams,
  VoidParams,
} from "../../types/payment.types";
import {
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  type PaymentOperationOutcome,
  type RefundOperationOutcome,
} from "../../types/operation-result";
import type {
  StripeWebhookPayload,
  WebhookEvent,
} from "../../types/webhook.types";
import {
  attachPaymentEvent,
  paymentFromWebhookEvent,
  PAYMENT_EVENT_SCHEMA_VERSION,
} from "../../types/payment-event";
import type { ProviderEventMapContext } from "../../types/webhook-event-map";
import type { StripeConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import {
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  AuthenticationError,
  RateLimitError,
  InvalidRequestError,
  NetworkError,
} from "../../errors";
import { withRetry } from "../../utils/retry";
import type { Logger } from "../../utils/logger";
import { STRIPE_CAPABILITIES } from "../builtin-capabilities";
import type { GatewayRuntimeDeps } from "../../runtime/payment-runtime";
import {
  combineAbortSignals,
  createTimeoutSignal,
  extractAbortSignal,
  mapHttpAbortError,
} from "../../runtime/abort";
import {
  concatBytes,
  hmacSha256Hex,
  timingSafeEqualHex,
  utf8Encode,
} from "../../runtime/crypto-portable";
import {
  CreatePaymentParamsSchema,
  CaptureParamsSchema,
  GetPaymentParamsSchema,
  RefundParamsSchema,
  VoidParamsSchema,
  CreateCheckoutSessionParamsSchema,
  StripeCreatePaymentParamsSchema,
} from "../../types/validation";
import type {
  CreateCheckoutSessionParams,
  StripeCreatePaymentParams,
} from "../../types/validation";
import {
  fromMinorUnits as sharedFromMinorUnits,
  MoneyAmountError,
  minorAmountToNumber,
  moneyToMajorNumber,
  normalizeAmountInput,
  toMinorUnits as sharedToMinorUnits,
} from "../../utils/money";
import {
  getCurrencyExponent,
  isKnownCurrencyCode,
} from "../../utils/currency";

/**
 * Stripe maps transient failures to NetworkError (timeouts, connection errors,
 * 5xx) and RateLimitError (429). Both are safe to retry.
 */
function isStripeRetryableError(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RateLimitError;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe API Response Types (Partial)
// ═══════════════════════════════════════════════════════════════════════════════

/** Charge fields used for refund / capture mapping (expanded or re-fetched). */
interface StripeChargeSnapshot {
  id?: string;
  amount?: number;
  amount_refunded?: number;
  amount_captured?: number;
  currency?: string;
  refunded?: boolean;
}

interface StripePaymentIntent {
  id: string;
  object: "payment_intent";
  amount: number;
  amount_received: number;
  currency: string;
  status: string;
  client_secret: string | null;
  receipt_email: string | null;
  metadata: Record<string, string>;
  latest_charge: string | StripeChargeSnapshot | null;
  /** Stripe-native next_action; treated as opaque PaymentNextAction passthrough. */
  next_action?: PaymentNextAction | null;
}

interface StripeRefund {
  id: string;
  object: "refund";
  amount: number;
  currency: string;
  payment_intent: string | { id?: string } | null;
  charge?:
    | string
    | {
        id?: string;
        amount?: number;
        amount_captured?: number;
        amount_refunded?: number;
        refunded?: boolean;
        currency?: string;
      }
    | null;
  status: string;
  metadata: Record<string, string>;
}

interface StripeListResponse<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

interface StripeErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
    decline_code?: string;
    param?: string;
  };
  statusCode?: number;
}

interface StripeCheckoutSession {
  id: string;
  object: "checkout.session";
  url: string | null;
  payment_status: string;
  status: string;
  customer: string | null;
  metadata: Record<string, string>;
  payment_intent?: string | { id: string } | null;
  setup_intent?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  amount_total?: number | null;
  currency?: string | null;
}

const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  "bhd",
  "jod",
  "kwd",
  "omr",
  "tnd",
]);
const STRIPE_TWO_DECIMAL_SPECIAL_CASES = new Set(["isk", "ugx"]);
const STRIPE_WHOLE_UNIT_ONLY_CURRENCIES = new Set([
  ...STRIPE_ZERO_DECIMAL_CURRENCIES,
  ...STRIPE_TWO_DECIMAL_SPECIAL_CASES,
]);
const STRIPE_REFUND_REASONS = new Set([
  "duplicate",
  "fraudulent",
  "requested_by_customer",
]);
const DEFAULT_STRIPE_API_VERSION = "2026-02-25.clover";
const DEFAULT_STRIPE_TIMEOUT_MS = 30_000;
// Default non-card digit cap is 8 digits (https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts).
// Card networks allow up to 12 digits for most currencies; per-currency entries below never exceed that.
const STRIPE_DEFAULT_MAX_AMOUNT = 99_999_999;
const STRIPE_MAX_AMOUNTS: Record<string, number> = {
  // Stripe non-card max digit limits (https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts)
  cop: 9_999_999_999, // 10 digits
  // Cap at card 12-digit max (999_999_999_999); non-card default remains 8 digits via STRIPE_DEFAULT_MAX_AMOUNT
  huf: 999_999_999_999,
  idr: 999_999_999_999, // 12 digits (non-card exception)
  inr: 999_999_999, // 9 digits (non-card exception)
  jpy: 999_999_999_999,
  lbp: 999_999_999_999,
};
const STRIPE_MAX_METADATA_KEYS = 50;
const STRIPE_MAX_METADATA_KEY_LENGTH = 40;
const STRIPE_MAX_METADATA_VALUE_LENGTH = 500;
const STRIPE_MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const STRIPE_PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_CHECKOUT_SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]+$/;

function stripeCurrencyExponent(currency: string): number {
  const normalized = currency.toLowerCase();

  // Stripe-specific tables stay explicit (ISK/UGX two-decimal specials,
  // MGA zero-decimal, Stripe three-decimal set). Never fold into ISO-only.
  if (STRIPE_TWO_DECIMAL_SPECIAL_CASES.has(normalized)) {
    return 2;
  }

  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(normalized)) {
    return 3;
  }

  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(normalized)) {
    return 0;
  }

  // Known ISO two-decimal codes (USD, EUR, …). Unknown codes such as JYP
  // (typo of JPY) must not silently default to exponent 2.
  if (isKnownCurrencyCode(normalized) && getCurrencyExponent(normalized) === 2) {
    return 2;
  }

  throw new InvalidRequestError(
    `Unknown Stripe currency code: ${normalized.toUpperCase()}`,
  );
}

function stripeMaximumAmount(currency: string): number {
  return (
    STRIPE_MAX_AMOUNTS[currency.toLowerCase()] ?? STRIPE_DEFAULT_MAX_AMOUNT
  );
}

/**
 * Validate a Stripe minor-unit integer (already scaled). Applies three-decimal
 * divisible-by-10 rules, ISK/UGX whole-major-unit enforcement, and optional
 * charge max limits. Does not re-scale major units.
 *
 * Used by both `toStripeAmount` (post-scale) and checkout `priceData.unitAmount`
 * (caller already in minor units) so escape-hatch paths cannot skip money rules.
 */
function assertStripeMinorUnitAmount(
  stripeAmount: number,
  currency: string,
  options?: { enforceChargeLimits?: boolean; allowZero?: boolean },
): number {
  const normalized = currency.toLowerCase();
  if (
    !Number.isFinite(stripeAmount) ||
    !Number.isInteger(stripeAmount) ||
    (options?.allowZero ? stripeAmount < 0 : stripeAmount <= 0)
  ) {
    throw new InvalidRequestError(
      options?.allowZero
        ? "Stripe minor-unit amount must be a non-negative integer"
        : "Stripe minor-unit amount must be a positive integer",
    );
  }

  // Three-decimal currencies (BHD/JOD/KWD/OMR/TND): Stripe requires the minor-unit
  // amount to be divisible by 10 (the last digit must be 0). Reject rather than
  // silently rounding so callers control pricing.
  if (
    STRIPE_THREE_DECIMAL_CURRENCIES.has(normalized) &&
    stripeAmount % 10 !== 0
  ) {
    throw new InvalidRequestError(
      `Stripe ${normalized.toUpperCase()} minor-unit amounts must be divisible by 10 (three-decimal currencies use 0-padding; e.g. 1.234 becomes invalid — use 1.230 which is 1230)`,
    );
  }

  // ISK/UGX (and other whole-unit-only with exp > 0): Stripe requires whole major
  // units even though the API uses a two-decimal representation. Minor must be
  // divisible by 10^exponent (e.g. 1000 ok for 10.00 ISK; 1050 rejected).
  // Zero-decimal codes (exp 0) are already whole majors as integers.
  const exponent = stripeCurrencyExponent(normalized);
  if (STRIPE_WHOLE_UNIT_ONLY_CURRENCIES.has(normalized) && exponent > 0) {
    const scale = 10 ** exponent;
    if (stripeAmount % scale !== 0) {
      throw new InvalidRequestError(
        `Stripe ${normalized.toUpperCase()} amounts must be whole currency units`,
      );
    }
  }

  const maxAmount = stripeMaximumAmount(normalized);
  if (options?.enforceChargeLimits && stripeAmount > maxAmount) {
    throw new InvalidRequestError(
      `Stripe ${normalized.toUpperCase()} amount must be at most ${maxAmount} in the currency's minor unit`,
    );
  }

  return stripeAmount;
}

/**
 * Zod input types carry `exponent?: number | undefined` (exactOptionalPropertyTypes).
 * Rebuild a real {@link AmountInput} so `toStripeAmount` stays on the Money contract.
 */
function asAmountInput(
  amount:
    | AmountInput
    | { amount: string; currency: string; exponent?: number | undefined },
): AmountInput {
  if (typeof amount === "number") {
    return amount;
  }
  if (amount.exponent === undefined) {
    return { amount: amount.amount, currency: amount.currency };
  }
  return {
    amount: amount.amount,
    currency: amount.currency,
    exponent: amount.exponent,
  };
}

function toStripeAmount(
  amount:
    | AmountInput
    | { amount: string; currency: string; exponent?: number | undefined },
  currency: string,
  options?: { enforceChargeLimits?: boolean; allowZero?: boolean },
): number {
  const amountInput = asAmountInput(amount);
  const normalized = currency.toLowerCase();
  const allowZero = options?.allowZero === true;
  // Stripe-specific exponents (ISK/UGX two-decimal specials, MGA zero-decimal,
  // three-decimal set) stay explicit — never fold into ISO-only tables.
  const exponent = stripeCurrencyExponent(normalized);
  const parseOpts = {
    rounding: "reject" as const,
    exponent,
    allowZero,
    allowNegative: false,
  };

  let minor: bigint;
  try {
    const money = normalizeAmountInput(amountInput, currency, parseOpts);
    minor = sharedToMinorUnits(money, parseOpts);
  } catch (error) {
    if (error instanceof MoneyAmountError) {
      if (error.kind === "excess_precision") {
        throw new InvalidRequestError(
          `Stripe ${normalized.toUpperCase()} amounts cannot have more decimal places than the currency supports`,
        );
      }
      if (error.kind === "unsafe_range") {
        throw new InvalidRequestError(
          `Stripe ${normalized.toUpperCase()} amount is too large to represent safely in minor units`,
        );
      }
      if (
        error.kind === "zero" ||
        error.kind === "negative" ||
        error.kind === "invalid_format"
      ) {
        throw new InvalidRequestError(
          allowZero
            ? "Stripe amount must be a non-negative finite number"
            : "Stripe amount must be a positive finite number",
        );
      }
    }
    throw error;
  }

  // Whole-unit (ISK/UGX), three-decimal, and charge-max rules live in
  // assertStripeMinorUnitAmount so major-unit and unitAmount paths share them.
  let stripeAmount: number;
  try {
    stripeAmount = minorAmountToNumber(minor);
  } catch (error) {
    if (error instanceof MoneyAmountError && error.kind === "unsafe_range") {
      throw new InvalidRequestError(
        `Stripe ${normalized.toUpperCase()} amount is too large to represent safely in minor units`,
      );
    }
    throw error;
  }

  return assertStripeMinorUnitAmount(stripeAmount, normalized, options);
}

function fromStripeAmount(
  amount: number | undefined | null,
  currency: string,
): number {
  if (amount === undefined || amount === null) {
    return 0;
  }
  const exponent = stripeCurrencyExponent(currency);
  const money = sharedFromMinorUnits(amount, currency, {
    exponent,
    allowZero: true,
    allowNegative: true,
  });
  return moneyToMajorNumber(money, {
    exponent,
    allowZero: true,
    allowNegative: true,
  });
}

/** Finite Stripe minor-unit amount, or undefined when missing/non-finite. */
function finiteStripeMinor(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Settled/captured minor units on a PaymentIntent-like object.
 * Prefer `amount_received`, then expanded `latest_charge.amount_captured`,
 * then first charge in `charges.data` (legacy list shape).
 * Does **not** fall back to authorized `amount` — that would claim full capture.
 */
function resolveStripeCapturedMinor(object: {
  amount_received?: unknown;
  latest_charge?: unknown;
  charges?: { data?: Array<{ amount_captured?: unknown }> };
}): number | undefined {
  const received = finiteStripeMinor(object.amount_received);
  if (received !== undefined) {
    return received;
  }

  const latest = object.latest_charge;
  if (typeof latest === "object" && latest !== null) {
    const captured = finiteStripeMinor(
      (latest as { amount_captured?: unknown }).amount_captured,
    );
    if (captured !== undefined) {
      return captured;
    }
  }

  const firstCharge = object.charges?.data?.[0];
  if (firstCharge) {
    const captured = finiteStripeMinor(firstCharge.amount_captured);
    if (captured !== undefined) {
      return captured;
    }
  }

  return undefined;
}

function expandableId(
  value: string | { id?: string } | null | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return value?.id;
}

function stripeSubscriptionStatus(status: string): PaymentStatus {
  switch (status) {
    case "active":
      // STRIPE-1: subscription lifecycle `active` is not a settled charge.
      // Do not map to domain `paid` — status-only handlers would false-fulfill
      // while dual-write is provider.unmapped. Use processing (open billing
      // relationship) until invoice/PI money events confirm collection.
      return "processing";
    case "trialing":
      // Trial has not collected payment yet — keep pending. Checkout
      // subscription-mode `no_payment_required` also maps to pending (STRIPE-2).
      // `payment_status: paid` on a paid first invoice remains paid via checkout.
      return "pending";
    case "past_due":
    case "incomplete":
    case "paused":
    case "unpaid":
      // unpaid: invoices failed and retries exhausted, but subscription is not
      // cancelled yet — keep pending so callers can collect/reactivate.
      return "pending";
    case "incomplete_expired":
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

function stripeInvoiceStatus(eventType: string, status: string): PaymentStatus {
  switch (eventType) {
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return "paid";
    case "invoice.payment_failed":
      return "failed";
    case "invoice.voided":
      return "cancelled";
    case "invoice.marked_uncollectible":
      return "failed";
    default:
      if (status === "paid") {
        return "paid";
      }
      if (status === "void" || status === "uncollectible") {
        return status === "void" ? "cancelled" : "failed";
      }
      return "pending";
  }
}

function stripeInvoiceAmount(
  eventType: string,
  invoice: Record<string, any>,
): number | undefined {
  const firstNumber = (...values: unknown[]): number | undefined => {
    return values.find((value): value is number => typeof value === "number");
  };

  switch (eventType) {
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return firstNumber(
        invoice.amount_paid,
        invoice.total,
        invoice.amount_due,
      );
    case "invoice.payment_failed":
      return firstNumber(
        invoice.amount_due,
        invoice.amount_remaining,
        invoice.total,
        invoice.amount_paid,
      );
    default:
      return firstNumber(
        invoice.total,
        invoice.amount_due,
        invoice.amount_remaining,
        invoice.amount_paid,
      );
  }
}

function stripeInvoiceSubscriptionId(invoice: Record<string, any>): string | undefined {
  return (
    expandableId(invoice.parent?.subscription_details?.subscription) ??
    expandableId(invoice.subscription)
  );
}

function stripeInvoicePaymentIntentId(invoice: Record<string, any>): string | undefined {
  // Basil+ payments.data default payment_intent, then legacy top-level payment_intent.
  const payments = invoice.payments?.data;
  if (Array.isArray(payments) && payments.length > 0) {
    const defaultPayment =
      payments.find(
        (payment: any) =>
          payment?.is_default === true || payment?.default === true,
      ) ?? payments[0];
    const fromPayments =
      expandableId(defaultPayment?.payment?.payment_intent) ??
      expandableId(defaultPayment?.payment_intent) ??
      expandableId(defaultPayment?.payment);
    if (fromPayments) {
      return fromPayments;
    }
  }
  return expandableId(invoice.payment_intent);
}

/**
 * Money-bearing invoice events prefer PaymentIntent for gatewayPaymentId so
 * refunds/captures can use the id directly. Subscription id is exposed via
 * gatewaySubscriptionId on the normalized event.
 *
 * STRIPE-8: `capturePayment` / `refundPayment` / `voidPayment` require `pi_*`.
 * When this returns `sub_*` (subscription checkout / non-money invoice /
 * subscription lifecycle), callers must resolve a PaymentIntent before money
 * mutations — do not pass `sub_*` / `cs_*` into those APIs.
 */
function stripeInvoicePrefersPaymentIntent(eventType: string): boolean {
  return (
    eventType === "invoice.paid" ||
    eventType === "invoice.payment_succeeded" ||
    eventType === "invoice.payment_failed"
  );
}

function stripeWebhookPaymentId(
  object: StripeWebhookPayload["data"]["object"],
  eventType?: string,
): string {
  if (object.object === "checkout.session") {
    const session = object as any;
    // Subscription Checkout often includes both payment_intent (first invoice)
    // and subscription. Prefer the subscription id so gatewayPaymentId tracks
    // the recurring object rather than a one-off PaymentIntent (STRIPE-8).
    if (session.mode === "subscription") {
      return (
        expandableId(session.subscription) ??
        expandableId(session.payment_intent) ??
        expandableId(session.setup_intent) ??
        object.id
      );
    }
    return (
      expandableId(session.payment_intent) ??
      expandableId(session.setup_intent) ??
      expandableId(session.subscription) ??
      object.id
    );
  }

  if (object.object === "invoice") {
    const invoice = object as any;
    const subscriptionId = stripeInvoiceSubscriptionId(invoice);
    const paymentIntentId = stripeInvoicePaymentIntentId(invoice);

    // Money events: prefer PI when present so callers can refund/capture with
    // gatewayPaymentId. Non-money invoice events keep subscription preference
    // (may be sub_* — not valid for refund/capture/void; STRIPE-8).
    if (
      eventType &&
      stripeInvoicePrefersPaymentIntent(eventType) &&
      paymentIntentId
    ) {
      return paymentIntentId;
    }

    return subscriptionId ?? paymentIntentId ?? object.id;
  }

  if (object.object === "charge" || object.object === "refund") {
    return expandableId((object as any).payment_intent) ?? object.id;
  }

  return object.id;
}

function stripeWebhookSubscriptionId(
  object: StripeWebhookPayload["data"]["object"],
): string | undefined {
  if (object.object === "invoice") {
    return stripeInvoiceSubscriptionId(object as any);
  }
  if (object.object === "checkout.session") {
    return expandableId((object as any).subscription);
  }
  if (object.object === "subscription") {
    return object.id;
  }
  return undefined;
}

function stripeWebhookMetadataPaymentId(
  object: StripeWebhookPayload["data"]["object"],
): string | undefined {
  return (
    object.metadata?.paymentId ??
    (object as any).parent?.subscription_details?.metadata?.paymentId ??
    (object as any).subscription_details?.metadata?.paymentId
  );
}

function stripeNextActionRedirectUrl(nextAction: unknown): string | undefined {
  if (!nextAction || typeof nextAction !== "object") {
    return undefined;
  }

  const action = nextAction as Record<string, any>;
  return (
    action.redirect_to_url?.url ??
    action.alipay_handle_redirect?.url ??
    action.alipay_handle_redirect?.native_url ??
    action.wechat_pay_redirect_to_ios_app?.native_url ??
    action.cashapp_handle_redirect_or_display_qr_code
      ?.hosted_instructions_url ??
    action.swish_handle_redirect_or_display_qr_code?.hosted_instructions_url
  );
}

function sanitizedStripeMetadata(
  metadata?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key.length > STRIPE_MAX_METADATA_KEY_LENGTH) {
      throw new InvalidRequestError(
        `Stripe metadata key "${key}" must be ${STRIPE_MAX_METADATA_KEY_LENGTH} characters or fewer`,
      );
    }
    if (key.includes("[") || key.includes("]")) {
      throw new InvalidRequestError(
        `Stripe metadata key "${key}" cannot contain square brackets`,
      );
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const stringValue = String(value);
      if (stringValue.length > STRIPE_MAX_METADATA_VALUE_LENGTH) {
        throw new InvalidRequestError(
          `Stripe metadata value for "${key}" must be ${STRIPE_MAX_METADATA_VALUE_LENGTH} characters or fewer`,
        );
      }
      sanitized[key] = stringValue;
      continue;
    }
    throw new InvalidRequestError(
      `Stripe metadata value for "${key}" must be a string, number, or boolean`,
    );
  }

  if (Object.keys(sanitized).length > STRIPE_MAX_METADATA_KEYS) {
    throw new InvalidRequestError(
      `Stripe metadata can include at most ${STRIPE_MAX_METADATA_KEYS} keys`,
    );
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function requireCurrencyForPartialAmount(
  operation: string,
  currency: string | undefined,
): string {
  if (!currency) {
    throw new InvalidRequestError(
      `Stripe ${operation} requires currency when amount is provided`,
    );
  }
  return currency.toLowerCase();
}

/**
 * STRIPE-1: bind partial major-unit conversion to PaymentIntent currency.
 * Rejects caller currency that does not match the PI (Paymob resolveActionAmountCents posture).
 * Never converts majors with the caller currency alone when the PI currency differs
 * (e.g. PI USD + caller JPY would otherwise send 50 minor instead of 5000 cents).
 */
function assertPartialAmountCurrencyMatchesPaymentIntent(
  operation: string,
  callerCurrency: string,
  paymentIntentCurrency: string | undefined | null,
): string {
  const piCurrency = stripeCurrencyCode(paymentIntentCurrency);
  if (piCurrency === undefined) {
    throw new InvalidRequestError(
      `Stripe ${operation} requires PaymentIntent currency to validate the requested amount`,
    );
  }
  if (callerCurrency !== piCurrency) {
    throw new InvalidRequestError(
      `Stripe ${operation} currency ${callerCurrency.toUpperCase()} does not match PaymentIntent currency ${piCurrency.toUpperCase()}`,
      [{ path: ["currency"] }],
    );
  }
  return piCurrency;
}

function mapStripeRefundStatus(
  status: string,
): "pending" | "completed" | "failed" {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed" || status === "canceled") {
    return "failed";
  }
  return "pending";
}

function mapStripeRefundWebhookStatus(
  status: string,
  object: StripeWebhookPayload["data"]["object"],
): PaymentStatus {
  if (status === "succeeded") {
    const charge = (object as any).charge;
    if (typeof charge === "object" && charge !== null) {
      // Prefer Stripe's charge.refunded flag when present (full refund).
      if (charge.refunded === true) {
        return "refunded";
      }

      const chargeAmountRefunded = charge.amount_refunded;
      const capturedBase =
        typeof charge.amount_captured === "number" &&
        Number.isFinite(charge.amount_captured)
          ? charge.amount_captured
          : charge.amount;

      // STRIPE-1: amount_refunded must be > 0 to prove aggregate money moved.
      // Zero (or missing) with expanded charge must not map to partially_refunded
      // — that dual-writes refund.completed while refunded money is unproven.
      if (
        typeof chargeAmountRefunded === "number" &&
        typeof capturedBase === "number" &&
        Number.isFinite(chargeAmountRefunded) &&
        Number.isFinite(capturedBase) &&
        chargeAmountRefunded > 0
      ) {
        return chargeAmountRefunded >= capturedBase && capturedBase > 0
          ? "refunded"
          : "partially_refunded";
      }
    }

    // Incomplete charge-aggregate snapshot (no expanded charge, zero
    // amount_refunded, or unusable totals): domain incomplete marker.
    // Dual-write demoted to refund.pending via demoteIncompleteRefundWebhookDualWrite.
    return "refund_completed";
  }
  if (status === "failed" || status === "canceled") {
    return "failed";
  }
  return "pending";
}

function stripeHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const normalizedName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return value;
    }
  }

  return undefined;
}

function validateStripeIdempotencyKey(idempotencyKey?: string): void {
  if (
    idempotencyKey &&
    idempotencyKey.length > STRIPE_MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new InvalidRequestError(
      `Stripe idempotency keys must be ${STRIPE_MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer`,
    );
  }
}

/**
 * Stripe mutations are only safe to retry when an Idempotency-Key is present.
 * Auto-generate an ephemeral key when the caller omits it (or passes
 * empty/whitespace) so **in-process** retries of transient network/5xx errors
 * do not create duplicate PaymentIntents, captures, refunds, voids, or sessions.
 *
 * STRIPE-6 honesty: the auto-generated key is known only for the lifetime of
 * that single SDK call. It does **not** protect app-level crash/retry across
 * processes or after the call returns. Callers that need durable mutation
 * fencing must supply their own stable `idempotencyKey`.
 */
function resolveStripeIdempotencyKey(
  idempotencyKey: string | undefined,
  randomUUID: () => string,
): string {
  const key = idempotencyKey?.trim();
  if (!key) {
    return randomUUID();
  }
  validateStripeIdempotencyKey(key);
  return key;
}

/**
 * Normalize a non-empty currency code for money conversion, or undefined.
 * Never invent `"usd"` when Stripe omits currency (STRIPE-2 / STRIPE-4).
 */
function stripeCurrencyCode(
  ...candidates: Array<string | null | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().toLowerCase();
    }
  }
  return undefined;
}

function stripePaymentIntentPathId(paymentIntentId: string): string {
  if (!STRIPE_PAYMENT_INTENT_ID_PATTERN.test(paymentIntentId)) {
    throw new InvalidRequestError(
      "Stripe PaymentIntent ID must start with pi_ and contain only letters, numbers, or underscores",
    );
  }

  return encodeURIComponent(paymentIntentId);
}

function stripeCheckoutSessionPathId(sessionId: string): string {
  if (!STRIPE_CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
    throw new InvalidRequestError(
      "Stripe Checkout Session ID must start with cs_ and contain only letters, numbers, or underscores",
    );
  }

  return encodeURIComponent(sessionId);
}

function stripeExpectedWebhookApiVersion(
  config: StripeConfig,
): string | undefined {
  return config.webhookApiVersion?.trim() || undefined;
}

function assertStripeSnapshotEvent(payload: StripeWebhookPayload): void {
  if (
    typeof payload?.id !== "string" ||
    typeof payload?.type !== "string" ||
    typeof payload?.created !== "number" ||
    typeof payload?.data?.object?.id !== "string" ||
    typeof payload?.data?.object?.object !== "string"
  ) {
    throw new InvalidRequestError(
      "Invalid Stripe webhook payload: expected a snapshot event with data.object",
    );
  }
}

function assertStripeEventObjectDetails(payload: StripeWebhookPayload): void {
  const object = payload.data.object;
  const invalid = (message: string) => {
    throw new InvalidRequestError(`Invalid Stripe webhook payload: ${message}`);
  };

  if (payload.type.startsWith("payment_intent.")) {
    if (
      object.object !== "payment_intent" ||
      typeof object.status !== "string" ||
      typeof object.amount !== "number" ||
      typeof object.currency !== "string"
    ) {
      invalid("expected a snapshot payment_intent object");
    }
    return;
  }

  if (payload.type.startsWith("checkout.session.")) {
    if (
      object.object !== "checkout.session" ||
      typeof object.status !== "string" ||
      typeof object.payment_status !== "string"
    ) {
      invalid("expected a snapshot checkout.session object");
    }
    return;
  }

  if (payload.type.startsWith("invoice.")) {
    if (object.object !== "invoice" || typeof object.status !== "string") {
      invalid("expected a snapshot invoice object");
    }
    return;
  }

  if (payload.type.startsWith("customer.subscription.")) {
    if (object.object !== "subscription" || typeof object.status !== "string") {
      invalid("expected a snapshot subscription object");
    }
    return;
  }

  if (payload.type === "charge.refunded") {
    if (
      object.object !== "charge" ||
      typeof object.amount !== "number" ||
      typeof object.currency !== "string"
    ) {
      invalid("expected a snapshot charge object");
    }
    return;
  }

  if (
    payload.type.startsWith("refund.") ||
    payload.type === "charge.refund.updated"
  ) {
    if (
      object.object !== "refund" ||
      typeof object.status !== "string" ||
      typeof object.amount !== "number" ||
      typeof object.currency !== "string"
    ) {
      invalid("expected a snapshot refund object");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: URL Encoded Serializer
// ═══════════════════════════════════════════════════════════════════════════════

function toUrlEncoded(
  obj: Record<string, any>,
  prefix?: string,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      const paramKey = prefix ? `${prefix}[${key}]` : key;

      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const arrayKey = `${paramKey}[${index}]`;
          if (typeof item === "object" && item !== null) {
            const nestedParams = toUrlEncoded(item, arrayKey);
            nestedParams.forEach((nestedValue, nestedKey) => {
              params.append(nestedKey, nestedValue);
            });
          } else {
            params.append(arrayKey, String(item));
          }
        });
      } else if (typeof value === "object") {
        const nestedParams = toUrlEncoded(value, paramKey);
        nestedParams.forEach((nestedValue, nestedKey) => {
          params.append(nestedKey, nestedValue);
        });
      } else {
        params.append(paramKey, String(value));
      }
    }
  }
  return params;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe Gateway Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Stripe payment gateway implementation
 * Uses Stripe API directly via fetch
 * @see https://stripe.com/docs/api
 */
export class StripeGateway extends BaseGateway {
  readonly name = "stripe" as const;

  private readonly stripeConfig: StripeConfig;

  private get baseUrl(): string {
    return "https://api.stripe.com/v1";
  }

  constructor(
    config: StripeConfig,
    hooks: HooksManager,
    logger?: Logger,
    runtime?: GatewayRuntimeDeps,
  ) {
    super(config, hooks, logger, STRIPE_CAPABILITIES, runtime);
    this.stripeConfig = config;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Core Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a Stripe PaymentIntent
   */
  async createPayment(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: StripeCreatePaymentParams,
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: CreatePaymentParams | StripeCreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "createPayment",
      params,
      async (p) => {
        const currency = p.currency.toLowerCase();
        const metadataInput = { ...(p.metadata ?? {}) };
        if (p.orderId) {
          metadataInput.orderId ??= p.orderId;
          metadataInput.paymentId ??= p.orderId;
        }
        const metadata = sanitizedStripeMetadata(metadataInput);

        const body: Record<string, any> = {
          amount: toStripeAmount(p.amount, currency, {
            enforceChargeLimits: true,
          }),
          currency,
          automatic_payment_methods: { enabled: true },
          description: p.description,
          metadata,
        };

        if (p.capture === false) {
          body.capture_method = "manual";
        }

        if (p.stripeCustomerId) {
          body.customer = p.stripeCustomerId;
        }

        if (p.stripePaymentMethodId) {
          body.payment_method = p.stripePaymentMethodId;
          body.confirm = true; // Confirm immediately if method provided
          if (p.callbackUrl) {
            body.return_url = p.callbackUrl;
          } else {
            body.automatic_payment_methods.allow_redirects = "never";
          }
        }

        if (p.stripeSetupFutureUsage) {
          body.setup_future_usage = p.stripeSetupFutureUsage;
        }

        const response = await this.stripeRequest<StripePaymentIntent>(
          "POST",
          "/payment_intents",
          body,
          resolveStripeIdempotencyKey(p.idempotencyKey, () => this.runtime.randomUUID()),
          extractAbortSignal(p),
        );

        // Succeeded PI: same settled-amount fail-closed as getPayment/capture.
        // Missing amount_received/amount_captured → processing (not full paid).
        const status =
          response.status === "succeeded"
            ? this.succeededPaymentIntentWebhookStatus(
                response as unknown as StripeWebhookPayload["data"]["object"],
              )
            : undefined;

        // STRIPE-2: prefer settled minors (amount_received → amount_captured)
        // when present; fall back to authorized amount only when unsettled.
        const currencyCode = response.currency ?? currency;
        const settledMinor = resolveStripeCapturedMinor(response);
        const amountMinor =
          settledMinor !== undefined ? settledMinor : response.amount;
        // STRIPE-1: always publish currency with major-unit amount fields.
        const normalizedCurrency = stripeCurrencyCode(currencyCode);

        return this.mapPaymentIntentResult(response, {
          ...(status !== undefined ? { status } : {}),
          ...(normalizedCurrency !== undefined
            ? {
                amount: fromStripeAmount(amountMinor, normalizedCurrency),
                currency: normalizedCurrency.toUpperCase(),
              }
            : {}),
        });
      },
      StripeCreatePaymentParamsSchema,
    );
  }

  /**
   * Capture a localized/authorized PaymentIntent
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "capturePayment",
      params,
      async (p) => {
        const paymentIntentPathId = stripePaymentIntentPathId(
          p.gatewayPaymentId,
        );
        const callerSignal = extractAbortSignal(p);
        const body: Record<string, any> = {};
        if (p.amount !== undefined) {
          // STRIPE-1: bind conversion to PaymentIntent currency (fetch + match).
          body.amount_to_capture = await this.resolvePartialAmountToStripeMinor(
            "capturePayment",
            paymentIntentPathId,
            p.amount,
            p.currency,
            callerSignal,
          );
        }

        const response = await this.stripeRequest<StripePaymentIntent>(
          "POST",
          `/payment_intents/${paymentIntentPathId}/capture`,
          body,
          resolveStripeIdempotencyKey(p.idempotencyKey, () => this.runtime.randomUUID()),
          callerSignal,
        );

        // Partial capture: succeeded + settled < authorized amount.
        // Fail closed when settled amount is missing (do not claim full paid).
        const status =
          response.status === "succeeded"
            ? this.succeededPaymentIntentWebhookStatus(
                response as unknown as StripeWebhookPayload["data"]["object"],
              )
            : this.mapStatus(response.status);

        // Amount: amount_received → amount_captured → amount. Never coerce
        // missing amount_received alone to major 0 via fromStripeAmount(undefined).
        // STRIPE-4: never invent "usd" when Stripe and caller omit currency.
        const currency = stripeCurrencyCode(response.currency, p.currency);
        const settledMinor = resolveStripeCapturedMinor(response);
        const amountMinor =
          settledMinor ?? finiteStripeMinor(response.amount);

        return this.mapPaymentIntentResult(response, {
          status,
          // STRIPE-1: currency accompanies major-unit amount (never naked amount).
          ...(amountMinor !== undefined && currency !== undefined
            ? {
                amount: fromStripeAmount(amountMinor, currency),
                currency: currency.toUpperCase(),
              }
            : {}),
          // Capture paths historically omit redirectUrl (undefined).
          omitRedirectUrl: true,
        });
      },
      CaptureParamsSchema,
    );
  }

  /**
   * Refund a PaymentIntent (via Refunds API)
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks(
      "refundPayment",
      params,
      async (p) => {
        const paymentIntentPathId = stripePaymentIntentPathId(
          p.gatewayPaymentId,
        );
        const callerSignal = extractAbortSignal(p);
        const body: Record<string, any> = {
          payment_intent: p.gatewayPaymentId,
        };

        if (p.amount !== undefined) {
          // STRIPE-1: bind conversion to PaymentIntent currency (fetch + match).
          body.amount = await this.resolvePartialAmountToStripeMinor(
            "refundPayment",
            paymentIntentPathId,
            p.amount,
            p.currency,
            callerSignal,
          );
        }

        if (p.reason) {
          if (STRIPE_REFUND_REASONS.has(p.reason)) {
            body.reason = p.reason;
          } else {
            body.metadata = { reason: p.reason };
          }
        }

        const refundMetadata = sanitizedStripeMetadata({
          ...(body.metadata ?? {}),
          ...(p.metadata ?? {}),
        });
        if (refundMetadata) {
          body.metadata = refundMetadata;
        }

        // Expand charge so amount_refunded can recover totalRefunded if the
        // secondary refunds list fails (STRIPE-3).
        body.expand = ["charge"];
        const response = await this.stripeRequest<StripeRefund>(
          "POST",
          "/refunds",
          body,
          resolveStripeIdempotencyKey(p.idempotencyKey, () => this.runtime.randomUUID()),
          callerSignal,
        );
        // STRIPE-4: never invent "usd" for cumulative conversion.
        const refundCurrency = stripeCurrencyCode(
          response.currency,
          p.currency,
          typeof response.charge === "object" && response.charge !== null
            ? response.charge.currency
            : undefined,
        );
        let totalRefunded: number | undefined;
        if (refundCurrency !== undefined) {
          try {
            totalRefunded = await this.getTotalRefundedForPaymentIntent(
              p.gatewayPaymentId,
              refundCurrency,
              callerSignal,
            );
          } catch {
            // STRIPE-3: list failed — prefer charge.amount_refunded (cumulative
            // on that charge) over inventing a single-refund "total".
            const charge = response.charge;
            if (
              typeof charge === "object" &&
              charge !== null &&
              typeof charge.amount_refunded === "number" &&
              Number.isFinite(charge.amount_refunded)
            ) {
              totalRefunded = fromStripeAmount(
                charge.amount_refunded,
                stripeCurrencyCode(charge.currency, refundCurrency) ??
                  refundCurrency,
              );
            } else {
              totalRefunded = undefined;
            }
          }
        }

        const status = mapStripeRefundStatus(response.status);
        const outcome: RefundOperationOutcome =
          status === "completed"
            ? "succeeded"
            : status === "failed"
              ? "failed"
              : "pending";
        return applyOutcomeToGatewayRefundResult(
          {
            gatewayRefundId: response.id,
            status,
            totalRefunded,
            rawResponse: response,
          },
          outcome,
        );
      },
      RefundParamsSchema,
    );
  }

  /**
   * Void/Cancel a payment (before it is captured)
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "voidPayment",
      params,
      async (p) => {
        const paymentIntentPathId = stripePaymentIntentPathId(
          p.gatewayPaymentId,
        );
        const response = await this.stripeRequest<StripePaymentIntent>(
          "POST",
          `/payment_intents/${paymentIntentPathId}/cancel`,
          undefined,
          resolveStripeIdempotencyKey(p.idempotencyKey, () => this.runtime.randomUUID()),
          extractAbortSignal(p),
        );

        // STRIPE-4: omit amount when currency is missing — never invent "usd".
        const currency = stripeCurrencyCode(response.currency);
        const amountMinor = finiteStripeMinor(response.amount);
        return this.mapPaymentIntentResult(response, {
          // STRIPE-1: currency accompanies major-unit amount (never naked amount).
          ...(amountMinor !== undefined && currency !== undefined
            ? {
                amount: fromStripeAmount(amountMinor, currency),
                currency: currency.toUpperCase(),
              }
            : {}),
          omitRedirectUrl: true,
          // Void completed successfully even when status is cancelled.
          forceOutcome: "succeeded",
        });
      },
      VoidParamsSchema,
    );
  }

  /**
   * Retrieve PaymentIntent details
   * @see https://stripe.com/docs/api/payment_intents/retrieve
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "getPayment",
      params,
      async (p) => {
        const paymentIntentPathId = stripePaymentIntentPathId(
          p.gatewayPaymentId,
        );
        const callerSignal = extractAbortSignal(p);
        const paymentIntent = await this.stripeRequest<StripePaymentIntent>(
          "GET",
          `/payment_intents/${paymentIntentPathId}?expand[]=latest_charge`,
          undefined,
          undefined,
          callerSignal,
        );

        // Prefer expanded object; re-fetch when Stripe returns an unexpanded
        // string charge ID so refund fields remain observable (STRIPE-1).
        let latestCharge: StripeChargeSnapshot | undefined =
          typeof paymentIntent.latest_charge === "object" &&
          paymentIntent.latest_charge !== null
            ? paymentIntent.latest_charge
            : undefined;
        let chargeRefundStateUnknown = false;
        if (
          latestCharge === undefined &&
          typeof paymentIntent.latest_charge === "string" &&
          paymentIntent.latest_charge.length > 0
        ) {
          try {
            latestCharge = await this.stripeRequest<StripeChargeSnapshot>(
              "GET",
              `/charges/${encodeURIComponent(paymentIntent.latest_charge)}`,
              undefined,
              undefined,
              callerSignal,
            );
          } catch {
            // Cannot observe amount_refunded without a charge snapshot.
            chargeRefundStateUnknown = true;
          }
        }

        // STRIPE-4: never invent "usd" when Stripe omits currency.
        const currency = stripeCurrencyCode(
          paymentIntent.currency,
          latestCharge?.currency,
        );
        let status = this.mapStatus(paymentIntent.status);

        // Settled amount: amount_received → latest_charge.amount_captured (no auth fallback).
        // Include re-fetched charge so amount_captured is visible when expand failed.
        const piCharges = (
          paymentIntent as {
            charges?: { data?: Array<{ amount_captured?: unknown }> };
          }
        ).charges;
        const settledMinor = resolveStripeCapturedMinor({
          amount_received: paymentIntent.amount_received,
          latest_charge: latestCharge ?? paymentIntent.latest_charge,
          ...(piCharges !== undefined ? { charges: piCharges } : {}),
        });
        const amountReceived = paymentIntent.amount_received;
        const hasAmountReceived =
          typeof amountReceived === "number" && Number.isFinite(amountReceived);
        const amountCaptured =
          typeof latestCharge?.amount_captured === "number" &&
          Number.isFinite(latestCharge.amount_captured)
            ? latestCharge.amount_captured
            : undefined;
        // Captured base for refund completeness: amount_received → amount_captured only.
        // STRIPE-4: never fall back to authorized `amount` — that would claim full
        // `refunded` against the auth total when only a partial capture settled.
        const capturedBase = hasAmountReceived
          ? amountReceived
          : amountCaptured;
        // Result amount prefers settled total when known; else authorized amount.
        const amountMinor =
          paymentIntent.status === "succeeded" && settledMinor !== undefined
            ? settledMinor
            : paymentIntent.amount;

        // Refund status overrides partial-capture status when both apply.
        // Full refund when amount_refunded covers the captured base (not the original auth).
        const amountRefunded = latestCharge?.amount_refunded;
        if (chargeRefundStateUnknown && paymentIntent.status === "succeeded") {
          // STRIPE-1 fail-closed: succeeded + unobservable refunds must never
          // map to paid (Stripe keeps PI status succeeded after refunds).
          status = "processing";
        } else if (
          paymentIntent.status === "succeeded" &&
          typeof amountRefunded === "number" &&
          amountRefunded > 0
        ) {
          // Known captured base only: full refund when amount_refunded covers it.
          // Missing captured fields → partially_refunded (fail closed; STRIPE-4).
          status =
            typeof capturedBase === "number" &&
            capturedBase > 0 &&
            amountRefunded >= capturedBase
              ? "refunded"
              : "partially_refunded";
        } else if (paymentIntent.status === "succeeded") {
          if (settledMinor === undefined) {
            // Incomplete money snapshot: do not claim full paid (fail closed).
            status = "processing";
          } else if (
            typeof paymentIntent.amount === "number" &&
            Number.isFinite(paymentIntent.amount) &&
            settledMinor < paymentIntent.amount
          ) {
            status = "partially_captured";
          }
        }

        const refundCurrency = stripeCurrencyCode(
          latestCharge?.currency,
          currency,
        );
        const refundedAmount =
          latestCharge?.amount_refunded !== undefined &&
          refundCurrency !== undefined
            ? fromStripeAmount(latestCharge.amount_refunded, refundCurrency)
            : undefined;
        const chargeId =
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : latestCharge?.id;
        // STRIPE-1: never pass major-unit money without currency (mapper also
        // fail-closes, but callers should not construct incomplete options).
        const moneyCurrency =
          currency !== undefined ? currency.toUpperCase() : undefined;
        const hasMoney =
          moneyCurrency !== undefined &&
          ((typeof amountMinor === "number" && Number.isFinite(amountMinor)) ||
            refundedAmount !== undefined);
        return this.mapPaymentIntentResult(paymentIntent, {
          status,
          ...(hasMoney
            ? {
                currency: moneyCurrency,
                ...(typeof amountMinor === "number" && Number.isFinite(amountMinor)
                  ? { amount: fromStripeAmount(amountMinor, currency!) }
                  : {}),
                ...(refundedAmount !== undefined ? { refundedAmount } : {}),
              }
            : {}),
          omitRedirectUrl: true,
          ...(chargeId !== undefined ? { chargeId } : {}),
        });
      },
      GetPaymentParamsSchema,
    );
  }

  /**
   * Retrieve Checkout Session details and expose the related PaymentIntent ID
   * for legacy rows that stored cs_* before normalizing to pi_*.
   */
  async getCheckoutSession(params: {
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<{
    success: boolean;
    sessionId: string;
    paymentIntentId: string | undefined;
    url: string | null;
    status: string;
    paymentStatus: string;
    amount?: number | undefined;
    currency?: string | undefined;
    rawResponse: unknown;
  }> {
    return this.executeWithHooks(
      "getCheckoutSession",
      params,
      async (p) => {
        const sessionPathId = stripeCheckoutSessionPathId(p.sessionId);
        const session = await this.stripeRequest<StripeCheckoutSession>(
          "GET",
          `/checkout/sessions/${sessionPathId}?expand[]=payment_intent`,
          undefined,
          undefined,
          extractAbortSignal(p),
        );
        const currency = session.currency?.toLowerCase();

        return {
          success: true,
          sessionId: session.id,
          paymentIntentId: expandableId(session.payment_intent),
          url: session.url,
          status: session.status,
          paymentStatus: session.payment_status,
          amount:
            session.amount_total !== undefined && session.amount_total !== null && currency
              ? fromStripeAmount(session.amount_total, currency)
              : undefined,
          currency,
          rawResponse: session,
        };
      },
    );
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
    const result = await this.getPayment({ gatewayPaymentId: gatewayId });
    return result.status;
  }

  /**
   * Create a Stripe Checkout Session for hosted payment page
   * @see https://stripe.com/docs/api/checkout/sessions/create
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<{
    success: boolean;
    sessionId: string;
    url: string | null;
    rawResponse: unknown;
  }> {
    return this.executeWithHooks(
      "createCheckoutSession",
      params,
      async (p) => {
        const mode = p.mode ?? "payment";
        const metadata = sanitizedStripeMetadata(p.metadata);
        const body: Record<string, any> = {
          mode,
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          metadata,
        };

        if (p.paymentMethodTypes) {
          body.payment_method_types = p.paymentMethodTypes;
        }

        // Build line items
        if (p.lineItems?.length) {
          body.line_items = p.lineItems.map((item) => ({
            price: item.price,
            price_data: item.priceData
              ? {
                  currency: item.priceData.currency.toLowerCase(),
                  product_data: {
                    name: item.priceData.productData.name,
                    description: item.priceData.productData.description,
                    images: item.priceData.productData.images,
                  },
                  unit_amount:
                    item.priceData.unitAmount !== undefined
                      ? assertStripeMinorUnitAmount(
                          item.priceData.unitAmount,
                          item.priceData.currency,
                          // unitAmount is already minor units: apply three-decimal + charge max
                          // checks (same post-scale rules as toStripeAmount) without re-scaling.
                          { allowZero: true, enforceChargeLimits: true },
                        )
                      : toStripeAmount(
                          item.priceData.amount!,
                          item.priceData.currency,
                          // Major-unit path: same charge-max enforcement as unitAmount path.
                          { allowZero: true, enforceChargeLimits: true },
                        ),
                  recurring: item.priceData.recurring
                    ? {
                        interval: item.priceData.recurring.interval,
                        interval_count: item.priceData.recurring.intervalCount,
                      }
                    : undefined,
                }
              : undefined,
            quantity: item.quantity,
          }));
        } else if (mode !== "setup") {
          const currency = p.currency?.toLowerCase();
          // Simple amount-based session
          body.line_items = [
            {
              price_data: {
                currency,
                product_data: { name: "Payment" },
                unit_amount: toStripeAmount(p.amount!, currency!, {
                  enforceChargeLimits: true,
                }),
              },
              quantity: 1,
            },
          ];
        }

        if (mode === "setup" && p.currency) {
          body.currency = p.currency.toLowerCase();
        }

        if (metadata) {
          if (mode === "payment") {
            body.payment_intent_data = { metadata };
          } else if (mode === "setup") {
            body.setup_intent_data = { metadata };
          } else if (mode === "subscription") {
            body.subscription_data = { metadata };
          }
        }

        if (p.customerId && p.customerEmail) {
          throw new InvalidRequestError(
            "Stripe Checkout Sessions cannot include both customerId and customerEmail",
          );
        }
        if (p.customerId) {
          body.customer = p.customerId;
        }
        if (p.customerEmail) {
          body.customer_email = p.customerEmail;
        }

        const response = await this.stripeRequest<StripeCheckoutSession>(
          "POST",
          "/checkout/sessions",
          body,
          resolveStripeIdempotencyKey(p.idempotencyKey, () => this.runtime.randomUUID()),
          extractAbortSignal(p),
        );

        return {
          success: true,
          sessionId: response.id,
          url: response.url,
          rawResponse: response,
        };
      },
      CreateCheckoutSessionParamsSchema,
    );
  }

  /**
   * Map Stripe errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "stripe") {
      const raw = error.rawError as StripeErrorResponse;
      const code = raw?.error?.code;
      const declineCode = raw?.error?.decline_code;
      const errorType = raw?.error?.type;
      const statusCode = raw?.statusCode;
      const message = raw?.error?.message ?? error.message;

      if (
        statusCode === 429 ||
        code === "rate_limit" ||
        code === "lock_timeout"
      ) {
        return new RateLimitError("stripe");
      }

      if (statusCode === 401) {
        return new AuthenticationError(message, raw);
      }

      switch (code) {
        case "card_declined":
          if (declineCode === "insufficient_funds") {
            return new InsufficientFundsError(message, raw);
          }
          return new CardDeclinedError(message, raw);
        case "incorrect_cvc":
        case "incorrect_number":
        case "incorrect_zip":
        case "expired_card":
        case "invalid_cvc":
        case "invalid_number":
        case "invalid_expiry_month":
        case "invalid_expiry_year":
          return new CardDeclinedError(message, raw);
        case "authentication_required":
          // SCA / 3DS required is a payment failure, not bad API credentials.
          // Reserve AuthenticationError for secret-key / HTTP 401 failures.
          return new CardDeclinedError(message, raw);
        case "parameter_invalid_integer":
        case "parameter_missing":
          return new InvalidRequestError(message, [raw]);
      }

      if (errorType === "invalid_request_error" || statusCode === 400) {
        return new InvalidRequestError(message, [raw]);
      }
    }
    return super.mapError(error);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Stripe webhook signature.
   *
   * ⚠️ The `payload` MUST be the raw request body as a string or Buffer — the
   * exact bytes Stripe sent. Stripe's signature is computed over the raw body,
   * so a parsed/re-serialized JSON object will NOT verify. If you pass a parsed
   * object this method returns false (and logs a warning via the configured
   * logger) rather than throwing. In frameworks that auto-parse JSON, configure
   * a raw-body parser for the webhook route (e.g. express.raw()).
   *
   * @see https://stripe.com/docs/webhooks/signatures
   */
  verifyWebhook(
    payload: unknown,
    signature?: string,
    headers?: Record<string, string>,
  ): boolean {
    if (!this.stripeConfig.webhookSecret) {
      this.logger.warn(
        "[Stripe] Webhook verification failed: webhookSecret not configured",
      );
      return false;
    }

    const sigHeader = signature || stripeHeader(headers, "stripe-signature");
    if (!sigHeader) {
      this.logger.warn("[Stripe] Missing stripe-signature header");
      return false;
    }

    const signatures: string[] = [];
    let timestamp: string | undefined;
    for (const part of sigHeader.split(",")) {
      const [key, value] = part.split("=");
      if (!key || !value) continue;
      const normalizedKey = key.trim();
      if (normalizedKey === "t") {
        timestamp = value.trim();
      } else if (normalizedKey === "v1") {
        signatures.push(value.trim());
      }
    }

    if (!timestamp || signatures.length === 0) {
      this.logger.warn("[Stripe] Invalid signature header format");
      return false;
    }

    // Prevent replay / pre-signed attacks: bidirectional tolerance (stripe-node
    // parity). Reject when |now - eventTime| > 300s (aged or far-future).
    const eventTime = parseInt(timestamp, 10);
    const now = Math.floor(this.clock.nowMs() / 1000);
    if (!Number.isFinite(eventTime) || Math.abs(now - eventTime) > 300) {
      this.logger.warn("[Stripe] Webhook signature timestamp outside tolerance");
      return false;
    }

    // Raw body only: string or Uint8Array (Buffer is a Uint8Array subclass on Node).
    let signedPayload: string | Uint8Array;
    if (typeof payload === "string") {
      signedPayload = `${timestamp}.${payload}`;
    } else if (payload instanceof Uint8Array) {
      signedPayload = concatBytes(utf8Encode(`${timestamp}.`), payload);
    } else {
      this.logger.warn(
        "[Stripe] Webhook verification requires the raw request body",
      );
      return false;
    }

    const expectedSignature = hmacSha256Hex(
      this.stripeConfig.webhookSecret,
      signedPayload,
    );

    return signatures.some((v1Signature) =>
      timingSafeEqualHex(expectedSignature, v1Signature),
    );
  }

  /**
   * Parse Stripe webhook event into normalized WebhookEvent.
   *
   * Dual-writes Phase 7 PaymentEvent (`event` / `stableType` / `provider`) while
   * keeping provider-native `type` (e.g. `payment_intent.succeeded`).
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    // Stripe payload structure is { id: ..., type: ..., data: { object: ... } }
    // If payload is raw string, parse it
    let raw: StripeWebhookPayload;
    if (typeof payload === "string") {
      raw = JSON.parse(payload) as StripeWebhookPayload;
    } else if (payload instanceof Uint8Array) {
      raw = JSON.parse(new TextDecoder().decode(payload)) as StripeWebhookPayload;
    } else {
      raw = payload as StripeWebhookPayload;
    }

    assertStripeSnapshotEvent(raw);
    assertStripeEventObjectDetails(raw);

    const expectedApiVersion = stripeExpectedWebhookApiVersion(
      this.stripeConfig,
    );
    if (
      expectedApiVersion &&
      raw.api_version &&
      raw.api_version !== expectedApiVersion
    ) {
      throw new InvalidRequestError(
        `Stripe webhook API version ${raw.api_version} does not match expected ${expectedApiVersion}`,
      );
    }

    const object = raw.data.object;

    // Extract payment ID
    const paymentId = stripeWebhookMetadataPaymentId(object);
    const gatewayPaymentId = stripeWebhookPaymentId(object, raw.type);
    const gatewayObjectId =
      gatewayPaymentId === object.id ? undefined : object.id;
    // Dual IDs: when money events prefer PI for gatewayPaymentId, surface the
    // related subscription here (only when distinct from gatewayPaymentId).
    const relatedSubscriptionId = stripeWebhookSubscriptionId(object);
    const gatewaySubscriptionId =
      relatedSubscriptionId && relatedSubscriptionId !== gatewayPaymentId
        ? relatedSubscriptionId
        : undefined;

    // Determine status/type
    let status: PaymentStatus = "pending";
    // Only set amount from real money fields — do not default to 0.
    let amount: number | undefined;
    // STRIPE-2: do not default missing currency to "usd" for conversion or
    // the normalized event. Without currency, omit amount (wrong scale risk
    // for zero-decimal / three-decimal codes, esp. invoice/checkout).
    const currency = stripeCurrencyCode(
      typeof object.currency === "string" ? object.currency : undefined,
    );
    const convertMinor = (
      minor: number | undefined | null,
    ): number | undefined => {
      if (currency === undefined || minor === undefined || minor === null) {
        return undefined;
      }
      if (typeof minor !== "number" || !Number.isFinite(minor)) {
        return undefined;
      }
      return fromStripeAmount(minor, currency);
    };

    if (object.object === "payment_intent") {
      const pi = object as any;
      // Prefer settled amount for succeeded PaymentIntents:
      // amount_received → amount_captured (latest_charge / charges.data).
      if (
        raw.type === "payment_intent.succeeded" ||
        pi.status === "succeeded"
      ) {
        const settled = resolveStripeCapturedMinor(pi);
        if (settled !== undefined) {
          amount = convertMinor(settled);
        } else if (typeof pi.amount === "number") {
          // Incomplete snapshot: report authorized amount only (status fail-closed).
          amount = convertMinor(pi.amount);
        }
      } else if (typeof pi.amount === "number") {
        amount = convertMinor(pi.amount);
      }
    } else if (object.amount !== undefined) {
      amount = convertMinor(object.amount);
    }
    // Checkout sessions use amount_total instead of amount
    if (object.amount_total !== undefined) {
      amount = convertMinor(object.amount_total);
    }
    if (object.object === "invoice") {
      const invoice = object as any;
      const invoiceAmount = stripeInvoiceAmount(raw.type, invoice);
      if (invoiceAmount !== undefined) {
        amount = convertMinor(invoiceAmount);
      }
    }

    // Map status based on event type
    switch (raw.type) {
      case "payment_intent.succeeded":
        status = this.succeededPaymentIntentWebhookStatus(object);
        break;
      case "payment_intent.payment_failed":
        status = "failed";
        break;
      case "payment_intent.canceled":
        status = "cancelled";
        break;
      case "payment_intent.created":
        status = "pending";
        break;
      case "checkout.session.completed": {
        // Checkout sessions have a specific payment_status field
        const session = object as unknown as StripeCheckoutSession & {
          mode?: string;
        };
        if (session.payment_status === "paid") {
          status = "paid";
        } else if (
          session.payment_status === "no_payment_required" &&
          session.status === "complete"
        ) {
          // setup_completed only for true setup flows.
          // payment-mode $0 / free / coupon → fulfillment-ready paid.
          // subscription-mode no_payment_required (trials, $0 first invoice)
          // is NOT paid — align with subscription lifecycle trialing→pending
          // so type-only handlers do not unlock fulfillment before collection
          // (STRIPE-2). Dual-write stays provider.unmapped (not payment.succeeded).
          // STRIPE-3: when `mode` is missing (and no setup_intent), fail closed
          // to pending — do not invent paid fulfillment from an incomplete session.
          if (
            session.mode === "setup" ||
            expandableId(session.setup_intent) !== undefined
          ) {
            status = "setup_completed";
          } else if (session.mode === "subscription") {
            status = "pending";
          } else if (session.mode === "payment") {
            status = "paid";
          } else {
            status = "pending";
          }
        } else {
          // incomplete / unpaid checkout remains pending
          status = "pending";
        }
        break;
      }
      case "checkout.session.async_payment_succeeded":
        status = "paid";
        break;
      case "checkout.session.async_payment_failed":
        status = "failed";
        break;
      case "checkout.session.expired":
        status = "cancelled";
        break;
      case "charge.refunded": {
        const charge = object as any;
        // STRIPE-3: event.amount is cumulative amount_refunded (refund money moved),
        // not charge/captured total. Dual-write Refund.amount must not over-credit
        // wallets on partial refunds. Omit amount when refund money is incomplete.
        // (WebhookEvent has no separate refundedAmount field.)
        if (charge.refunded === true) {
          status = "refunded";
        } else if (
          typeof charge.amount_refunded === "number" &&
          Number.isFinite(charge.amount_refunded) &&
          // Align with getPayment: amount_refunded must be > 0. Zero is not a
          // proven partial refund (would overstate money moved as partial).
          charge.amount_refunded > 0
        ) {
          const capturedBase =
            typeof charge.amount_captured === "number" &&
            Number.isFinite(charge.amount_captured)
              ? charge.amount_captured
              : charge.amount;
          status =
            typeof capturedBase === "number" &&
            Number.isFinite(capturedBase) &&
            capturedBase > 0 &&
            charge.amount_refunded >= capturedBase
              ? "refunded"
              : "partially_refunded";
        } else {
          // Incomplete snapshot (missing or zero amount_refunded without
          // refunded:true): do not fail-open to full `refunded` or invent partial.
          // Domain stays refund_completed; dual-write demoted to refund.pending
          // (STRIPE-2 / Paymob pattern).
          status = "refund_completed";
        }

        // Prefer proven amount_refunded; clear any charge-total default from above.
        if (
          typeof charge.amount_refunded === "number" &&
          Number.isFinite(charge.amount_refunded) &&
          charge.amount_refunded > 0
        ) {
          amount = convertMinor(charge.amount_refunded);
        } else {
          // Incomplete refund money — omit rather than publish charge total.
          amount = undefined;
        }
        break;
      }
      case "refund.created":
      case "refund.updated":
      case "charge.refund.updated": {
        status = mapStripeRefundWebhookStatus(object.status, object);
        // STRIPE-3: refund.* object.amount is per-refund, but status may be
        // charge-aggregate (refunded / partially_refunded from expanded charge).
        // When aggregate totals prove the state, publish cumulative
        // amount_refunded so event.amount / dual-write Refund.amount match
        // charge-level money moved (same as charge.refunded rewrite). Incomplete
        // aggregates keep the per-refund face amount.
        if (status === "refunded" || status === "partially_refunded") {
          const charge = (object as { charge?: unknown }).charge;
          if (
            typeof charge === "object" &&
            charge !== null &&
            typeof (charge as { amount_refunded?: unknown }).amount_refunded ===
              "number" &&
            Number.isFinite(
              (charge as { amount_refunded: number }).amount_refunded,
            ) &&
            (charge as { amount_refunded: number }).amount_refunded > 0
          ) {
            amount = convertMinor(
              (charge as { amount_refunded: number }).amount_refunded,
            );
          }
        }
        break;
      }
      case "refund.failed":
        status = "failed";
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.marked_uncollectible":
      case "invoice.created":
      case "invoice.finalized":
      case "invoice.updated":
        status = stripeInvoiceStatus(raw.type, object.status);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
      case "customer.subscription.trial_will_end":
        status =
          raw.type === "customer.subscription.deleted"
            ? "cancelled"
            : stripeSubscriptionStatus(object.status);
        break;
      // Subscription schedule events (for future subscription management)
      case "subscription_schedule.created":
      case "subscription_schedule.updated":
      case "subscription_schedule.released":
      case "subscription_schedule.canceled":
      case "subscription_schedule.completed":
      case "subscription_schedule.expiring":
      case "subscription_schedule.aborted":
        // Pass through with pending status - consumers should handle these specifically
        status = "pending";
        break;
      default:
        // Only map PaymentIntent statuses via mapStatus (fail-closed for
        // unknown PI states). Non-PI objects must not run through the PI map —
        // foreign statuses like subscription "active" would incorrectly become
        // failed. Leave unmapped event types as pending.
        if (object.object === "payment_intent") {
          if (object.status === "succeeded") {
            status = this.succeededPaymentIntentWebhookStatus(object);
          } else {
            status = this.mapStatus(object.status);
          }
        } else {
          status = "pending";
        }
    }

    const legacy: WebhookEvent = {
      id: raw.id,
      type: raw.type,
      gateway: "stripe",
      paymentId,
      gatewayPaymentId,
      gatewayObjectId,
      gatewaySubscriptionId,
      status,
      livemode: raw.livemode === true,
      apiVersion: raw.api_version ?? undefined,
      amount,
      // Normalize to uppercase ISO 4217 for cross-gateway consistency
      // (Stripe reports currency in lowercase). Omit when Stripe omits currency.
      currency: currency?.toUpperCase(),
      timestamp: new Date(raw.created * 1000),
      rawPayload: raw,
    };

    // Richer stable mapping for checkout / object-type–dependent events.
    const mapContext: ProviderEventMapContext = {};
    if (typeof object.object === "string") {
      mapContext.objectType = object.object;
    }
    if (typeof object.payment_status === "string") {
      mapContext.paymentStatus = object.payment_status;
    }
    const sessionMode = (object as { mode?: string }).mode;
    if (typeof sessionMode === "string") {
      mapContext.mode = sessionMode;
    }

    const attached = attachPaymentEvent(legacy, {
      computePayloadHash: true,
      mapContext,
    });
    // Incomplete settled money (status processing) must not dual-write
    // payment.succeeded — type-only handlers would over-fulfill (STRIPE-1).
    // Incomplete refund snapshots (status refund_completed) must not dual-write
    // refund.completed — type-only handlers would over-settle (STRIPE-2).
    return this.demoteIncompleteRefundWebhookDualWrite(
      this.demoteIncompleteSettledWebhookDualWrite(attached),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * STRIPE-1: GET PaymentIntent, require caller currency === PI currency, convert
   * majors with the PI scale. Mirrors Paymob `resolveActionAmountCents`.
   */
  private async resolvePartialAmountToStripeMinor(
    operation: "capturePayment" | "refundPayment",
    paymentIntentPathId: string,
    amount: AmountInput,
    currency: string | undefined,
    signal?: AbortSignal,
  ): Promise<number> {
    const callerCurrency = requireCurrencyForPartialAmount(operation, currency);
    const paymentIntent = await this.stripeRequest<StripePaymentIntent>(
      "GET",
      `/payment_intents/${paymentIntentPathId}`,
      undefined,
      undefined,
      signal,
    );
    const piCurrency = assertPartialAmountCurrencyMatchesPaymentIntent(
      operation,
      callerCurrency,
      paymentIntent.currency,
    );
    return toStripeAmount(amount, piCurrency);
  }

  private async getTotalRefundedForPaymentIntent(
    paymentIntentId: string,
    fallbackCurrency: string,
    signal?: AbortSignal,
  ): Promise<number> {
    let totalMinorAmount = 0;
    let currency = fallbackCurrency;
    let startingAfter: string | undefined;

    do {
      const query = new URLSearchParams({
        payment_intent: paymentIntentId,
        limit: "100",
      });
      if (startingAfter) {
        query.set("starting_after", startingAfter);
      }

      const page = await this.stripeRequest<StripeListResponse<StripeRefund>>(
        "GET",
        `/refunds?${query.toString()}`,
        undefined,
        undefined,
        signal,
      );

      for (const refund of page.data) {
        if (refund.status !== "succeeded") {
          continue;
        }
        currency = refund.currency ?? currency;
        totalMinorAmount += refund.amount;
      }

      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter);

    return fromStripeAmount(totalMinorAmount, currency);
  }

  /**
   * Make request to Stripe API
   */
  private async stripeRequest<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    validateStripeIdempotencyKey(idempotencyKey);

    // Safe to retry GET/HEAD always; retry mutations only when an idempotency
    // key is present so Stripe deduplicates a re-sent request.
    const retryableRequest =
      method === "GET" || method === "HEAD" || idempotencyKey !== undefined;

    return withRetry(
      () =>
        this.stripeRequestOnce<T>(
          method,
          endpoint,
          body,
          idempotencyKey,
          signal,
        ),
      { isRetryable: retryableRequest ? isStripeRetryableError : () => false },
    );
  }

  private async stripeRequestOnce<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>,
    idempotencyKey?: string,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.stripeConfig.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version":
        this.stripeConfig.apiVersion ?? DEFAULT_STRIPE_API_VERSION,
    };

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT")) {
      options.body = toUrlEncoded(body);
    }

    const timeoutMs = this.stripeConfig.timeoutMs ?? DEFAULT_STRIPE_TIMEOUT_MS;
    const { signal: timeoutSignal, clear } = createTimeoutSignal(timeoutMs);
    const signal = combineAbortSignals(callerSignal, timeoutSignal);
    if (signal !== undefined) {
      options.signal = signal;
    }

    let response: Response;
    let responseText = "";
    try {
      response = await this.fetch(`${this.baseUrl}${endpoint}`, options);
      responseText = await response.text();
    } catch (e) {
      throw mapHttpAbortError(e, {
        callerSignal,
        timeoutSignal,
        timeoutMessage: `Stripe API request timed out after ${timeoutMs}ms`,
        networkMessage: "Failed to reach Stripe API",
        callerAbortMessage: "Stripe API request aborted by caller signal",
      });
    } finally {
      clear();
    }

    let data: any = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        data = { error: { message: responseText, type: "api_error" } };
      }
    }

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      if (response.status === 429) {
        throw new RateLimitError(
          "stripe",
          retryAfter ? Number(retryAfter) : undefined,
        );
      }

      if (response.status === 401) {
        throw new AuthenticationError(
          data.error?.message ?? "Stripe authentication failed",
          data,
        );
      }

      if (response.status >= 500) {
        throw new NetworkError(
          data.error?.message ?? "Stripe API unavailable",
          data,
        );
      }

      throw new GatewayApiError(
        data.error?.message ?? "Stripe API error",
        "stripe",
        { ...data, statusCode: response.status },
      );
    }

    return data as T;
  }

  /**
   * Map a Stripe PaymentIntent to GatewayPaymentResult with Phase 6 outcome +
   * ProviderReferences. Dual-writes deprecated `success` via applyOutcome helper.
   */
  private mapPaymentIntentResult(
    intent: StripePaymentIntent,
    options: {
      status?: PaymentStatus | undefined;
      amount?: number | undefined;
      /** ISO currency for major-unit money fields; required whenever amount/refundedAmount set (STRIPE-1). */
      currency?: string | undefined;
      refundedAmount?: number | undefined;
      chargeId?: string | undefined;
      omitRedirectUrl?: boolean | undefined;
      forceOutcome?: PaymentOperationOutcome | undefined;
    } = {},
  ): GatewayPaymentResult {
    const status = options.status ?? this.mapStatus(intent.status);
    const nextAction = intent.next_action ?? undefined;
    const redirectUrl = options.omitRedirectUrl
      ? undefined
      : stripeNextActionRedirectUrl(intent.next_action);
    let chargeId = options.chargeId;
    if (chargeId === undefined) {
      if (typeof intent.latest_charge === "string") {
        chargeId = intent.latest_charge;
      } else if (
        typeof intent.latest_charge === "object" &&
        intent.latest_charge !== null &&
        typeof intent.latest_charge.id === "string"
      ) {
        chargeId = intent.latest_charge.id;
      }
    }

    const outcome =
      options.forceOutcome ??
      this.mapStripeOutcome(intent.status, status, nextAction);

    // STRIPE-1: never publish naked major-unit money without currency.
    // Fail closed — drop amount-like fields when currency is missing.
    const hasMoneyField =
      options.amount !== undefined || options.refundedAmount !== undefined;
    const currency =
      options.currency !== undefined && options.currency.trim().length > 0
        ? options.currency.trim().toUpperCase()
        : undefined;
    const publishMoney = hasMoneyField && currency !== undefined;

    return applyOutcomeToGatewayResult(
      {
        gatewayId: intent.id,
        status,
        rawResponse: intent,
        ...(redirectUrl !== undefined ? { redirectUrl } : {}),
        ...(publishMoney && options.amount !== undefined
          ? { amount: options.amount }
          : {}),
        ...(publishMoney && options.refundedAmount !== undefined
          ? { refundedAmount: options.refundedAmount }
          : {}),
        ...(publishMoney ? { currency } : {}),
        ...(intent.client_secret
          ? { clientSecret: intent.client_secret }
          : {}),
        ...(nextAction !== undefined ? { nextAction } : {}),
        providerNativeStatus: intent.status,
        ...(chargeId !== undefined ? { chargeId } : {}),
        gateway: "stripe",
      },
      outcome,
    );
  }

  /**
   * Stripe PI native status → operation outcome.
   * requires_action / requires_payment_method / requires_confirmation never succeed.
   *
   * **Fulfillment honesty:** `outcome === "succeeded"` is not paid alone.
   * Prefer {@link import('../../types/operation-result').isPaidOutcome} or
   * `status === "paid"`. Partial capture is open money → `requires_action`
   * (Paymob parity; isPaidOutcome excludes partially_captured).
   */
  private mapStripeOutcome(
    nativeStatus: string,
    mappedStatus: PaymentStatus,
    nextAction: PaymentNextAction | undefined,
  ): PaymentOperationOutcome {
    if (
      nativeStatus === "requires_action" ||
      nativeStatus === "requires_payment_method" ||
      nativeStatus === "requires_confirmation"
    ) {
      return "requires_action";
    }
    if (nextAction !== undefined) {
      return "requires_action";
    }
    if (mappedStatus === "failed") {
      return "declined";
    }
    if (mappedStatus === "cancelled") {
      // Void/cancel of the intent — not a successful charge. voidPayment sets
      // forceOutcome: "succeeded" for intentional void completion.
      return "failed";
    }
    if (
      mappedStatus === "pending" ||
      mappedStatus === "processing" ||
      // Open money: partial capture is not full settlement (Paymob demotes too).
      mappedStatus === "partially_captured"
    ) {
      // Still settling / needs confirm / incomplete capture — never fulfill as paid.
      return "requires_action";
    }
    // paid | authorized | partially_refunded | refunded | setup_completed
    return "succeeded";
  }

  /**
   * When domain status is `processing` on `payment_intent.succeeded` (incomplete
   * settled snapshot — missing amount_received / amount_captured), demote
   * Phase-7 dual-write from `payment.succeeded` → `payment.processing` so
   * type-only fulfillment matches isPaidOutcome (STRIPE-3).
   *
   * Partial capture (`partially_captured`) is demoted in webhook-event-map;
   * incomplete-settled `processing` is not always mapped there, so the gateway
   * fail-closes dual-write here. Also demotes `partially_captured` if the map
   * left `payment.succeeded` (belt-and-suspenders money honesty).
   */
  private demoteIncompleteSettledWebhookDualWrite(
    event: WebhookEvent,
  ): WebhookEvent {
    const openMoney =
      event.status === "processing" || event.status === "partially_captured";
    if (
      !openMoney ||
      event.type !== "payment_intent.succeeded" ||
      event.stableType !== "payment.succeeded" ||
      !event.event ||
      event.event.type !== "payment.succeeded" ||
      !event.provider
    ) {
      return event;
    }

    const payment = event.event.payment ?? paymentFromWebhookEvent(event);

    return {
      ...event,
      stableType: "payment.processing",
      event: {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: "payment.processing",
        payment,
        provider: event.provider,
      },
    };
  }

  /**
   * Incomplete refund snapshots (`status === refund_completed`) must not
   * dual-write `refund.completed` — type-only handlers would mark orders fully
   * refunded without proven `amount_refunded` / `refunded:true` (STRIPE-2).
   * Paymob pattern: domain keeps incomplete marker; stable dual-write is
   * `refund.pending`. Proven full/partial (`refunded` / `partially_refunded`)
   * keep `refund.completed`.
   */
  private demoteIncompleteRefundWebhookDualWrite(
    event: WebhookEvent,
  ): WebhookEvent {
    if (
      event.status !== "refund_completed" ||
      event.stableType !== "refund.completed" ||
      !event.event ||
      event.event.type !== "refund.completed" ||
      !event.provider
    ) {
      return event;
    }

    const refund = event.event.refund;

    return {
      ...event,
      stableType: "refund.pending",
      event: {
        schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
        type: "refund.pending",
        refund,
        provider: event.provider,
      },
    };
  }

  /**
   * Map Stripe PaymentIntent status to unified status.
   * Unmapped statuses fail closed as `failed` (with a warning) so callers do
   * not treat unknown states as pending fulfillment.
   */
  private mapStatus(stripeStatus: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      requires_payment_method: "pending",
      requires_confirmation: "pending",
      requires_action: "pending",
      processing: "processing",
      requires_capture: "authorized",
      succeeded: "paid",
      canceled: "cancelled",
    };
    const mapped = map[stripeStatus];
    if (mapped) {
      return mapped;
    }
    this.logger.warn(
      `[Stripe] Unmapped PaymentIntent status "${stripeStatus}"; treating as failed`,
    );
    return "failed";
  }

  /**
   * Succeeded PaymentIntent status from money fields.
   * - settled (amount_received → amount_captured) < amount → partially_captured
   * - settled known and not partial → paid
   * - settled missing → processing (fail closed; never claim full paid)
   */
  private succeededPaymentIntentWebhookStatus(
    object: StripeWebhookPayload["data"]["object"],
  ): PaymentStatus {
    const pi = object as any;
    const settled = resolveStripeCapturedMinor(pi);
    if (settled === undefined) {
      // Incomplete money snapshot — do not map missing settled amount to paid.
      return "processing";
    }
    if (
      typeof pi.amount === "number" &&
      Number.isFinite(pi.amount) &&
      settled < pi.amount
    ) {
      return "partially_captured";
    }
    return "paid";
  }
}
