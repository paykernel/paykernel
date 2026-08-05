/**
 * Phase 6 — operation result helpers + domain type contracts (runtime + type).
 */
import { describe, it, expect } from "bun:test";
import type {
  CommonPaymentInput,
  GatewayPaymentResult,
  PaymentOperationResult,
  PaymentDomainStatus,
  AuthorizationStatus,
  CaptureStatus,
  RefundDomainStatus,
  SetupTokenStatus,
  DisputeStatus,
  TransferStatus,
  PayoutStatus,
  ProviderReferences,
  Payment,
} from "../index";
import {
  mapGatewayResultToOperationResult,
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  isPaidOutcome,
  isRequiresActionOutcome,
  isIndeterminateOutcome,
  buildProviderReferences,
  inferOperationOutcome,
  successFromOutcome,
  successFromRefundOutcome,
  isPaymentDomainStatus,
  isPaidLikePaymentStatus,
  paymentFromGatewayResult,
  toPaymentErrorLike,
  paymentNextActionToAction,
  inferRefundOperationOutcome,
  mapGatewayRefundToOperationResult,
  isGatewayPaymentResult,
} from "../index";

/** Compile-time assignability (erased at runtime). */
function expectType<T>(_value: T): void {}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

function expectTypesEqual<A, B>(
  _ok: Equal<A, B> extends true ? true : never,
): void {}

// ─── 6.1 CommonPaymentInput has no provider keys ─────────────────────────────

type CommonKeys = keyof CommonPaymentInput;
type ForbiddenProviderKeys =
  | "stripePaymentMethodId"
  | "stripeCustomerId"
  | "stripeSetupFutureUsage"
  | "moyasarSource"
  | "tokenId"
  | "applyCoupon"
  | "returnUrl"
  | "cancelUrl"
  | "paypalShippingPreference"
  | "paymobIntegrationId"
  | "paymobPaymentMethods"
  | "paymobIframeId"
  | "paymobBillingData";

type CommonHasProviderKey = CommonKeys & ForbiddenProviderKeys;
expectTypesEqual<CommonHasProviderKey, never>(true);

const commonOnly: CommonPaymentInput = {
  amount: 10,
  orderId: "ord_1",
  description: "test",
  metadata: { a: 1 },
};
expectType<CommonPaymentInput>(commonOnly);

// ─── 6.2 Outcome arms are not mutually assignable ────────────────────────────

type SucceededArm = Extract<PaymentOperationResult, { outcome: "succeeded" }>;
type RequiresActionArm = Extract<
  PaymentOperationResult,
  { outcome: "requires_action" }
>;
type DeclinedArm = Extract<PaymentOperationResult, { outcome: "declined" }>;
type IndeterminateArm = Extract<
  PaymentOperationResult,
  { outcome: "indeterminate" }
>;

// @ts-expect-error — requires_action is not assignable to succeeded arm
const _reqAsSucceeded: SucceededArm = null! as RequiresActionArm;
void _reqAsSucceeded;

// @ts-expect-error — succeeded is not assignable to requires_action arm
const _succAsReq: RequiresActionArm = null! as SucceededArm;
void _succAsReq;

// @ts-expect-error — declined is not assignable to succeeded
const _decAsSucc: SucceededArm = null! as DeclinedArm;
void _decAsSucc;

// Indeterminate must carry reconciliationRequired: true
const indArm: IndeterminateArm = {
  outcome: "indeterminate",
  reconciliationRequired: true,
};
expectType<IndeterminateArm>(indArm);

// ─── 6.3 Domain status unions are distinct ───────────────────────────────────

expectType<PaymentDomainStatus>("paid");
expectType<AuthorizationStatus>("authorized");
expectType<CaptureStatus>("completed");
expectType<RefundDomainStatus>("pending");
expectType<SetupTokenStatus>("requires_action");
expectType<DisputeStatus>("won");
expectType<TransferStatus>("in_transit");
expectType<PayoutStatus>("paid");

// PaymentDomainStatus must not include setup_completed / refund_pending
// @ts-expect-error — setup_completed is legacy mega-union only
const _notDomain: PaymentDomainStatus = "setup_completed";
void _notDomain;
// @ts-expect-error — refund_pending is legacy mega-union only
const _notDomainRefund: PaymentDomainStatus = "refund_pending";
void _notDomainRefund;

// ─── Runtime helpers ─────────────────────────────────────────────────────────

function baseResult(
  overrides: Partial<GatewayPaymentResult> = {},
): GatewayPaymentResult {
  return {
    success: true,
    gatewayId: "pay_1",
    status: "paid",
    redirectUrl: undefined,
    rawResponse: {},
    ...overrides,
  };
}

describe("operation-result helpers", () => {
  it("maps paid status + success to outcome succeeded; isPaidOutcome true", () => {
    const result = baseResult({ status: "paid", success: true, amount: 10 });
    const op = mapGatewayResultToOperationResult(result, { gateway: "moyasar" });
    expect(op.outcome).toBe("succeeded");
    if (op.outcome !== "succeeded") throw new Error("expected succeeded");
    expect(op.payment.status).toBe("paid");
    expect(op.payment.references.providerObjectId).toBe("pay_1");
    expect(isPaidOutcome(result)).toBe(true);
    expect(isPaidOutcome(op)).toBe(true);
    expect(isRequiresActionOutcome(result)).toBe(false);
  });

  it("maps requires_action (nextAction + pending) and isPaidOutcome false", () => {
    const result = baseResult({
      success: true,
      status: "pending",
      redirectUrl: "https://example.com/3ds",
      nextAction: { type: "redirect", url: "https://example.com/3ds" },
    });
    const op = mapGatewayResultToOperationResult(result);
    expect(op.outcome).toBe("requires_action");
    if (op.outcome !== "requires_action") throw new Error("expected requires_action");
    expect(op.action.type).toBe("redirect");
    expect(isPaidOutcome(result)).toBe(false);
    expect(isRequiresActionOutcome(result)).toBe(true);
    expect(isRequiresActionOutcome(op)).toBe(true);
  });

  it("never maps pending/requires_action path to succeeded", () => {
    const pending = baseResult({
      success: true,
      status: "pending",
      clientSecret: "pi_secret",
    });
    expect(inferOperationOutcome(pending)).toBe("requires_action");
    expect(mapGatewayResultToOperationResult(pending).outcome).not.toBe(
      "succeeded",
    );
    expect(isPaidOutcome(pending)).toBe(false);

    const withAction = baseResult({
      success: true,
      status: "processing",
      nextAction: { type: "stcpay_otp", transactionUrl: "https://otp", method: "POST", parameter: "otp_value" },
    });
    expect(mapGatewayResultToOperationResult(withAction).outcome).toBe(
      "requires_action",
    );
  });

  it("maps declined with PaymentDecline", () => {
    const result = baseResult({
      success: false,
      status: "failed",
      decline: { code: "card_declined", message: "Card declined" },
    });
    const op = mapGatewayResultToOperationResult(result);
    expect(op.outcome).toBe("declined");
    if (op.outcome !== "declined") throw new Error("expected declined");
    expect(op.failure.code).toBe("card_declined");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("maps indeterminate markers to outcome indeterminate + reconciliationRequired", () => {
    const result = baseResult({
      success: false,
      status: "pending",
      reconciliationRequired: true,
      providerRequestId: "req_abc",
    });
    const op = mapGatewayResultToOperationResult(result);
    expect(op.outcome).toBe("indeterminate");
    if (op.outcome !== "indeterminate") throw new Error("expected indeterminate");
    expect(op.reconciliationRequired).toBe(true);
    expect(op.providerRequestId).toBe("req_abc");
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(isIndeterminateOutcome(op)).toBe(true);
    expect(isPaidOutcome(result)).toBe(false);

    const viaRaw = baseResult({
      success: false,
      status: "pending",
      rawResponse: { reconciliationRequired: true },
    });
    expect(inferOperationOutcome(viaRaw)).toBe("indeterminate");
  });

  it("applyOutcomeToGatewayResult dual-writes success from outcome", () => {
    const paid = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_1",
        status: "paid",
        rawResponse: { ok: true },
        amount: 25,
        gateway: "stripe",
      },
      "succeeded",
    );
    expect(paid.success).toBe(true);
    expect(paid.outcome).toBe("succeeded");
    expect(paid.references?.providerObjectId).toBe("pi_1");
    expect(paid.references?.gateway).toBe("stripe");
    expect(isPaidOutcome(paid)).toBe(true);

    const action = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_2",
        status: "pending",
        rawResponse: {},
        redirectUrl: "https://3ds",
        nextAction: { type: "redirect", url: "https://3ds" },
        gateway: "moyasar",
      },
      "requires_action",
    );
    expect(action.success).toBe(true);
    expect(action.outcome).toBe("requires_action");
    expect(isPaidOutcome(action)).toBe(false);

    const declined = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_3",
        status: "failed",
        rawResponse: {},
        gateway: "stripe",
      },
      "declined",
      { decline: { code: "generic_decline", message: "Declined" } },
    );
    expect(declined.success).toBe(false);
    expect(declined.outcome).toBe("declined");
    expect(declined.decline?.code).toBe("generic_decline");

    const ind = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_4",
        status: "pending",
        rawResponse: {},
        providerRequestId: "req_1",
        gateway: "paymob",
      },
      "indeterminate",
    );
    expect(ind.success).toBe(false);
    expect(ind.outcome).toBe("indeterminate");
    expect(ind.reconciliationRequired).toBe(true);
    expect(isIndeterminateOutcome(ind)).toBe(true);
  });

  it("successFromOutcome matches documented dual-write table", () => {
    expect(successFromOutcome("succeeded")).toBe(true);
    expect(successFromOutcome("requires_action")).toBe(true);
    expect(successFromOutcome("declined")).toBe(false);
    expect(successFromOutcome("failed")).toBe(false);
    expect(successFromOutcome("indeterminate")).toBe(false);
  });

  it("authorized success is not paid for fulfillment", () => {
    const result = baseResult({ success: true, status: "authorized" });
    // Operation may be succeeded (auth hold created) but not paid-like
    expect(inferOperationOutcome(result)).toBe("succeeded");
    expect(isPaidOutcome(result)).toBe(false);
    expect(isPaidLikePaymentStatus("authorized")).toBe(false);
    expect(isPaidLikePaymentStatus("paid")).toBe(true);
  });

  it("buyer pre-capture approved is not paid-like and not isPaidOutcome", () => {
    expect(isPaidLikePaymentStatus("approved")).toBe(false);
    expect(isPaidLikePaymentStatus("authorized")).toBe(false);

    const approved = baseResult({ success: true, status: "approved" });
    // Uncaptured approval must not look settled to poll / fulfillment helpers
    expect(inferOperationOutcome(approved)).toBe("requires_action");
    expect(isPaidOutcome(approved)).toBe(false);

    const op = mapGatewayResultToOperationResult(approved);
    expect(op.outcome).toBe("requires_action");
    expect(isPaidOutcome(op)).toBe(false);

    // Forced dual-write of outcome=succeeded still fails paid-like gate.
    const forced = baseResult({
      success: true,
      status: "approved",
      outcome: "succeeded",
    });
    expect(isPaidOutcome(forced)).toBe(false);
  });

  it("buildProviderReferences dual-writes related ids", () => {
    const refs: ProviderReferences = buildProviderReferences({
      gateway: "paypal",
      gatewayId: "ORDER-1",
      status: "pending",
      orderId: "ORDER-1",
      captureId: "CAP-1",
      authorizationId: "AUTH-1",
      internalReference: "merchant_ord_9",
      providerRequestId: "req_pp",
      providerNativeStatus: "CREATED",
    });
    expect(refs.providerObjectId).toBe("ORDER-1");
    expect(refs.gateway).toBe("paypal");
    expect(refs.normalizedStatus).toBe("pending");
    expect(refs.relatedIds?.orderId).toBe("ORDER-1");
    expect(refs.relatedIds?.captureId).toBe("CAP-1");
    expect(refs.relatedIds?.authorizationId).toBe("AUTH-1");
    expect(refs.internalReference).toBe("merchant_ord_9");
    expect(refs.providerRequestId).toBe("req_pp");
    expect(refs.providerNativeStatus).toBe("CREATED");
  });

  it("paymentFromGatewayResult uses existing references when present", () => {
    const references = buildProviderReferences({
      gateway: "stripe",
      gatewayId: "pi_x",
      status: "paid",
    });
    const result = baseResult({ references, gatewayId: "pi_x" });
    const payment: Payment = paymentFromGatewayResult(result);
    expect(payment.references).toBe(references);
  });

  it("isPaymentDomainStatus excludes legacy mega-union-only values", () => {
    expect(isPaymentDomainStatus("paid")).toBe(true);
    expect(isPaymentDomainStatus("pending")).toBe(true);
    expect(isPaymentDomainStatus("setup_completed")).toBe(false);
    expect(isPaymentDomainStatus("refund_pending")).toBe(false);
    expect(isPaymentDomainStatus("refund_completed")).toBe(false);
  });

  it("explicit outcome on GatewayPaymentResult wins over heuristics", () => {
    const result = baseResult({
      success: true,
      status: "paid",
      outcome: "indeterminate",
      reconciliationRequired: true,
    });
    expect(inferOperationOutcome(result)).toBe("indeterminate");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("reconciliationRequired blocks isPaidOutcome even with outcome succeeded (CORE-1)", () => {
    const result = baseResult({
      success: true,
      status: "paid",
      outcome: "succeeded",
      reconciliationRequired: true,
    });
    expect(inferOperationOutcome(result)).toBe("indeterminate");
    expect(isPaidOutcome(result)).toBe(false);

    const op = mapGatewayResultToOperationResult(result);
    expect(isPaidOutcome(op)).toBe(false);
  });

  it("cancelled status is not paid and not succeeded unless outcome forced", () => {
    const cancelled = baseResult({
      success: true,
      status: "cancelled",
    });
    expect(inferOperationOutcome(cancelled)).toBe("failed");
    expect(isPaidOutcome(cancelled)).toBe(false);

    const voided = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_void",
        status: "cancelled",
        rawResponse: {},
        gateway: "stripe",
      },
      "succeeded",
    );
    expect(voided.outcome).toBe("succeeded");
    expect(voided.status).toBe("cancelled");
    expect(isPaidOutcome(voided)).toBe(false);
  });

  it("CORE-1: Phase-6 preserves partial-capture requires_action (no upgrade to succeeded)", () => {
    // Gateways (Paymob/Stripe) demote partially_captured → requires_action.
    const partial = baseResult({
      success: true,
      status: "partially_captured",
      outcome: "requires_action",
      amount: 5,
      currency: "USD",
      capturedAmount: 5,
    });
    expect(inferOperationOutcome(partial)).toBe("requires_action");
    expect(mapGatewayResultToOperationResult(partial).outcome).toBe(
      "requires_action",
    );
    expect(isPaidOutcome(partial)).toBe(false);
    expect(isRequiresActionOutcome(partial)).toBe(true);

    // Paid + residual requires_action still upgrades (settled money wins).
    const paidWithAction = baseResult({
      success: true,
      status: "paid",
      outcome: "requires_action",
    });
    expect(inferOperationOutcome(paidWithAction)).toBe("succeeded");
    expect(isPaidOutcome(paidWithAction)).toBe(true);
  });

  it("CORE-2: successful void (outcome succeeded + status cancelled) is not failed", () => {
    const voided = baseResult({
      success: true,
      status: "cancelled",
      outcome: "succeeded",
    });
    expect(inferOperationOutcome(voided)).toBe("succeeded");
    const op = mapGatewayResultToOperationResult(voided);
    expect(op.outcome).toBe("succeeded");
    if (op.outcome === "succeeded") {
      expect(op.payment.status).toBe("cancelled");
    }
    // Not a charge settlement — fulfillment gate stays closed.
    expect(isPaidOutcome(voided)).toBe(false);
    expect(isPaidOutcome(op)).toBe(false);

    // Bare cancelled without force still fails closed.
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "cancelled" }),
      ),
    ).toBe("failed");
  });

  it("toPaymentErrorLike fills defaults and optional statusCode", () => {
    expect(toPaymentErrorLike({ message: "x" })).toEqual({
      name: "PaymentError",
      message: "x",
      code: "PAYMENT_ERROR",
    });
    expect(
      toPaymentErrorLike({
        name: "NetworkError",
        message: "down",
        code: "NETWORK_ERROR",
        statusCode: 503,
      }),
    ).toEqual({
      name: "NetworkError",
      message: "down",
      code: "NETWORK_ERROR",
      statusCode: 503,
    });
  });

  it("paymentNextActionToAction maps nextAction and fallback redirect", () => {
    expect(
      paymentNextActionToAction({ type: "redirect", url: "https://a" }),
    ).toEqual({ type: "redirect", url: "https://a" });
    expect(paymentNextActionToAction(undefined, "https://fallback")).toEqual({
      type: "redirect",
      url: "https://fallback",
    });
    expect(paymentNextActionToAction(undefined)).toBeUndefined();
    // Empty type becomes "unknown"
    expect(
      paymentNextActionToAction({ type: "" } as { type: string }),
    ).toEqual({ type: "unknown" });
  });

  it("paymentFromGatewayResult copies optional money and action fields", () => {
    const payment = paymentFromGatewayResult(
      baseResult({
        amount: 12.5,
        currency: "SAR",
        fee: 0.5,
        capturedAmount: 12.5,
        refundedAmount: 1,
        redirectUrl: "https://r",
        clientSecret: "cs_test",
        nextAction: { type: "redirect", url: "https://r" },
      }),
    );
    expect(payment.amount).toBe(12.5);
    expect(payment.currency).toBe("SAR");
    expect(payment.fee).toBe(0.5);
    expect(payment.capturedAmount).toBe(12.5);
    expect(payment.refundedAmount).toBe(1);
    expect(payment.redirectUrl).toBe("https://r");
    expect(payment.clientSecret).toBe("cs_test");
    expect(payment.nextAction?.type).toBe("redirect");
  });

  it("paymentFromGatewayResult fail-closes amount without currency (CORE-1)", () => {
    const incomplete = paymentFromGatewayResult(
      baseResult({
        amount: 12.5,
        fee: 0.5,
        capturedAmount: 12.5,
        refundedAmount: 1,
      }),
    );
    expect(incomplete.amount).toBeUndefined();
    expect(incomplete.currency).toBeUndefined();
    expect(incomplete.fee).toBeUndefined();
    expect(incomplete.capturedAmount).toBeUndefined();
    expect(incomplete.refundedAmount).toBeUndefined();

    const currencyOnly = paymentFromGatewayResult(
      baseResult({ currency: "usd" }),
    );
    expect(currencyOnly.currency).toBe("USD");
    expect(currencyOnly.amount).toBeUndefined();
  });

  it("inferOperationOutcome covers failed/declined/processing branches", () => {
    expect(
      inferOperationOutcome(
        baseResult({ success: false, status: "cancelled" }),
      ),
    ).toBe("failed");
    expect(
      inferOperationOutcome(baseResult({ success: false, status: "failed" })),
    ).toBe("declined");
    expect(
      inferOperationOutcome(
        baseResult({ success: false, status: "pending" }),
      ),
    ).toBe("failed");
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "processing" }),
      ),
    ).toBe("requires_action");
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "partially_refunded" }),
      ),
    ).toBe("succeeded");
  });

  it("mapGatewayResultToOperationResult maps failed and declined arms", () => {
    const failed = mapGatewayResultToOperationResult(
      baseResult({ success: false, status: "cancelled" }),
    );
    expect(failed.outcome).toBe("failed");
    if (failed.outcome === "failed") {
      expect(failed.error.code).toBe("PAYMENT_FAILED");
    }

    const declined = mapGatewayResultToOperationResult(
      baseResult({
        success: false,
        status: "failed",
        decline: { code: "card_declined", message: "nope" },
      }),
    );
    expect(declined.outcome).toBe("declined");
    if (declined.outcome === "declined") {
      expect(declined.failure.code).toBe("card_declined");
    }

    const ind = mapGatewayResultToOperationResult(
      baseResult({
        success: false,
        status: "pending",
        reconciliationRequired: true,
        providerRequestId: "req_x",
      }),
    );
    expect(ind.outcome).toBe("indeterminate");
    if (ind.outcome === "indeterminate") {
      expect(ind.providerRequestId).toBe("req_x");
    }
  });

  it("applyOutcomeToGatewayResult copies optional ids and action extras", () => {
    const full = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_full",
        status: "pending",
        rawResponse: {},
        gateway: "stripe",
        orderId: "ord_1",
        captureId: "cap_1",
        authorizationId: "auth_1",
        amount: 10,
        fee: 1,
        capturedAmount: 10,
        refundedAmount: 0,
        clientSecret: "cs",
        providerRequestId: "req",
      },
      "requires_action",
      {
        action: { type: "use_stripe_sdk", client_secret: "cs" } as never,
        reconciliationRequired: true,
      },
    );
    expect(full.orderId).toBe("ord_1");
    expect(full.captureId).toBe("cap_1");
    expect(full.authorizationId).toBe("auth_1");
    expect(full.clientSecret).toBe("cs");
    expect(full.nextAction).toBeDefined();
    expect(full.reconciliationRequired).toBe(true);
  });

  it("applyOutcomeToGatewayRefundResult dual-writes success from outcome", () => {
    const completed = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_ok",
        status: "completed",
        totalRefunded: 10,
        refundedAt: new Date("2026-01-01T00:00:00Z"),
        rawResponse: { id: "re_ok" },
      },
      "succeeded",
    );
    expect(completed.outcome).toBe("succeeded");
    expect(completed.success).toBe(true);
    expect(completed.success).toBe(successFromRefundOutcome("succeeded"));
    expect(completed.status).toBe("completed");
    expect(completed.totalRefunded).toBe(10);
    expect(completed.refundedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(completed.gatewayRefundId).toBe("re_ok");

    const pending = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_p",
        status: "pending",
        rawResponse: {},
      },
      "pending",
    );
    expect(pending.outcome).toBe("pending");
    expect(pending.success).toBe(true);
    expect(pending.success).toBe(successFromRefundOutcome("pending"));

    const failed = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_f",
        status: "failed",
        rawResponse: {},
      },
      "failed",
    );
    expect(failed.outcome).toBe("failed");
    expect(failed.success).toBe(false);
    expect(failed.success).toBe(successFromRefundOutcome("failed"));
    // Does not invent succeeded from a failed status when outcome is failed
    expect(failed.status).toBe("failed");

    const ind = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_unk",
        status: "pending",
        providerRequestId: "req_r",
        rawResponse: {},
      },
      "indeterminate",
    );
    expect(ind.outcome).toBe("indeterminate");
    expect(ind.success).toBe(false);
    expect(ind.reconciliationRequired).toBe(true);
    expect(ind.providerRequestId).toBe("req_r");
    expect(successFromRefundOutcome("indeterminate")).toBe(false);

    // mapGatewayRefund uses dual-written outcome when present
    const mappedSucceeded = mapGatewayRefundToOperationResult(completed);
    expect(mappedSucceeded.outcome).toBe("succeeded");
    const mappedFailed = mapGatewayRefundToOperationResult(failed);
    expect(mappedFailed.outcome).toBe("failed");
    const mappedInd = mapGatewayRefundToOperationResult(ind);
    expect(mappedInd.outcome).toBe("indeterminate");
    if (mappedInd.outcome === "indeterminate") {
      expect(mappedInd.reconciliationRequired).toBe(true);
    }
  });

  it("inferRefundOperationOutcome + map cover indeterminate and failed", () => {
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "completed",
        gatewayRefundId: "re_1",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
      }),
    ).toBe("succeeded");
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "pending",
        gatewayRefundId: "re_2",
        amount: 1,
        currency: "SAR",
        rawResponse: { indeterminate: true },
      }),
    ).toBe("indeterminate");
    expect(
      inferRefundOperationOutcome({
        success: false,
        status: "failed",
        gatewayRefundId: "re_3",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
      }),
    ).toBe("failed");
    // CORE-1: explicit pending + completed status coerces to succeeded (status wins)
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "completed",
        gatewayRefundId: "re_4",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "pending",
      }),
    ).toBe("succeeded");

    // CORE-1: reconciliationRequired beats explicit outcome succeeded
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "completed",
        gatewayRefundId: "re_recon",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "succeeded",
        reconciliationRequired: true,
      }),
    ).toBe("indeterminate");

    // CORE-1: bare infer must not report succeeded while status pending
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "pending",
        gatewayRefundId: "re_pending_coerce",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "succeeded",
      }),
    ).toBe("pending");

    // CORE-1: bare infer coerces succeeded + failed status → failed
    expect(
      inferRefundOperationOutcome({
        success: false,
        status: "failed",
        gatewayRefundId: "re_failed_coerce",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "succeeded",
      }),
    ).toBe("failed");

    const mapped = mapGatewayRefundToOperationResult({
      success: false,
      status: "failed",
      gatewayRefundId: "re_f",
      amount: 2,
      currency: "USD",
      rawResponse: {},
    });
    expect(mapped.outcome).toBe("failed");

    // CORE-2: gateway pending beats invented completed on succeeded outcome
    const mappedPending = mapGatewayRefundToOperationResult({
      success: true,
      status: "pending",
      gatewayRefundId: "re_p",
      amount: 1,
      currency: "SAR",
      rawResponse: {},
      outcome: "succeeded",
    });
    expect(mappedPending.outcome).toBe("pending");
    if (mappedPending.outcome === "pending") {
      expect(mappedPending.status).toBe("pending");
    }
  });

  it("isGatewayPaymentResult narrows plain objects", () => {
    expect(isGatewayPaymentResult(baseResult())).toBe(true);
    expect(isGatewayPaymentResult(null)).toBe(false);
    expect(isGatewayPaymentResult({})).toBe(false);
  });
});
